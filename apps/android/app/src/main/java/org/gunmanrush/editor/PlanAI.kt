package org.gunmanrush.editor

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.ConcurrentHashMap
import okhttp3.Call

class PlanAI(private val auth: PlanAuth) {
    private val http = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(180, TimeUnit.SECONDS).build()
    private val calls = ConcurrentHashMap<String, Call>()
    private val cancelled = ConcurrentHashMap.newKeySet<String>()
    fun close() { calls.values.forEach { it.cancel() }; calls.clear() }
    fun cancel(requestId: String) { cancelled.add(requestId); calls.remove(requestId)?.cancel(); if (cancelled.size > 256) cancelled.iterator().let { if (it.hasNext()) cancelled.remove(it.next()) } }
    fun models(): JSONArray = http.newCall(Request.Builder().url("https://api.openai.com/v1/models").header("Authorization", "Bearer ${auth.accessToken()}").build()).execute().use { response ->
        check(response.isSuccessful) { "账号已保存，读取套餐模型失败（HTTP ${response.code}）；请重试连接检查" }
        ModelCatalog.parse(JSONObject(response.body?.string() ?: error("模型目录为空")))
    }
    fun response(params: JSONObject, requestId: String): JSONObject {
        check(!cancelled.contains(requestId)) { "请求已停止" }
        val payload = JSONObject().put("model", params.getString("model")).put("input", params.getJSONArray("input"))
            .put("tools", params.getJSONArray("tools")).put("store", false).put("stream", true)
        val body = payload.toString(); check(body.length < 8 * 1024 * 1024) { "本轮上下文过大，请缩小读取范围" }
        val call = http.newCall(Request.Builder().url("https://api.openai.com/v1/responses").header("Authorization", "Bearer ${auth.accessToken()}")
            .post(body.toRequestBody("application/json".toMediaType())).build())
        calls[requestId] = call
        try {
            if (cancelled.contains(requestId)) call.cancel()
            return call.execute().use { response ->
                check(response.isSuccessful) { "套餐AI请求失败（HTTP ${response.code}）；本轮未提交的修改未写入" }
                ResponseStream.read(response.body?.charStream() ?: error("AI响应为空"))
            }
        } finally { calls.remove(requestId); cancelled.remove(requestId) }
    }
}
