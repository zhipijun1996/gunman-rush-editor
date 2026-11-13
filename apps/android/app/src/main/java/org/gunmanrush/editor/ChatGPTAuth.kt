package org.gunmanrush.editor

import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jose.jwk.source.ImmutableJWKSet
import com.nimbusds.jose.proc.JWSVerificationKeySelector
import com.nimbusds.jose.proc.SecurityContext
import com.nimbusds.jwt.proc.BadJWTException
import com.nimbusds.jwt.proc.DefaultJWTProcessor
import com.nimbusds.jwt.proc.JWTClaimsSetVerifier
import okhttp3.Call
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

interface AuthStorage {
    fun read(name: String): JSONObject?
    fun write(name: String, value: JSONObject)
    fun remove(name: String)
}

class AuthFailure(val code: String, val step: String, val retryable: Boolean = false,
                  val httpStatus: Int? = null, val requestId: String? = null) : Exception(
    "${labels[step] ?: "ChatGPT连接"}失败 [$code]" +
        (httpStatus?.let { " · HTTP $it" } ?: "") + (requestId?.let { " · 请求 $it" } ?: "")) {
    fun diagnostic() = JSONObject().put("code", code).put("step", step).put("retryable", retryable)
        .apply { httpStatus?.let { put("http_status", it) }; requestId?.let { put("request_id", it) } }
    companion object {
        val labels = mapOf("discovery" to "读取授权配置", "browser" to "打开浏览器", "callback" to "接收授权回应",
            "registration" to "保存应用身份", "token" to "交换登录凭据", "identity" to "校验登录身份",
            "storage" to "安全保存账号", "cancelled" to "授权取消", "refresh" to "刷新账号")
    }
}

/** One OAuth owner, with no Android dependency. Tests run real loopback HTTP,
 * signed identities, timeouts and retry against a local provider. Production
 * always uses the OpenAI issuer; no endpoint is accepted from the WebView. */
