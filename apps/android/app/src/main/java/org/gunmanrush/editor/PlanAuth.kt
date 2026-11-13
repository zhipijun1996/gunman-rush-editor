package org.gunmanrush.editor

import android.app.Activity
import android.content.Intent
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
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class PlanAuth(private val activity: Activity, private val vault: Vault) {
    private val http = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    private val tokenUrl = "https://auth.openai.com/api/accounts/oauth/token"
    private val issuer = "https://auth.openai.com"
    private fun random() = Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    private val signing = AtomicBoolean(false)
    private val generation = AtomicLong(0)
    @Volatile private var pendingServer: ServerSocket? = null
    fun status(): JSONObject {
        val account = vault.read("chatgpt")
        val result = JSONObject().put("connected", account != null).put("busy", signing.get())
        if (account != null) result.put("email", account.optString("email")).put("plan_enabled", account.optString("scope").split(' ').contains("chatgpt.tokens.use.direct"))
        val progress = vault.read("chatgpt_auth_state")
        if (progress?.optString("stage") == "failed") result.put("last_error", progress.optString("message"))
        else if (account == null && !signing.get() && progress?.optString("stage") in listOf("authorizing", "exchanging"))
            result.put("last_error", "上次授权未完成，请重新连接；草稿未改变")
        return result
    }
    private fun progress(stage: String, message: String = "") = vault.write("chatgpt_auth_state", JSONObject().put("stage", stage).put("message", message))
    private fun callbackPage(socket: java.net.Socket, success: Boolean) {
        val title = if (success) "账号授权已保存" else "授权未完成"
        val message = if (success) "返回工坊后将检查模型连接；成功执行AI请求后才完成可用性验证。" else "请返回工坊查看失败步骤并重试，原草稿与原账号保持不变。"
        val html = """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>$title</title><body style="background:#142027;color:#e6e3ce;font:18px/1.7 sans-serif;padding:32px"><h2>$title</h2><p>$message</p><a style="color:#dec58a" href="gunmanworld://auth-return">返回世界工坊</a></body></html>""".toByteArray()
        runCatching { socket.getOutputStream().write(("HTTP/1.1 " + (if (success) "200 OK" else "400 Bad Request") + "\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${html.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").toByteArray() + html); socket.getOutputStream().flush() }
    }
    fun signIn(): JSONObject {
        check(signing.compareAndSet(false, true)) { "授权正在进行，请完成当前授权或返回后重试" }
        val attempt = generation.get()
        progress("authorizing")
        try {
            val old = vault.read("chatgpt")
            val host = vault.read("host") ?: JSONObject().put("id", "urn:uuid:${UUID.randomUUID()}").also { vault.write("host", it) }
            val state = random(); val nonce = random(); val verifier = random()
            ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
                pendingServer = server; server.soTimeout = 180000
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
                    server.soTimeout = (deadline - System.currentTimeMillis()).coerceAtLeast(1).toInt()
                    server.accept().use { socket ->
                        socket.soTimeout = 5000
                        val line = socket.getInputStream().bufferedReader().readLine() ?: return@use
                        if (line.length > 8192) return@use
                        val target = line.split(' ').getOrNull(1) ?: return@use
                        val uri = Uri.parse("http://127.0.0.1$target")
                        if (uri.path != "/auth/callback" || uri.getQueryParameter("state") != state) {
                            socket.getOutputStream().write("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); return@use
                        }
                        try {
                            check(uri.getQueryParameter("error") == null) { "浏览器未授予授权，请重新连接" }
                            val issued = uri.getQueryParameter("client_id") ?: old?.getString("client_id")
                            check(!issued.isNullOrEmpty() && issued != "dynamic_agent_client") { "授权回调缺少有效客户端身份" }
                            check(old == null || issued == old.getString("client_id")) { "返回的客户端身份与原登录不一致" }
                            val code = uri.getQueryParameter("code") ?: error("授权回调缺少code")
                            progress("exchanging")
                            val result = postToken(FormBody.Builder().add("grant_type", "authorization_code").add("client_id", issued)
                                .add("code", code).add("code_verifier", verifier).add("redirect_uri", redirect).add("resource", "https://api.openai.com/v1").build())
                            val claims = verify(result.getString("id_token"), issued, nonce)
                            check(old == null || old.getString("subject") == claims.getString("subject")) { "登录身份不匹配，请先退出原账号" }
                            check(generation.get() == attempt) { "授权已取消，请重新连接" }
                            result.put("client_id", issued).put("subject", claims.getString("subject")).put("email", claims.optString("email"))
                            save(result); progress("saved"); callbackPage(socket, true)
                            activity.runOnUiThread { activity.startActivity(Intent(activity, EditorActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
                            return status()
                        } catch (error: Exception) { callbackPage(socket, false); throw error }
                    }
                }
            }
            error("浏览器授权超时，请重新连接；草稿与原账号未改变")
        } catch (error: Exception) {
            val message = if (generation.get() != attempt) "授权已取消，原账号与草稿保持不变" else if (error is java.net.SocketTimeoutException) "浏览器授权超时，请重新连接" else error.message ?: "授权未完成，请重新连接"
            progress("failed", message); throw IllegalStateException(message)
        } finally { pendingServer = null; signing.set(false) }
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
    fun cancelPending() { generation.incrementAndGet(); runCatching { pendingServer?.close() } }
    fun signOut(): JSONObject { cancelPending(); vault.remove("chatgpt"); vault.remove("chatgpt_auth_state"); return status() }
}
