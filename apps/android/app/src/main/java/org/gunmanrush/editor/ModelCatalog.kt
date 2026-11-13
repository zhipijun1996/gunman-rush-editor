package org.gunmanrush.editor

import org.json.JSONArray
import org.json.JSONObject

/** Both the standard API directory and the plan directory keep their own IDs. */
object ModelCatalog {
    fun parse(root: JSONObject): JSONArray {
        val entries = root.optJSONArray("models") ?: root.optJSONArray("data")
            ?: error("模型目录格式无法识别；账号仍已保存，请重试连接检查")
        val output = JSONArray()
        val seen = mutableSetOf<String>()
        for (index in 0 until entries.length()) {
            val model = entries.optJSONObject(index) ?: continue
            if (model.has("visibility") && model.optString("visibility") != "list") continue
            val id = model.optString("slug").ifBlank { model.optString("id") }
            if (id.isNotBlank() && seen.add(id)) output.put(JSONObject().put("slug", id).put("display_name", model.optString("display_name").ifBlank { id }))
        }
        check(output.length() > 0) { "账号已保存，但没有返回可用模型；请重试连接检查" }
        return output
    }
}
