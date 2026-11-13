package org.gunmanrush.editor

import org.json.JSONObject
import java.io.Reader

/** Do not accept output_text or a partial function call as a completed answer. */
object ResponseStream {
    fun read(input: Reader, maxCharacters: Int = 24 * 1024 * 1024): JSONObject {
        var count = 0
        var completed: JSONObject? = null
        val data = StringBuilder()
        fun event() {
            if (data.isEmpty()) return
            val value = data.toString(); data.setLength(0)
            if (value == "[DONE]") return
            val json = JSONObject(value)
            when (json.optString("type")) {
                "response.completed" -> completed = json.getJSONObject("response")
                "response.failed", "response.incomplete" -> error("AI未完成：${json.optJSONObject("response")?.optJSONObject("error")?.optString("code") ?: "incomplete"}，未采用任何候选")
                "error" -> error("AI请求失败，未采用任何候选")
            }
        }
        input.buffered().useLines { lines -> lines.forEach { line ->
            count += line.length; check(count <= maxCharacters) { "AI响应过大" }
            if (line.isEmpty()) event()
            else if (line.startsWith("data:")) { if (data.isNotEmpty()) data.append('\n'); data.append(line.substring(5).trimStart()) }
        } }
        event()
        return completed ?: error("AI连接中断，未采用任何候选")
    }
}
