package com.carvalue.app.bridge

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * Native → JS half of the bridge. All calls end up on the main thread as `evaluateJavascript`
 * against `window.__cv` (installed by web/src/engine/native.ts when the runtime starts).
 *
 * SDK trace lines produced before the page has installed `__cv` are buffered and flushed once it exists.
 */
class WebChannel(private val webView: WebView) {

    private val main = Handler(Looper.getMainLooper())
    private var ready = false // main thread only
    private val pendingTraces = ArrayDeque<String>()

    init {
        active = WeakReference(this)
    }

    fun onPageStarted() {
        ready = false
    }

    fun pushSignals(json: String) = onMain {
        if (!ready) probeReady()
        eval("window.__cv&&window.__cv.onSignals(${q(json)})")
    }

    /** One-off native events (geofence, navi trip info, waypoint list, ...) → `window.__cv.onEvent(type, json)`. */
    fun pushEvent(type: String, payload: String) = onMain {
        eval("window.__cv&&window.__cv.onEvent&&window.__cv.onEvent(${q(type)},${q(payload)})")
    }

    fun pushSpeech(requestId: String, event: String, payload: String) = onMain {
        eval("window.__cv&&window.__cv.onSpeech(${q(requestId)},${q(event)},${q(payload)})")
    }

    fun pushTrace(line: String) = onMain {
        if (ready) {
            evalTrace(line)
        } else {
            pendingTraces.addLast(line)
            while (pendingTraces.size > MAX_PENDING_TRACES) pendingTraces.removeFirst()
        }
    }

    /**
     * Gleo action → `window.__cv.onGleo?.(json)`. If the handler synchronously returns a plain object
     * (`{status, message, data?, mode?}`), it is passed back as a JSON string; otherwise [onResult] gets null.
     */
    fun deliverGleo(json: String, onResult: (String?) -> Unit) = onMain {
        val script = """
            (function(){try{var k=window.__cv;if(!k||typeof k.onGleo!=='function')return null;
            var r=k.onGleo(${q(json)});
            return (r&&typeof r==='object'&&typeof r.then!=='function')?JSON.stringify(r):null;}catch(e){return null}})()
        """.trimIndent()
        webView.evaluateJavascript(script) { raw ->
            // evaluateJavascript hands back a JSON literal: "null" or a quoted string.
            val result = runCatching { JSONArray("[$raw]").opt(0) as? String }.getOrNull()
            onResult(result)
        }
    }

    fun detach() {
        if (active?.get() === this) active = null
    }

    private fun probeReady() {
        webView.evaluateJavascript("!!(window.__cv&&window.__cv.onSdkTrace)") { r ->
            if (r == "true" && !ready) {
                ready = true
                while (pendingTraces.isNotEmpty()) evalTrace(pendingTraces.removeFirst())
            }
        }
    }

    private fun evalTrace(line: String) = eval("window.__cv&&window.__cv.onSdkTrace(${q(line)})")

    private fun eval(script: String) = webView.evaluateJavascript(script, null)

    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
    }

    companion object {
        private const val MAX_PENDING_TRACES = 200

        /** The live channel, for components without an Activity reference (GleoReceiver). */
        @Volatile var active: WeakReference<WebChannel>? = null
            private set

        /** JS string literal (JSON-quoted, safe against quotes, newlines and </script>). */
        fun q(s: String): String = JSONObject.quote(s)
    }
}
