package com.carvalue.app.location

import ai.pleos.playground.location.fused.FusedLocation
import ai.pleos.playground.location.fused.listener.FusedLocationListener
import ai.pleos.playground.location.fused.model.LocationData
import android.content.Context
import ai.pleos.playground.location.fused.listener.ProximityAlertListener
import ai.pleos.playground.location.fused.model.ProximityAlertEvent
import ai.pleos.playground.location.fused.model.ProximityAlertRequest
import ai.pleos.playground.location.fused.model.ProximityTransition
import com.carvalue.app.util.SdkTrace
import com.carvalue.app.util.errorName

/**
 * FusedLocation 1.1.3 → position [lng, lat] and heading for the web engine.
 * Needs the runtime grant of `pleos.car.permission.FUSED_LOCATION` (dangerous); start after it is granted.
 * LocationData has no speed field. Coordinates are never written to the SDK trace (PII).
 */
class LocationGateway(
    context: Context,
    private val onLocation: (lat: Double, lon: Double, heading: Double) -> Unit,
    /** Geofence transitions around the accepted rest stop: (stopId, "ENTER" | "EXIT"). */
    private val onGeofence: (stopId: String, transition: String) -> Unit = { _, _ -> },
) {

    private val fused = FusedLocation(context)
    private var registered = false

    private val listener = object : FusedLocationListener {
        override fun onChanged(location: LocationData?) {
            location ?: return
            onLocation(location.latitude, location.longitude, location.heading.toDouble())
        }

        override fun onError(exception: Exception) {
            SdkTrace.readFail("FusedLocation.onChanged", exception)
        }
    }

    /** Returns false when FusedLocation is not supported on this car (caller may fall back to navi). */
    fun start(): Boolean {
        if (registered) return true
        return try {
            if (!fused.isSupported()) {
                SdkTrace.skip("FusedLocation.registerFusedLocationCallback", "isSupported() == false")
                return false
            }
            fused.initialize()
            fused.getLastKnownLocation(listener)
            fused.registerFusedLocationCallback(listener)
            registered = true
            SdkTrace.ok("FusedLocation.registerFusedLocationCallback")
            true
        } catch (t: Throwable) {
            SdkTrace.line("FusedLocation.registerFusedLocationCallback → FAILED ${t.errorName()}")
            false
        }
    }

    // ---- rest-stop geofence (FusedLocation ProximityAlert) -------------------------------------------------

    private var alertId: String? = null
    private var watchedStop = ""

    private val proximity = object : ProximityAlertListener {
        override fun onRegistered(id: String) {
            alertId = id
            SdkTrace.ok("FusedLocation.addProximityAlert", "alertId=$id stop=$watchedStop")
        }

        override fun onTransition(event: ProximityAlertEvent) {
            SdkTrace.ok("ProximityAlertListener.onTransition", "${event.transition} $watchedStop")
            onGeofence(watchedStop, event.transition.name)
        }

        override fun onError(exception: Exception) {
            SdkTrace.fail("FusedLocation.addProximityAlert", exception)
        }
    }

    /**
     * Arms a geofence on the accepted rest stop so arrival (ENTER) and departure (EXIT) are known exactly,
     * instead of being inferred from gear P. Replaces any previous geofence.
     */
    fun watchStop(stopId: String, lat: Double, lon: Double, radiusM: Float = STOP_RADIUS_M): Boolean {
        clearWatch()
        watchedStop = stopId
        return try {
            if (!registered) fused.initialize()
            fused.addProximityAlert(ProximityAlertRequest(lat, lon, radiusM, setOf(ProximityTransition.ENTER, ProximityTransition.EXIT)), proximity)
            true
        } catch (t: Throwable) {
            SdkTrace.fail("FusedLocation.addProximityAlert", t)
            false
        }
    }

    fun clearWatch() {
        alertId?.let { id -> runCatching { fused.removeProximityAlert(id) }.onSuccess { SdkTrace.ok("FusedLocation.removeProximityAlert", id) } }
        alertId = null
    }

    fun release() {
        clearWatch()
        if (registered) runCatching { fused.unregisterFusedLocationCallback(listener) }
        registered = false
        runCatching { fused.release() }
    }

    private companion object {
        /** Rest areas are large; 400 m catches the ramp without firing on the main carriageway. */
        const val STOP_RADIUS_M = 400f
    }
}