class ChatGPTAuth(private val store: AuthStorage,
                  private val openBrowser: (String) -> Unit,
                  private val issuer: String = "https://auth.openai.com",
                  private val http: OkHttpClient = OkHttpClient.Builder()
                      .connectTimeout(20, TimeUnit.SECONDS).readTimeout(45, TimeUnit.SECONDS)
                      .callTimeout(60, TimeUnit.SECONDS).build(),
                  private val callbackTimeoutMs: Int = 180000,
                  private val onCallbackReceived: () -> Unit = {}) {
    private val signing = AtomicBoolean(false)
    private val generation = AtomicLong(0)
    private val activeCall = AtomicReference<Call?>()
    private val commitLock = Any()
    @Volatile private var listener: ServerSocket? = null
    @Volatile private var endpoints: JSONObject? = null
    private val resource = "https://api.openai.com/v1"
    private val scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
    private fun random() = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) })
    private fun checkActive(epoch: Long) { if (epoch != generation.get()) throw AuthFailure("AUTH_CANCELLED", "cancelled") }
    private fun progress(step: String) { store.write("chatgpt_auth_state", JSONObject().put("step", step)) }
    private fun failed(error: AuthFailure) { store.write("chatgpt_auth_state", error.diagnostic().put("message", error.message)) }
    private fun discardInvalidPending(failure: AuthFailure, epoch: Long) {
        if (!failure.retryable && failure.step == "identity") synchronized(commitLock) { if (epoch == generation.get()) store.remove("chatgpt_pending") }
    }
    private fun normalized(error: Exception, step: String, epoch: Long): AuthFailure = when {
        epoch != generation.get() -> AuthFailure("AUTH_CANCELLED", "cancelled")
        error is AuthFailure -> error
        error is java.io.IOException -> AuthFailure("NETWORK_TIMEOUT_OR_UNAVAILABLE", step, true)
        else -> AuthFailure("INVALID_RESPONSE", step)
    }
    fun status(): JSONObject {
        val account = store.read("chatgpt")
        val pending = store.read("chatgpt_pending")
        val state = store.read("chatgpt_auth_state")
        return JSONObject().put("connected", account != null).put("busy", signing.get())
            .put("can_retry", pending != null && !signing.get())
            .put("step", state?.optString("step") ?: "idle")
            .apply {
                if (account != null) put("email", account.optString("email")).put("plan_enabled", account.optString("scope").split(' ').contains("chatgpt.tokens.use.direct"))
                if (state?.has("code") == true) { put("diagnostic", state); put("last_error", state.optString("message")) }
            }
    }
    private fun request(url: String, step: String, epoch: Long, form: FormBody? = null): JSONObject {
        checkActive(epoch)
        val builder = Request.Builder().url(url).header("Accept", "application/json")
        if (form != null) builder.post(form)
        val call = http.newCall(builder.build()); activeCall.set(call)
        try {
            checkActive(epoch)
            return call.execute().use { response ->
                val body = response.body?.string() ?: ""
                checkActive(epoch)
                if (!response.isSuccessful) {
                    val data = runCatching { JSONObject(body) }.getOrNull()
                    val rawCode = data?.optJSONObject("error")?.optString("code") ?: data?.optString("error")
                    val code = rawCode?.takeIf { it.matches(Regex("[A-Za-z0-9_.-]{1,80}")) } ?: "HTTP_ERROR"
                    val rid = response.header("x-request-id")?.takeIf { it.matches(Regex("[A-Za-z0-9_.:-]{1,128}")) }
                    throw AuthFailure(code, step, response.code == 429 || response.code >= 500, response.code, rid)
                }
                try { JSONObject(body) } catch (_: Exception) { throw AuthFailure("INVALID_JSON", step, true) }
            }
        } catch (error: Exception) { throw normalized(error, step, epoch) }
        finally { activeCall.compareAndSet(call, null) }
    }
    private fun discovery(epoch: Long): JSONObject {
        endpoints?.let { return it }
        val data = request("$issuer/.well-known/openid-configuration", "discovery", epoch)
        val origin = issuer.toHttpUrl()
        val valid = data.optString("issuer") == issuer && listOf("authorization_endpoint", "token_endpoint", "jwks_uri").all {
            runCatching { data.getString(it).toHttpUrl() }.getOrNull()?.let { url ->
                url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
            } == true
        }
        if (!valid) throw AuthFailure("DISCOVERY_MISMATCH", "discovery")
        endpoints = data; return data
    }
    private fun form(vararg fields: Pair<String, String>) = FormBody.Builder().apply { fields.forEach { add(it.first, it.second) } }.build()
    private data class Callback(val code: String, val client: String)
    private fun page(socket: Socket, status: String = "200 OK", body: String = "") {
        val content = body.toByteArray(Charsets.UTF_8)
        runCatching { socket.getOutputStream().apply {
            write("HTTP/1.1 $status\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${content.size}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n".toByteArray())
            write(content); flush()
        } }
    }
    private fun receive(server: ServerSocket, state: String, savedClient: String?, epoch: Long): Callback {
        val deadline = System.currentTimeMillis() + callbackTimeoutMs
        while (System.currentTimeMillis() < deadline) {
            checkActive(epoch); server.soTimeout = (deadline - System.currentTimeMillis()).coerceAtLeast(1).toInt()
            server.accept().use { socket ->
                socket.soTimeout = 5000
                val reader = socket.getInputStream().bufferedReader()
                val first = reader.readLine() ?: return@use
                if (first.length > 8192) { page(socket, "400 Bad Request"); return@use }
                val parts = first.split(' ')
                var host = ""; var length = 0
                while (true) { val line = reader.readLine() ?: break; if (line.isEmpty()) break
                    length += line.length; if (length > 16384) { page(socket, "400 Bad Request"); return@use }
                    if (line.substringBefore(':').equals("Host", true)) host = line.substringAfter(':').trim()
                }
                val target = parts.getOrNull(1) ?: ""
                val uri = runCatching { "http://127.0.0.1:${server.localPort}$target".toHttpUrl() }.getOrNull()
                if (parts.firstOrNull() != "GET" || host != "127.0.0.1:${server.localPort}" || uri?.encodedPath != "/auth/callback") { page(socket, "404 Not Found"); return@use }
                val returned = uri.queryParameterValues("state")
                if (returned.size != 1 || !MessageDigest.isEqual(returned[0].orEmpty().toByteArray(), state.toByteArray())) { page(socket, "400 Bad Request"); return@use }
                // Acknowledge receipt before network work. This says nothing
                // about verified credentials and never leaves the browser waiting.
                page(socket, body = """<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>返回世界工坊</title><body style="background:#142027;color:#e6e3ce;font:18px/1.7 sans-serif;padding:32px"><h2>授权回应已收到</h2><p>App正在核验身份，尚未确认登录成功。请返回查看进度；公钥网络超时可以直接重试核验。</p><a style="color:#dec58a" href="gunmanworld://auth-return">返回世界工坊</a><script>history.replaceState(null,'','/auth/received')</script></body></html>""")
                if (uri.queryParameter("error") != null) throw AuthFailure("AUTHORIZATION_REJECTED", "callback")
                val client = uri.queryParameter("client_id") ?: savedClient
                val code = uri.queryParameter("code")
                if (code.isNullOrBlank() || uri.queryParameterValues("code").size != 1 || uri.queryParameterValues("client_id").size > 1 ||
                    client.isNullOrBlank() || !client.matches(Regex("[A-Za-z0-9_-]{1,200}")) || client == "dynamic_agent_client" ||
                    savedClient != null && client != savedClient) throw AuthFailure("REGISTRATION_INCOMPLETE", "callback")
                return Callback(code, client)
            }
        }
        throw AuthFailure("AUTHORIZATION_TIMEOUT", "callback", true)
    }
    fun signIn(): JSONObject {
        if (!signing.compareAndSet(false, true)) throw AuthFailure("AUTHORIZATION_IN_PROGRESS", "browser")
        val epoch = generation.get(); var step = "discovery"
        try {
            progress(step)
            val config = discovery(epoch); val old = store.read("chatgpt")
            val registration = store.read("chatgpt_registration")?.optString("client_id")?.takeIf { it.isNotBlank() }
            val client = old?.optString("client_id")?.takeIf { it.isNotBlank() } ?: registration
            val host = store.read("host") ?: JSONObject().put("id", "urn:uuid:${UUID.randomUUID()}").also { store.write("host", it) }
            val state = random(); val nonce = random(); val verifier = random()
            store.remove("chatgpt_pending")
            val callback = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
                listener = server
                val redirect = "http://127.0.0.1:${server.localPort}/auth/callback"
                val authorize = config.getString("authorization_endpoint").toHttpUrl().newBuilder()
                    .addQueryParameter("client_id", client ?: "dynamic_agent_client").addQueryParameter("response_type", "code")
                    .addQueryParameter("redirect_uri", redirect).addQueryParameter("scope", scope).addQueryParameter("resource", resource)
                    .addQueryParameter("state", state).addQueryParameter("nonce", nonce).addQueryParameter("code_challenge_method", "S256")
                    .addQueryParameter("code_challenge", Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))))
                    .addQueryParameter("ext_agent_host_id", host.getString("id"))
                if (client == null) authorize.addQueryParameter("agent_name_hint", "Gunman Rush World Editor")
                old?.optString("email")?.takeIf { it.isNotBlank() }?.let { authorize.addQueryParameter("login_hint", it) }
                step = "browser"; progress(step); openBrowser(authorize.build().toString())
                step = "callback"; progress(step)
                val result = receive(server, state, client, epoch)
                Triple(result, redirect, verifier)
            }
            listener = null; checkActive(epoch); onCallbackReceived()
            step = "registration"; progress(step)
            synchronized(commitLock) { checkActive(epoch); store.write("chatgpt_registration", JSONObject().put("client_id", callback.first.client)) }
            step = "token"; progress(step)
            val record = request(config.getString("token_endpoint"), step, epoch, form("grant_type" to "authorization_code", "client_id" to callback.first.client,
                "code" to callback.first.code, "code_verifier" to callback.third, "redirect_uri" to callback.second, "resource" to resource))
            validateTokens(record, System.currentTimeMillis())
            synchronized(commitLock) { checkActive(epoch); store.write("chatgpt_pending", JSONObject().put("record", record).put("client_id", callback.first.client)
                .put("nonce", nonce).put("received_at", System.currentTimeMillis()).put("subject", old?.optString("subject") ?: "")) }
            step = "identity"; progress(step); finishPending(epoch)
            return status()
        } catch (error: Exception) {
            val failure = if (error is SocketTimeoutException && step == "callback") AuthFailure("AUTHORIZATION_TIMEOUT", step, true) else normalized(error, step, epoch)
            discardInvalidPending(failure, epoch); failed(failure); throw failure
        } finally { listener?.close(); listener = null; signing.set(false) }
    }
    private fun validateTokens(record: JSONObject, receivedAt: Long) {
        val expires = record.optDouble("expires_in", -1.0)
        val scopes = record.optString("scope").split(Regex("\\s+"))
        if (record.optString("access_token").isBlank() || !record.optString("token_type").equals("bearer", true) || !expires.isFinite() || expires <= 0 ||
            record.optString("refresh_token").isBlank() || !scopes.contains("chatgpt.tokens.use.direct") || record.optString("id_token").isBlank()) throw AuthFailure("TOKEN_FIELDS_INVALID", "token")
        record.put("expires_at", receivedAt + (expires * 1000).toLong())
    }
    private fun verify(record: JSONObject, client: String, nonce: String?, receivedAt: Long, epoch: Long): JSONObject {
        val jwks = request(discovery(epoch).getString("jwks_uri"), "identity", epoch)
        val keys = try { JWKSet.parse(jwks.toString()) } catch (_: Exception) { throw AuthFailure("KEY_SET_UNAVAILABLE", "identity", true) }
        if (keys.keys.isEmpty()) throw AuthFailure("KEY_SET_UNAVAILABLE", "identity", true)
        val processor = DefaultJWTProcessor<SecurityContext>()
        processor.jwsKeySelector = JWSVerificationKeySelector(JWSAlgorithm.RS256, ImmutableJWKSet<SecurityContext>(keys))
        processor.jwtClaimsSetVerifier = JWTClaimsSetVerifier { claims, _ ->
            val aud = claims.audience
            val azp = claims.getStringClaim("azp")
            if (claims.issuer != issuer || !aud.contains(client) || claims.expirationTime == null || claims.expirationTime.time < receivedAt - 5000 ||
                claims.issueTime == null || claims.issueTime.time > receivedAt + 5000 || claims.notBeforeTime?.time?.let { it > receivedAt + 5000 } == true ||
                claims.subject.isNullOrBlank() || nonce != null && claims.getStringClaim("nonce") != nonce ||
                azp != null && azp != client || aud.size > 1 && azp != client) throw BadJWTException("Identity claims mismatch")
        }
        val claims = try { processor.process(record.getString("id_token"), null) } catch (_: Exception) { throw AuthFailure("IDENTITY_INVALID", "identity") }
        return JSONObject().put("subject", claims.subject).put("email", claims.getStringClaim("email") ?: "")
    }
    private fun finishPending(epoch: Long) {
        val pending = store.read("chatgpt_pending") ?: throw AuthFailure("NO_PENDING_IDENTITY", "identity")
        val record = pending.getJSONObject("record"); val client = pending.getString("client_id")
        val identity = verify(record, client, pending.optString("nonce").takeIf { it.isNotBlank() }, pending.getLong("received_at"), epoch)
        val expected = pending.optString("subject")
        if (expected.isNotBlank() && expected != identity.getString("subject")) throw AuthFailure("ACCOUNT_MISMATCH", "identity")
        synchronized(commitLock) {
            checkActive(epoch); progress("storage")
            store.write("chatgpt", record.put("client_id", client).put("subject", identity.getString("subject")).put("email", identity.getString("email")))
            store.remove("chatgpt_pending"); progress("connected")
        }
    }
    fun retryIdentity(): JSONObject {
        if (!signing.compareAndSet(false, true)) throw AuthFailure("AUTHORIZATION_IN_PROGRESS", "identity")
        val epoch = generation.get()
        try { progress("identity"); finishPending(epoch); return status() }
        catch (error: Exception) { val failure = normalized(error, "identity", epoch); discardInvalidPending(failure, epoch); failed(failure); throw failure }
        finally { signing.set(false) }
    }
    @Synchronized fun accessToken(): String {
        if (signing.get()) throw AuthFailure("AUTHORIZATION_IN_PROGRESS", "refresh", true)
        val epoch = generation.get()
        val old = store.read("chatgpt") ?: throw AuthFailure("SIGN_IN_REQUIRED", "refresh")
        if (old.optLong("expires_at") > System.currentTimeMillis() + 60000) return old.getString("access_token")
        if (store.read("chatgpt_pending") == null) {
            val result = request(discovery(epoch).getString("token_endpoint"), "refresh", epoch,
                form("grant_type" to "refresh_token", "client_id" to old.getString("client_id"), "refresh_token" to old.getString("refresh_token"), "resource" to resource))
            val merged = JSONObject(old.toString()); result.keys().forEach { merged.put(it, result.get(it)) }
            validateTokens(merged, System.currentTimeMillis())
            synchronized(commitLock) { checkActive(epoch); store.write("chatgpt_pending", JSONObject().put("record", merged).put("client_id", old.getString("client_id"))
                .put("received_at", System.currentTimeMillis()).put("subject", old.getString("subject"))) }
            if (!result.has("id_token")) { // Existing verified identity; no new claim was supplied.
                synchronized(commitLock) { checkActive(epoch); store.write("chatgpt", merged); store.remove("chatgpt_pending") }
                return merged.getString("access_token")
            }
        }
        try { finishPending(epoch) }
        catch (error: Exception) { val failure = normalized(error, "identity", epoch); discardInvalidPending(failure, epoch); failed(failure); throw failure }
        return store.read("chatgpt")!!.getString("access_token")
    }
    fun cancelPending() { synchronized(commitLock) { generation.incrementAndGet(); activeCall.getAndSet(null)?.cancel(); runCatching { listener?.close() } } }
    fun signOut(): JSONObject { cancelPending(); synchronized(commitLock) { store.remove("chatgpt"); store.remove("chatgpt_pending"); store.remove("chatgpt_auth_state") }; return status() }
}
