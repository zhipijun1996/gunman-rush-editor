package org.gunmanrush.editor

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class PlanAI(private val auth: PlanAuth) {
    private val http = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(180, TimeUnit.SECONDS).build()
    fun models(): JSONArray = http.newCall(Request.Builder().url("https://api.openai.com/v1/models").header("Authorization", "Bearer ${auth.accessToken()}").build()).execute().use { r ->
        check(r.isSuccessful) { "无法读取套餐模型（HTTP ${r.code}）" }
        val data = JSONObject(r.body?.string() ?: error("模型目录为空")).getJSONArray("models")
        JSONArray().also { out -> for (i in 0 until data.length()) { val m = data.getJSONObject(i); if (m.optString("visibility") == "list") out.put(JSONObject().put("slug", m.getString("slug")).put("display_name", m.optString("display_name"))) } }
    }
    fun response(params: JSONObject): JSONObject {
        val payload = JSONObject().put("model", params.getString("model")).put("input", params.getJSONArray("input"))
            .put("tools", params.getJSONArray("tools")).put("store", false).put("stream", true)
        val body = payload.toString(); check(body.length < 8 * 1024 * 1024) { "本轮上下文过大，请缩小读取范围" }
        return http.newCall(Request.Builder().url("https://api.openai.com/v1/responses").header("Authorization", "Bearer ${auth.accessToken()}")
            .post(body.toRequestBody("application/json".toMediaType())).build()).execute().use { response ->
            check(response.isSuccessful) { "套餐AI请求失败（HTTP ${response.code}）；未改动草稿" }
            ResponseStream.read(response.body?.charStream() ?: error("AI响应为空"))
        }
    }
}
