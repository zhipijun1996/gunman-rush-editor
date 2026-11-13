package org.gunmanrush.editor

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Android browser/lifecycle adapter; protocol and retry have one owner. */
class PlanAuth(private val activity: Activity, vault: Vault) {
    private val flow = ChatGPTAuth(vault, { url ->
        val opened = CompletableFuture<Unit>()
        activity.runOnUiThread {
            try { CustomTabsIntent.Builder().build().launchUrl(activity, Uri.parse(url)); opened.complete(Unit) }
            catch (_: Exception) { opened.completeExceptionally(AuthFailure("BROWSER_UNAVAILABLE", "browser", true)) }
        }
        opened.get(15, TimeUnit.SECONDS)
    }, onCallbackReceived = { showEditor() })
    fun status() = flow.status()
    private fun showEditor() {
        activity.runOnUiThread { if (!activity.isDestroyed && !activity.isFinishing) activity.startActivity(Intent(activity, EditorActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
    }
    fun signIn() = flow.signIn().also { showEditor() }
    fun retryIdentity() = flow.retryIdentity().also { showEditor() }
    fun accessToken() = flow.accessToken()
    fun cancelPending() = flow.cancelPending()
    fun signOut() = flow.signOut()
}
