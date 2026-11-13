package org.gunmanrush.editor

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.*
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

class EditorActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var auth: PlanAuth
    private lateinit var ai: PlanAI
    private lateinit var runtimes: RuntimeStore
    private lateinit var github: GitHubSync
    private val executor = Executors.newFixedThreadPool(2)
    private var chooser: ValueCallback<Array<Uri>>? = null
    private var export: Pair<String, String>? = null
    private val chooseFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> chooser?.onReceiveValue(uri?.let { arrayOf(it) }); chooser = null }
    private val exportFile = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val pending = export; export = null
        if (pending != null) {
            if (uri == null) reply(pending.first, null, "导出已取消，草稿仍保存在本机")
            else try { contentResolver.openOutputStream(uri)!!.use { it.write(pending.second.toByteArray()) }; reply(pending.first, JSONObject().put("saved", true), null) }
            catch (_: Exception) { reply(pending.first, null, "导出失败，草稿仍保存在本机") }
        }
    }
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val vault=Vault(this);auth = PlanAuth(this, vault); ai = PlanAI(auth); runtimes=RuntimeStore(this);github=GitHubSync(vault)
        val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        web = WebView(this).apply {
            settings.javaScriptEnabled = true; settings.domStorageEnabled = true
            settings.allowFileAccess = false; settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.setSupportZoom(false)
            addJavascriptInterface(Bridge(), "GunmanNative")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) = loader.shouldInterceptRequest(request.url)
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (uri.scheme == "https" && uri.host == "appassets.androidplatform.net") return false
                    if (uri.scheme == "https") startActivity(Intent(Intent.ACTION_VIEW, uri))
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(view: WebView?, callback: ValueCallback<Array<Uri>>, params: FileChooserParams?): Boolean {
                    chooser?.onReceiveValue(null); chooser = callback; chooseFile.launch(arrayOf("application/json", "text/plain")); return true
                }
            }
        }
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/editor/index.html")
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) { override fun handleOnBackPressed() { moveTaskToBack(true) } })
    }
    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) web.post { web.evaluateJavascript("window.dispatchEvent(new Event('gunman:resume'));", null) }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent) }
    override fun onDestroy() { if (::ai.isInitialized) ai.close(); if (::auth.isInitialized) auth.cancelPending(); if (::web.isInitialized) web.destroy(); executor.shutdownNow(); super.onDestroy() }
    private fun reply(requestId: String, result: Any?, error: String?) {
        val payload = JSONObject().put("request_id", requestId)
        if (error == null) payload.put("result", result ?: JSONObject.NULL) else payload.put("error", error)
        runOnUiThread { if (!isFinishing) web.evaluateJavascript("window.__gunmanNativeResult(${payload});", null) }
    }
    inner class Bridge {
        @JavascriptInterface fun request(raw: String) {
            if (raw.length > 32 * 1024 * 1024) return
            val req = try { JSONObject(raw) } catch (_: Exception) { return }
            val requestId = req.optString("request_id"); if (requestId.length !in 1..100) return
            val params = req.optJSONObject("params") ?: JSONObject()
            if (req.optString("method") == "auth.cancel") { auth.cancelPending(); reply(requestId, JSONObject().put("cancelled", true), null); return }
            if (req.optString("method") == "request.cancel") { ai.cancel(params.optString("request_id")); reply(requestId, JSONObject().put("cancelled", true), null); return }
            if (req.optString("method") == "file.export") {
                runOnUiThread {
                    if (export != null) reply(requestId, null, "请先完成上一次导出")
                    else { export = requestId to params.get("value").toString(); exportFile.launch(params.optString("name", "world-draft.json").substringAfterLast('/')) }
                }; return
            }
            executor.execute {
                try {
                    val result: Any = when (req.optString("method")) {
                        "auth.signIn" -> auth.signIn()
                        "auth.status" -> auth.status()
                        "auth.retry" -> auth.retryIdentity()
                        "auth.signOut" -> auth.signOut()
                        "ai.models" -> ai.models()
                        "ai.response" -> ai.response(params, requestId)
                        "preview.open" -> openPreview(params)
                        "runtime.ensure" -> runtimes.ensure(params.getJSONObject("project")).apply { remove("local_pack") }
                        "game.latest" -> runtimes.latestProject()
                        "github.connect" -> github.connect(params)
                        "github.disconnect" -> github.disconnect()
                        "github.submit" -> github.submit(params)
                        else -> error("未知原生操作")
                    }
                    reply(requestId, result, null)
                } catch (error: Exception) { reply(requestId, null, error.message ?: "操作未完成，草稿未改变") }
            }
        }
    }
    private fun openPreview(params: JSONObject): JSONObject {
        val project = params.getJSONObject("project")
        check(project.getInt("schema") == 3) { "预览数据版本不兼容" }
        val meta=runtimes.ensure(project)
        val previous=File(filesDir,"editor-preview.json")
        val oldPack=if(previous.exists())runCatching{JSONObject(previous.readText()).optString("runtime_pack")}.getOrNull() else null
        if(oldPack!=null&&oldPack!=meta.getString("local_pack")){
            val manager=getSystemService(ACTIVITY_SERVICE) as android.app.ActivityManager
            for(process in manager.runningAppProcesses?:emptyList())if(process.uid==applicationInfo.uid&&process.processName==packageName+":preview")android.os.Process.killProcess(process.pid)
        }
        params.put("runtime_pack",meta.getString("local_pack"))
        params.put("verified_behavior_hash",meta.optString("behavior_hash"))
        val requestFile = File(filesDir, "editor-preview.json")
        val pending = File(filesDir, "editor-preview.tmp"); pending.writeText(params.toString()); check(pending.renameTo(requestFile))
        val marker = File(filesDir, "editor-preview.marker.tmp"); marker.writeText(java.util.UUID.randomUUID().toString()); check(marker.renameTo(File(filesDir, "editor-preview.json.marker")))
        runOnUiThread { startActivity(Intent(this, PreviewActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }
        return JSONObject().put("started", true).put("native", true)
    }
}
