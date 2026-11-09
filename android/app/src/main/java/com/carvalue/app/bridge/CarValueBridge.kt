package com.carvalue.app.bridge

import android.util.Log
import android.webkit.JavascriptInterface
import com.carvalue.app.BuildConfig
import com.carvalue.app.navi.NaviGateway
import com.carvalue.app.vehicle.VehicleGateway
import com.carvalue.app.voice.VoiceGateway
import org.json.JSONObject

/**
 * JS → native half of the bridge, exposed as `window.CarValueNative` (contract: web/src/engine/native.ts).
 *
 * Methods run on the WebView's JavaBridge thread. Every method first checks that the top-level page is our
 * own `https://appassets.androidplatform.net` origin (Pleos WebView rule: minimal, guarded JS bridge).
 */
class CarValueBridge(
    private val vehicle: VehicleGateway,
    private val navi: NaviGateway,
    private val voice: VoiceGateway,
    private val location: com.carvalue.app.location.LocationGateway,
    private val isTrustedPage: () -> Boolean,
) {

    /** `{kind, value, reason}` → Vehicle SDK setter. False when unsupported/refused; SDK result goes to the trace. */
    /** True when the build has a public-data proxy (the web then reads live data through /pub/). */
    @JavascriptInterface
    fun publicData(): Boolean = BuildConfig.PUBLIC_PROXY.isNotEmpty()

    @JavascriptInterface
    fun act(json: String): Boolean {
        if (!isTrustedPage()) return false
        val action = runCatching { JSONObject(json) }.getOrNull() ?: return false
        val kind = action.optString("kind")
        val value = if (action.isNull("value")) null else action.opt("value")
        return vehicle.act(kind, value)
    }

    /** RestStop `{id, name, kind, highway, direction?, lngLat: [lng, lat], km}` → NaviHelper.addWaypoint. */
    @JavascriptInterface
    fun addWaypoint(json: String): Boolean {
        if (!isTrustedPage()) return false
        val stop = runCatching { JSONObject(json) }.getOrNull() ?: return false
        val lngLat = stop.optJSONArray("lngLat") ?: return false
        if (lngLat.length() < 2) return false
        val lng = lngLat.optDouble(0)
        val lat = lngLat.optDouble(1)
        if (lat.isNaN() || lng.isNaN()) return false
        val address = listOf(stop.optString("highway"), stop.optString("direction"))
            .filter { it.isNotBlank() }
            .joinToString(" ")
        val ok = navi.addWaypoint(
            lat = lat,
            lon = lng,
            name = stop.optString("name").ifBlank { "휴게소" },
            poiId = stop.optString("id"),
            address = address,
        )
        // Arrival / departure become exact geofence events instead of a gear-P guess.
        if (ok) location.watchStop(stop.optString("id"), lat, lng)
        return ok
    }

    /** Driver cancelled the rest stop: drop the navi waypoint and its geofence. */
    @JavascriptInterface
    fun removeWaypoint(): Boolean {
        if (!isTrustedPage()) return false
        location.clearWatch()
        return navi.removeWaypoint()
    }

    /** Planner candidate `{id, name, lngLat}` → NaviHelper.requestTrip (real ETA / SoC on arrival via onEvent). */
    @JavascriptInterface
    fun tripTo(json: String): Boolean {
        if (!isTrustedPage()) return false
        val stop = runCatching { JSONObject(json) }.getOrNull() ?: return false
        val lngLat = stop.optJSONArray("lngLat") ?: return false
        return navi.tripTo(lngLat.optDouble(1), lngLat.optDouble(0), stop.optString("name"), stop.optString("id"))
    }

    @JavascriptInterface
    fun searchPlace(keyword: String): Boolean {
        if (!isTrustedPage()) return false
        return navi.searchPlace(keyword.take(40))
    }

    @JavascriptInterface
    fun routeOption(option: String): Boolean {
        if (!isTrustedPage()) return false
        return navi.changeRouteOption(option)
    }

    @JavascriptInterface
    fun showChargers(): Boolean {
        if (!isTrustedPage()) return false
        return navi.showNearbyChargers()
    }

    @JavascriptInterface
    fun capabilities(): String {
        if (!isTrustedPage()) return "{}"
        return vehicle.capabilities()
            .put("navWaypoint", navi.connected)
            .put("tts", voice.ttsReady)
            .put("stt", voice.sttReady)
            .put("llm", false) // LLM SDK discontinued; Gleo is inbound-only
            .toString()
    }

    @JavascriptInterface
    fun speak(key: String, text: String) {
        if (!isTrustedPage()) return
        voice.speak(key, text)
    }

    @JavascriptInterface
    fun listen(requestId: String) {
        if (!isTrustedPage()) return
        voice.listen(requestId)
    }

    @JavascriptInterface
    fun log(msg: String) {
        if (!isTrustedPage()) return
        // Debug builds only: web logs may carry driving data (Pleos security guide: no PII in release logs).
        if (BuildConfig.DEBUG) Log.d("CvWeb", msg.take(MAX_LOG))
    }

    private companion object {
        const val MAX_LOG = 500
    }
}
