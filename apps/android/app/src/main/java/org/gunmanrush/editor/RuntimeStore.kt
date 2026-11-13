package org.gunmanrush.editor

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** Cache current-protocol behavior packs by identity; never translate old drafts. */
class RuntimeStore(private val context: Context) {
    private val root = File(context.filesDir, "runtimes").apply { mkdirs() }
    private val http = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(180, TimeUnit.SECONDS).build()
    private fun sha(file: File): String = MessageDigest.getInstance("SHA-256").let { digest -> file.inputStream().use { input -> val bytes=ByteArray(65536);while(true){val n=input.read(bytes);if(n<0)break;digest.update(bytes,0,n)} };digest.digest().joinToString(""){"%02x".format(it)} }
    private fun matches(meta: JSONObject, source: JSONObject): Boolean = meta.optInt("document_schema")==3 && (if(source.optString("behavior_hash").isNotEmpty()) meta.optString("behavior_hash")==source.getString("behavior_hash") else meta.optString("content_version")==source.getString("content_version"))
    private fun approved(url: String): Boolean = url.startsWith("https://github.com/zhipijun1996/gunman-rush/releases/download/")
    @Synchronized fun ensure(project: JSONObject): JSONObject {
        val source=project.getJSONObject("source")
        for(dir in root.listFiles()?:emptyArray()) { val manifest=File(dir,"manifest.json");if(manifest.exists()){val meta=runCatching{JSONObject(manifest.readText())}.getOrNull();if(meta!=null&&matches(meta,source)&&valid(dir,meta))return meta.put("local_pack",File(dir,"game.pck").absolutePath)} }
        try {
            val meta=context.assets.open("game/manifest.json").use{JSONObject(String(it.readBytes()))}
            if(matches(meta,source))return install(meta){target->context.assets.open("game/game.pck").use{input->target.outputStream().use{input.copyTo(it)}}}
        }catch(_:java.io.FileNotFoundException){}
        val incoming=project.optJSONObject("native_runtime")?:error("需要匹配的原生运行包，请导入完整游戏更新")
        check(matches(incoming,source)){"更新中的行为目录与运行包不匹配"}
        check(incoming.optString("engine")==BuildConfig.GODOT_VERSION){"此更新需要新版编辑器APK"}
        val url=incoming.optString("pck_url");check(approved(url)){"此版本尚未发布可下载运行包，请使用配套APK或正式更新包"}
        return install(incoming){target->http.newCall(Request.Builder().url(url).build()).execute().use{response->check(response.isSuccessful){"运行包下载失败（HTTP ${response.code}）"};response.body!!.byteStream().use{input->target.outputStream().use{output->val buf=ByteArray(65536);var total=0L;while(true){val n=input.read(buf);if(n<0)break;total+=n;check(total<=512L*1024*1024){"运行包超过下载上限"};output.write(buf,0,n)}}}}}
    }
    private fun valid(dir: File,meta: JSONObject): Boolean {
        val pack=File(dir,"game.pck");if(!pack.exists()||pack.length()!=meta.optLong("bytes"))return false
        val marker=File(dir,"verified.json")
        if(marker.exists()){val v=JSONObject(marker.readText());if(v.optString("sha256")==meta.optString("pck_sha256")&&v.optLong("modified")==pack.lastModified()&&v.optLong("bytes")==pack.length())return true}
        if(sha(pack)!=meta.optString("pck_sha256"))return false
        marker.writeText(JSONObject().put("sha256",meta.getString("pck_sha256")).put("modified",pack.lastModified()).put("bytes",pack.length()).toString());return true
    }
    private fun install(meta: JSONObject,copy: (File)->Unit): JSONObject {
        val hash=meta.getString("pck_sha256");check(hash.matches(Regex("[a-f0-9]{64}"))){"运行包身份无效"}
        val dir=File(root,hash).apply{mkdirs()};val temp=File(dir,"game.tmp")
        try{copy(temp);check(temp.length()==meta.getLong("bytes")&&sha(temp)==hash){"运行包大小或哈希不匹配"};check(temp.renameTo(File(dir,"game.pck")));File(dir,"manifest.json").writeText(meta.toString());check(valid(dir,meta));return JSONObject(meta.toString()).put("local_pack",File(dir,"game.pck").absolutePath)}catch(e:Exception){temp.delete();throw e}
    }
    fun latestProject(): JSONObject {
        val release=http.newCall(Request.Builder().url("https://api.github.com/repos/zhipijun1996/gunman-rush/releases/tags/editor-runtime").header("Accept","application/vnd.github+json").build()).execute().use{r->check(r.isSuccessful){"尚无可用编辑器更新（HTTP ${r.code}），可导入本地更新文件"};JSONObject(r.body!!.string())}
        val assets=release.getJSONArray("assets");var url="";for(i in 0 until assets.length()){val a=assets.getJSONObject(i);if(a.getString("name")=="editor-project.json")url=a.getString("browser_download_url")}
        check(approved(url)){"发行版缺少正式编辑器项目"}
        return http.newCall(Request.Builder().url(url).build()).execute().use{r->check(r.isSuccessful){"下载游戏目录失败"};val bytes=r.body!!.bytes();check(bytes.size<16*1024*1024){"更新目录过大"};JSONObject(String(bytes))}
    }
}
