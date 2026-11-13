package org.gunmanrush.editor

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64
import java.util.UUID
import java.util.concurrent.TimeUnit

/** GitHub credentials are independent of the ChatGPT account and kept locally. */
class GitHubSync(private val vault: Vault) {
    private val http=OkHttpClient.Builder().connectTimeout(20,TimeUnit.SECONDS).readTimeout(120,TimeUnit.SECONDS).build()
    private val repo="zhipijun1996/gunman-rush"
    private fun call(path:String,method:String="GET",body:JSONObject?=null):JSONObject {
        val token=vault.read("github")?.getString("token")?:error("请先在同步设置中连接GitHub")
        val request=Request.Builder().url("https://api.github.com/repos/$repo/$path").header("Authorization","Bearer $token").header("Accept","application/vnd.github+json")
        if(method!="GET")request.method(method,(body?:JSONObject()).toString().toRequestBody("application/json".toMediaType()))
        return http.newCall(request.build()).execute().use{r->check(r.isSuccessful){"GitHub同步失败（HTTP ${r.code}）；检查仓库权限及主游戏编辑器协议是否已合入"};val text=r.body?.string();if(text.isNullOrBlank())JSONObject() else JSONObject(text)}
    }
    fun connect(params:JSONObject):JSONObject {val token=params.getString("token").trim();check(token.length>20){"GitHub令牌格式不正确"};vault.write("github",JSONObject().put("token",token));try{call("");return JSONObject().put("connected",true)}catch(e:Exception){vault.remove("github");throw e}}
    fun disconnect():JSONObject {vault.remove("github");return JSONObject().put("connected",false)}
    fun submit(params:JSONObject):JSONObject {
        val change=params.getJSONObject("change");check(change.getInt("schema")==3){"定稿包版本不正确"}
        call("actions/workflows/editor-import.yml")
        val branch="editor/"+UUID.randomUUID()
        val head=call("git/ref/heads/main").getJSONObject("object").getString("sha")
        val baseTree=call("git/commits/$head").getJSONObject("tree").getString("sha")
        val bytes=change.toString().toByteArray();check(bytes.size<24*1024*1024){"定稿包过大，请缩小范围"}
        val blob=call("git/blobs","POST",JSONObject().put("content",Base64.getEncoder().encodeToString(bytes)).put("encoding","base64")).getString("sha")
        val tree=call("git/trees","POST",JSONObject().put("base_tree",baseTree).put("tree",JSONArray().put(JSONObject().put("path",".editor/submission.json").put("mode","100644").put("type","blob").put("sha",blob)))).getString("sha")
        val commit=call("git/commits","POST",JSONObject().put("message","准备世界工坊定稿（待原编译器验证）").put("tree",tree).put("parents",JSONArray().put(head))).getString("sha")
        call("git/refs","POST",JSONObject().put("ref","refs/heads/$branch").put("sha",commit))
        val pr=call("pulls","POST",JSONObject().put("title","世界工坊定稿：${change.getJSONArray("selected_rooms").length()}间房").put("head",branch).put("base","main").put("draft",true).put("body","选区及必要门对／奖励依赖的定稿。源编译与组件验证完成前保持草稿PR；不会自动合并main。"))
        call("actions/workflows/editor-import.yml/dispatches","POST",JSONObject().put("ref",branch).put("inputs",JSONObject().put("submission",".editor/submission.json")))
        return JSONObject().put("branch",branch).put("pr_url",pr.getString("html_url")).put("workflow_url","https://github.com/$repo/actions/workflows/editor-import.yml").put("message","已创建草稿PR；源校验后转为待审，不合并main")
    }
}
