package org.gunmanrush.editor

import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.JWSHeader
import com.nimbusds.jose.crypto.RSASSASigner
import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jose.jwk.RSAKey
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.Collections
import java.util.Date
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

class ChatGPTAuthTest {
    class Memory : AuthStorage {
        private val values = mutableMapOf<String, JSONObject>()
        @Synchronized override fun read(name: String) = values[name]?.let { JSONObject(it.toString()) }
        @Synchronized override fun write(name: String, value: JSONObject) { values[name] = JSONObject(value.toString()) }
        @Synchronized override fun remove(name: String) { values.remove(name) }
    }
    class Provider : AutoCloseable {
        val server = MockWebServer()
        val store = Memory()
        val threads = Executors.newCachedThreadPool()
        val authorizations = Collections.synchronizedList(mutableListOf<HttpUrl>())
        val pages = Collections.synchronizedList(mutableListOf<Future<String>>())
        val key: RSAKey = RSAKeyGenerator(2048).keyID("test-key").generate()
        lateinit var nonce: String
        lateinit var challenge: String
        lateinit var redirect: String
        val keysEntered = CountDownLatch(1)
        @Volatile var keyMode = "ok"
        @Volatile var tokenError = false
        @Volatile var badClaims = ""
        @Volatile var wrongStateFirst = false
        @Volatile var duplicateCode = false
        @Volatile var wrongDiscovery = false
        @Volatile var omitRefreshIdentity = false
        @Volatile var tokenCalls = 0
        @Volatile var refreshCalls = 0
        @Volatile var subject = "test-subject"
        val http = OkHttpClient.Builder().readTimeout(600, TimeUnit.MILLISECONDS).callTimeout(1500, TimeUnit.MILLISECONDS).build()
        val browser = OkHttpClient.Builder().readTimeout(5, TimeUnit.SECONDS).build()
        val issuer: String get() = server.url("/").toString().trimEnd('/')
        init {
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if(request.path == "/.well-known/openid-configuration") return json(JSONObject().put("issuer", issuer)
                        .put("authorization_endpoint", if(wrongDiscovery)"https://unrelated.invalid/authorize" else "$issuer/authorize")
                        .put("token_endpoint", "$issuer/token").put("jwks_uri", "$issuer/keys"))
                    if(request.path == "/keys") {
                        keysEntered.countDown()
                        if(keyMode == "timeout") return MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
                        if(keyMode == "empty") return json(JSONObject().put("keys", org.json.JSONArray()))
                        val publicKey=if(keyMode == "wrong") RSAKeyGenerator(2048).keyID("test-key").generate().toPublicJWK() else key.toPublicJWK()
                        return json(JSONObject(JWKSet(publicKey).toString()))
                    }
                    if(request.path == "/token") {
                        val data=("http://localhost/?"+request.body.readUtf8()).toHttpUrl()
                        val refresh=data.queryParameter("grant_type")=="refresh_token"
                        if(refresh)refreshCalls++ else {
                            tokenCalls++
                            assertEquals("issued_client",data.queryParameter("client_id"))
                            assertEquals(redirect,data.queryParameter("redirect_uri"))
                            val bytes=java.security.MessageDigest.getInstance("SHA-256").digest(data.queryParameter("code_verifier")!!.toByteArray())
                            assertEquals(challenge,java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes))
                        }
                        if(tokenError)return json(JSONObject().put("error","invalid_grant")).setResponseCode(400).addHeader("x-request-id","test-request-id")
                        val record=JSONObject().put("token_type","Bearer").put("scope","openid offline_access chatgpt.tokens.use.direct")
                            .put("expires_in",3600).put("access_token",if(refresh)"test-new-access" else "test-access").put("refresh_token",if(refresh)"test-new-refresh" else "test-refresh")
                        if(!refresh||!omitRefreshIdentity)record.put("id_token",token(refresh))
                        if(refresh)record.remove("scope")
                        return json(record)
                    }
                    return MockResponse().setResponseCode(404)
                }
            }
            server.start()
        }
        private fun json(body: JSONObject) = MockResponse().addHeader("Content-Type","application/json").setBody(body.toString())
        private fun token(refresh: Boolean): String {
            val claims=JWTClaimsSet.Builder().issuer(if(badClaims=="issuer")"https://wrong.invalid" else issuer)
                .audience(if(badClaims=="audience")"wrong-client" else "issued_client").subject(subject)
                .issueTime(Date()).expirationTime(Date(System.currentTimeMillis()+3600000))
            if(!refresh)claims.claim("nonce",if(badClaims=="nonce")"wrong-nonce" else nonce)
            val jwt=SignedJWT(JWSHeader.Builder(JWSAlgorithm.RS256).keyID("test-key").build(),claims.build())
            jwt.sign(RSASSASigner(key));return jwt.serialize()
        }
        fun flow()=ChatGPTAuth(store,{url->
            val uri=url.toHttpUrl();authorizations.add(uri);nonce=uri.queryParameter("nonce")!!;challenge=uri.queryParameter("code_challenge")!!;redirect=uri.queryParameter("redirect_uri")!!
            pages.add(threads.submit<String>{
                fun fetch(state: String,duplicate: Boolean=false): Pair<Int,String> {
                    val target=redirect.toHttpUrl().newBuilder().addQueryParameter("state",state).addQueryParameter("code","single-use-test-code")
                    if(uri.queryParameter("client_id")=="dynamic_agent_client")target.addQueryParameter("client_id","issued_client")
                    if(duplicate)target.addQueryParameter("code","duplicate-test-code")
                    return browser.newCall(Request.Builder().url(target.build()).build()).execute().use { it.code to it.body!!.string() }
                }
                if(wrongStateFirst)assertEquals(400,fetch("unrelated-state").first)
                val response=fetch(uri.queryParameter("state")!!,duplicateCode);assertEquals(200,response.first);response.second
            })
        },issuer,http,5000)
        override fun close() { threads.shutdownNow();http.dispatcher.cancelAll();browser.dispatcher.cancelAll();server.shutdown() }
    }
    private fun failure(block:()->Unit): AuthFailure {
        try { block();fail("expected authorization failure") }catch(error:AuthFailure){return error}
        throw AssertionError()
    }
    @Test fun completeProtocolVerifiesIdentityAndAcknowledgesBrowserBeforeKeys() = Provider().use { p ->
        val auth=p.flow();auth.signIn();assertTrue(auth.status().getBoolean("connected"));assertEquals("test-access",auth.accessToken())
        assertEquals("issued_client",p.store.read("chatgpt_registration")!!.getString("client_id"))
        val page=p.pages.single().get(2,TimeUnit.SECONDS);assertTrue(page.contains("授权回应已收到"));assertTrue(page.contains("尚未确认登录成功"))
        assertFalse(auth.status().toString().contains("test-access"));assertFalse(p.authorizations.single().queryParameterNames.contains("id_token_hint"))
    }
    @Test fun keyTimeoutCanRetryWithoutBrowserOrReusingCodeEvenAfterRecreation() = Provider().use { p ->
        p.keyMode="timeout";val auth=p.flow();val error=failure { auth.signIn() }
        assertEquals("identity",error.step);assertTrue(error.retryable);assertFalse(auth.status().getBoolean("connected"));assertTrue(auth.status().getBoolean("can_retry"))
        assertNotNull(p.store.read("chatgpt_pending"));assertNull(p.store.read("chatgpt"));assertEquals(1,p.tokenCalls)
        assertTrue(p.pages.single().get(2,TimeUnit.SECONDS).contains("授权回应已收到"))
        p.keyMode="ok";val recreated=p.flow();recreated.retryIdentity();assertEquals("test-access",recreated.accessToken());assertEquals(1,p.tokenCalls);assertEquals(1,p.authorizations.size)
        assertNull(p.store.read("chatgpt_pending"))
    }
    @Test fun failedExchangeRetainsIssuedClientForFreshAuthorization() = Provider().use { p ->
        p.tokenError=true;val auth=p.flow();val error=failure { auth.signIn() }
        assertEquals(400,error.httpStatus);assertEquals("invalid_grant",error.code);assertEquals("test-request-id",error.requestId)
        assertEquals("issued_client",p.store.read("chatgpt_registration")!!.getString("client_id"))
        p.tokenError=false;auth.signIn();assertEquals(2,p.authorizations.size)
        assertEquals("issued_client",p.authorizations[1].queryParameter("client_id"));assertNull(p.authorizations[1].queryParameter("agent_name_hint"));assertTrue(auth.status().getBoolean("connected"))
    }
    @Test fun invalidSignatureNeverActivatesTokens() = Provider().use { p ->
        p.keyMode="wrong";val auth=p.flow();assertEquals("IDENTITY_INVALID",failure { auth.signIn() }.code)
        assertFalse(auth.status().getBoolean("connected"));assertFalse(auth.status().getBoolean("can_retry"));assertNull(p.store.read("chatgpt"))
    }
    @Test fun wrongNonceAudienceAndIssuerAreRejected() {
        for(claim in listOf("nonce","audience","issuer"))Provider().use { p ->
            p.badClaims=claim;val auth=p.flow();assertEquals(claim,"IDENTITY_INVALID",failure { auth.signIn() }.code);assertNull(p.store.read("chatgpt"))
        }
    }
    @Test fun cancellationStopsKeyRequestAndLateWorkCannotConnect() = Provider().use { p ->
        p.keyMode="timeout";val auth=p.flow();val done=p.threads.submit<AuthFailure> { failure { auth.signIn() } }
        assertTrue(p.keysEntered.await(3,TimeUnit.SECONDS));auth.cancelPending();assertEquals("AUTH_CANCELLED",done.get(2,TimeUnit.SECONDS).code)
        assertFalse(auth.status().getBoolean("connected"));assertNull(p.store.read("chatgpt"))
    }
    @Test fun unrelatedCallbackDoesNotConsumeThePendingAuthorization() = Provider().use { p ->
        p.wrongStateFirst=true;val auth=p.flow();auth.signIn();assertTrue(auth.status().getBoolean("connected"))
    }
    @Test fun duplicateCodeIsRejectedBeforeExchange() = Provider().use { p ->
        p.duplicateCode=true;val auth=p.flow();assertEquals("REGISTRATION_INCOMPLETE",failure { auth.signIn() }.code);assertEquals(0,p.tokenCalls)
    }
    @Test fun discoveryCannotRedirectCredentialsToAnotherOrigin() = Provider().use { p ->
        p.wrongDiscovery=true;val auth=p.flow();assertEquals("DISCOVERY_MISMATCH",failure { auth.signIn() }.code);assertEquals(0,p.authorizations.size)
    }
    @Test fun emptyKeysAreRetryableNotAValidIdentity() = Provider().use { p ->
        p.keyMode="empty";val auth=p.flow();assertEquals("KEY_SET_UNAVAILABLE",failure { auth.signIn() }.code);assertTrue(auth.status().getBoolean("can_retry"))
    }
    @Test fun rejectedNewIdentityPreservesPreviouslyVerifiedAccount() = Provider().use { p ->
        val auth=p.flow();auth.signIn();val before=p.store.read("chatgpt")!!.toString();p.subject="different-subject"
        assertEquals("ACCOUNT_MISMATCH",failure { auth.signIn() }.code);assertEquals(before,p.store.read("chatgpt")!!.toString())
    }
    @Test fun refreshRotationSurvivesKeyOutageWithoutRepeatingGrant() = Provider().use { p ->
        val auth=p.flow();auth.signIn();val old=p.store.read("chatgpt")!!;old.put("expires_at",0);p.store.write("chatgpt",old)
        p.keyMode="timeout";assertEquals("identity",failure { auth.accessToken() }.step);assertEquals(1,p.refreshCalls)
        p.keyMode="ok";assertEquals("test-new-access",auth.accessToken());assertEquals(1,p.refreshCalls);assertEquals("test-new-refresh",p.store.read("chatgpt")!!.getString("refresh_token"))
    }
    @Test fun refreshMayOmitUnchangedIdentityAndScope() = Provider().use { p ->
        val auth=p.flow();auth.signIn();val old=p.store.read("chatgpt")!!;old.put("expires_at",0);p.store.write("chatgpt",old);p.omitRefreshIdentity=true
        assertEquals("test-new-access",auth.accessToken());assertEquals(1,p.refreshCalls)
    }
}
