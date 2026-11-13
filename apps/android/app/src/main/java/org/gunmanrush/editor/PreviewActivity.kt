package org.gunmanrush.editor

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.fragment.app.FragmentActivity
import org.godotengine.godot.Godot
import org.godotengine.godot.GodotFragment
import org.godotengine.godot.GodotHost
import java.io.File

class PreviewActivity : FragmentActivity(), GodotHost {
    private var fragment: GodotFragment? = null
    override fun getActivity(): Activity = this
    override fun getGodot(): Godot? = fragment?.godot
    override fun getCommandLine(): MutableList<String> = mutableListOf("--main-pack", org.json.JSONObject(File(filesDir, "editor-preview.json").readText()).getString("runtime_pack"), "--", "--editor-project=${File(filesDir, "editor-preview.json").absolutePath}")
    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        val root = FrameLayout(this)
        val container = FrameLayout(this).apply { id = 572101 }
        root.addView(container, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        fragment = supportFragmentManager.findFragmentById(container.id) as? GodotFragment
        if (fragment == null) { fragment = GodotFragment(); supportFragmentManager.beginTransaction().replace(container.id, fragment!!).commitNow() }
        val back = Button(this).apply { text = "返回工坊"; alpha = .85f; setOnClickListener { returnToEditor() } }
        root.addView(back, FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.END))
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) { override fun handleOnBackPressed() = returnToEditor() })
    }
    private fun returnToEditor() { startActivity(Intent(this, EditorActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }
    override fun onGodotForceQuit(instance: Godot?) { runOnUiThread { finish() } }
    override fun onGodotRestartRequested(instance: Godot?) { runOnUiThread { finish() } }
}
