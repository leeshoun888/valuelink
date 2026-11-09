package com.carvalue.app.gleo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import com.carvalue.app.bridge.WebChannel
import com.carvalue.app.util.SdkTrace
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Gleo Interface (assets/schema.json, component = "service" → broadcast).
 *
 * Gleo sends an Intent whose action is the function name and whose `ACTION_PARAM` extra is a JSON string.
 * We forward `{functionName, params}` to `window.__cv.onGleo?.(json)`; if the web handler synchronously
 * returns `{status, message, data?, mode?}` we relay it, otherwise a safe default. The reply must go out as
 * the APP_ACTION_RESPONSE broadcast within 7 s, so we answer at the latest after [REPLY_DEADLINE_MS].
 */
class GleoReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val function = intent.action?.takeIf { it in FUNCTIONS } ?: return
        val params = intent.getStringExtra(EXTRA_PARAM)
            ?.let { runCatching { JSONObject(it) }.getOrNull() }
            ?: JSONObject()
        SdkTrace.line("Gleo → $function ${params.keys().asSequence().toList()}")

        val app = context.applicationContext
        val pending = goAsync()
        val replied = AtomicBoolean(false)
        val main = Handler(Looper.getMainLooper())
        val reply = { r: JSONObject ->
            if (replied.compareAndSet(false, true)) {
                main.removeCallbacksAndMessages(null)
                send(app, r)
                pending.finish()
            }
        }

        val channel = WebChannel.active?.get()
        if (channel == null) {
            reply(response(function, "fail", "Please open ValueLink first, then ask again."))
            return
        }
        main.postDelayed({ reply(fallback(function)) }, REPLY_DEADLINE_MS)
        val payload = JSONObject().put("functionName", function).put("params", params)
        channel.deliverGleo(payload.toString()) { result ->
            reply(result?.let { fromWeb(function, it) } ?: fallback(function))
        }
    }

    private fun send(context: Context, response: JSONObject) {
        // UNCERTAIN: the docs show an implicit broadcast with no target package or permission.
        val intent = Intent(ACTION_RESPONSE)
            .putExtra("packageName", context.packageName)
            .putExtra("response", response.toString())
        context.sendBroadcast(intent)
        SdkTrace.ok("Gleo APP_ACTION_RESPONSE(${response.optString("functionName")})", response.optString("status"))
    }

    /** Normalises the web handler's object into the Gleo response schema. */
    private fun fromWeb(function: String, json: String): JSONObject? {
        val o = runCatching { JSONObject(json) }.getOrNull() ?: return null
        val status = o.optString("status").takeIf { it in STATUSES } ?: return null
        val message = o.optString("message").takeIf { it.isNotBlank() } ?: return null
        return response(function, status, message).apply {
            when (val data = o.opt("data")) {
                is JSONArray -> put("data", data.toString())
                is JSONObject -> put("data", JSONArray().put(data).toString())
                is String -> if (data.isNotBlank()) put("data", data)
            }
            o.optString("mode").takeIf { it in MODES }?.let { put("mode", it) }
        }
    }

    private fun fallback(function: String): JSONObject = when (function) {
        "GET_CAR_VALUE" -> response(function, "fail", "ValueLink has not valued the car yet.")
        "GET_BATTERY_HEALTH" -> response(function, "fail", "ValueLink could not read the battery health yet.")
        "SET_CHARGE_LIMIT" -> response(function, "fail", "ValueLink could not change the charging limit right now.")
        "FIND_SERVICE_CENTER" -> response(function, "fail", "ValueLink could not open the service center search.")
        else -> response(function, "fail", "A trade-in quote is available only while parked.")
    }

    private fun response(function: String, status: String, message: String) = JSONObject()
        .put("functionName", function)
        .put("status", status)
        .put("message", message)

    private companion object {
        const val ACTION_RESPONSE = "ai.pleos.playground.intent.action.APP_ACTION_RESPONSE"
        const val EXTRA_PARAM = "ACTION_PARAM"
        const val REPLY_DEADLINE_MS = 5_500L // Gleo times out at 7 s
        val FUNCTIONS = setOf("GET_CAR_VALUE", "GET_BATTERY_HEALTH", "SET_CHARGE_LIMIT", "FIND_SERVICE_CENTER", "GET_TRADE_IN_QUOTE", "GET_PARKING_RISK")
        val STATUSES = setOf("success", "asking", "fail")
        val MODES = setOf("voice", "beep", "silent")
    }
}
