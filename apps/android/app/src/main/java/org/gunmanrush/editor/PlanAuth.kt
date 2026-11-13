package org.gunmanrush.editor

import android.app.Activity
import android.net.Uri
import android.util.Base64
import androidx.browser.customtabs.CustomTabsIntent
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.jwk.source.RemoteJWKSet
import com.nimbusds.jose.proc.JWSVerificationKeySelector
import com.nimbusds.jose.proc.SecurityContext
import com.nimbusds.jwt.proc.DefaultJWTProcessor
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URL
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Date
import java.util.UUID
import java.util.concurrent.TimeUnit

class PlanAuth(private val activity: Activity, private val vault: Vault) {
    private val http = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    private val tokenUrl = "https://auth.openai.com/api/accounts/oauth/token"
    private val issuer = "https://auth.openai.com"
    private fun random() = Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    fun status(): JSONObject = vault.read("chatgpt")?.let { JSONObject().put("connected", true).put("email", it.optString("email")).put("plan_enabled", it.optString("scope").split(' ').contains("chatgpt.tokens.use.direct")) } ?: JSONObject().put("connected", false)
    @Synchronized fun signIn(): JSONObject {
        val old = vault.read("chatgpt")
        val host = vault.read("host") ?: JSONObject().put("id", "urn:uuid:${UUID.randomUUID()}").also { vault.write("host", it) }
        val state = random(); val nonce = random(); val verifier = random()
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
            server.soTimeout = 180000
            val redirect = "http://127.0.0.1:${server.localPort}/auth/callback"
            val client = old?.getString("client_id") ?: "dynamic_agent_client"
            val builder = Uri.parse("https://auth.openai.com/api/accounts/authorize").buildUpon()
                .appendQueryParameter("client_id", client).appendQueryParameter("ext_agent_host_id", host.getString("id"))
                .appendQueryParameter("response_type", "code").appendQueryParameter("redirect_uri", redirect)
                .appendQueryParameter("scope", "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct")
                .appendQueryParameter("resource", "https://api.openai.com/v1").appendQueryParameter("state", state)
                .appendQueryParameter("nonce", nonce).appendQueryParameter("code_challenge_method", "S256")
                .appendQueryParameter("code_challenge", Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING))
            if (old == null) builder.appendQueryParameter("agent_name_hint", "Gunman Rush World Editor")
            else builder.appendQueryParameter("id_token_hint", old.getString("id_token"))
            activity.runOnUiThread { CustomTabsIntent.Builder().build().launchUrl(activity, builder.build()) }
            val deadline = System.currentTimeMillis() + 180000
            while (System.currentTimeMillis() < deadline) {
                server.accept().use { socket ->
                    socket.soTimeout = 5000
                    val line = socket.getInputStream().bufferedReader().readLine() ?: return@use
                    if (line.length > 8192) return@use
                    val target = line.split(' ').getOrNull(1) ?: return@use
                    val uri = Uri.parse("http://127.0.0.1$target")
                    if (uri.path != "/auth/callback" || uri.getQueryParameter("state") != state) {
                        socket.getOutputStream().write("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                        return@use
                    }
                    val body = "授权已返回世界工坊。你可以关闭此页面并返回编辑器。".toByteArray()
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n".toByteArray() + body)
                    check(uri.getQueryParameter("error") == null) { "授权未完成，原登录保持不变" }
                    val issued = uri.getQueryParameter("client_id") ?: old?.getString("client_id")
                    check(!issued.isNullOrEmpty() && issued != "dynamic_agent_client") { "授权缺少有效客户端身份" }
                    check(old == null || issued == old.getString("client_id")) { "返回的客户端身份与原登录不一致" }
                    val code = uri.getQueryParameter("code") ?: error("授权缺少code")
                    val result = postToken(FormBody.Builder().add("grant_type", "authorization_code").add("client_id", issued)
                        .add("code", code).add("code_verifier", verifier).add("redirect_uri", redirect).add("resource", "https://api.openai.com/v1").build())
                    val claims = verify(result.getString("id_token"), issued, nonce)
                    check(old == null || old.getString("subject") == claims.getString("subject")) { "登录身份不匹配，请先退出原账号" }
                    result.put("client_id", issued).put("subject", claims.getString("subject")).put("email", claims.optString("email"))
                    save(result)
                    return status()
                }
            }
        }
        error("授权超时，草稿与原登录未改变")
    }
    private fun verify(jwt: String, client: String, nonce: String?): JSONObject {
        val processor = DefaultJWTProcessor<SecurityContext>()
        processor.jwsKeySelector = JWSVerificationKeySelector(setOf(JWSAlgorithm.RS256, JWSAlgorithm.ES256), RemoteJWKSet(URL("https://auth.openai.com/.well-known/jwks.json")))
        val claims = processor.process(jwt, null)
        check(claims.issuer == issuer && claims.audience.contains(client) && claims.expirationTime?.after(Date()) == true && !claims.subject.isNullOrEmpty()) { "登录身份校验失败" }
        if (nonce != null) check(claims.getStringClaim("nonce") == nonce) { "登录nonce不匹配" }
        return JSONObject().put("subject", claims.subject).put("email", claims.getStringClaim("email") ?: "")
    }
    private fun postToken(body: FormBody): JSONObject = http.newCall(Request.Builder().url(tokenUrl).post(body).build()).execute().use { response ->
        val text = response.body?.string() ?: error("登录响应为空")
        check(response.isSuccessful) { "ChatGPT授权失败（HTTP ${response.code}），请重新登录" }
        JSONObject(text)
    }
    private fun save(record: JSONObject) {
        check(record.optString("scope").split(' ').contains("chatgpt.tokens.use.direct")) { "已登录，但尚未授权套餐用量；请重新授权" }
        record.put("expires_at", System.currentTimeMillis() + record.optLong("expires_in", 3600) * 1000)
        vault.write("chatgpt", record)
    }
    @Synchronized fun accessToken(): String {
        val old = vault.read("chatgpt") ?: error("请先登录ChatGPT")
        if (old.optLong("expires_at") > System.currentTimeMillis() + 60000) return old.getString("access_token")
        val fresh = postToken(FormBody.Builder().add("grant_type", "refresh_token").add("refresh_token", old.getString("refresh_token"))
            .add("client_id", old.getString("client_id")).add("resource", "https://api.openai.com/v1").build())
        if (fresh.has("id_token")) check(verify(fresh.getString("id_token"), old.getString("client_id"), null).getString("subject") == old.getString("subject")) { "刷新登录身份不匹配" }
        val merged = JSONObject(old.toString()); fresh.keys().forEach { merged.put(it, fresh.get(it)) }; save(merged)
        return merged.getString("access_token")
    }
    fun signOut(): JSONObject { vault.remove("chatgpt"); return status() }
}
