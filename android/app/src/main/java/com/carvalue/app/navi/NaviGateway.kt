package com.carvalue.app.navi

import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.WaypointIndex
import ai.pleos.playground.navi.data.CurrentLocationInfo
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.RequestWaypointInfo
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.data.RouteStateInfo
import ai.pleos.playground.navi.constants.RouteOption
import ai.pleos.playground.navi.data.WaypointChangedInfo
import ai.pleos.playground.navi.constants.NavigationStatus
import ai.pleos.playground.navi.data.CautionPoint
import ai.pleos.playground.navi.data.ChargerOperator
import ai.pleos.playground.navi.data.NavigationScreenRequest
import ai.pleos.playground.navi.data.RecentDestinationInfo
import ai.pleos.playground.navi.data.TBTInfo
import ai.pleos.playground.navi.data.TripInfo
import ai.pleos.playground.navi.data.TripRequest
import ai.pleos.playground.navi.data.WaypointArrivedInfo
import ai.pleos.playground.navi.data.WaypointInfo
import org.json.JSONArray
import org.json.JSONObject
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.carvalue.app.util.SdkTrace

/**
 * NaviHelper 3.0.5: rest-stop waypoints and route remaining distance / ETA.
 *
 * Getters return Unit; results arrive on [NaviHelperEventListener] (which events fire depends on the
 * Pleos Navigation app state). Coordinates are LATITUDE FIRST since 3.0.5 (the docs' Java samples are wrong).
 */
class NaviGateway(
    context: Context,
    private val onRoute: (remainingKm: Double?, etaMin: Double?) -> Unit,
    private val onLocation: (lat: Double, lon: Double, heading: Double) -> Unit,
    /** Continuous navi state for the fatigue engine (VehicleSignals keys). */
    private val onSignal: (key: String, value: Any?) -> Unit = { _, _ -> },
    /** One-off navi events for the web runtime (type, JSON payload). */
    private val onEvent: (type: String, payload: JSONObject) -> Unit = { _, _ -> },
) {
    private val helper = NaviHelper(context)
    private val main = Handler(Looper.getMainLooper())

    @Volatile var connected = false
        private set

    /** When FusedLocation is unavailable, navi's current-location events feed position/heading instead. */
    @Volatile var useAsLocationSource = false

    /** Whether route guidance is active (from RouteStateInfo / route events). A waypoint needs a route. */
    @Volatile private var routing = false
    private var cameraOverSpeed = 0
    private var overSpeedNow = false

    private val listener = object : NaviHelperEventListener {
        override fun onDestinationInfo(info: DestinationInfo) {
            // UNCERTAIN units (undocumented): remainDistance assumed metres, remainTime assumed seconds.
            onRoute(info.remainDistance / 1000.0, info.remainTime / 60.0)
        }

        override fun onRouteStateInfo(info: RouteStateInfo) {
            routing = info.isRouting
            if (!info.isRouting) onRoute(null, null)
        }

        override fun onRouteCancelled() { routing = false; onRoute(null, null) }
        override fun onRoutingCompleted() { routing = false; onRoute(null, null) }
        override fun onRouteStarted(info: ai.pleos.playground.navi.data.RouteStartInfo) { routing = true; refresh() }
        override fun onDestinationChanged() = refresh()

        override fun onWaypointChanged(info: WaypointChangedInfo) {
            SdkTrace.ok("NaviHelperEventListener.onWaypointChanged", "${info.index} ${info.cmdType}")
            refresh()
        }

        override fun onError(code: NaviErrorCode) {
            SdkTrace.line("NaviHelperEventListener.onError → $code")
        }

        override fun onCurrentLocationInfo(info: CurrentLocationInfo) {
            if (useAsLocationSource) onLocation(info.latitude, info.longitude, info.heading)
        }

        // Next manoeuvre: interventions that talk to the driver are held back right before a turn / exit.
        override fun onTBTInfo(list: List<TBTInfo>) {
            val next = list.firstOrNull()
            onSignal("tbtNextM", next?.distance)
            onSignal("tbtNext", next?.description?.takeIf { it.isNotBlank() })
        }

        // Accident-prone / fog / downhill / slippery stretches ahead raise the alerting sensitivity.
        override fun onCautionPointInfo(list: List<CautionPoint>) {
            val near = list.filter { it.type.name in RISK_POINTS && it.remainDistance in 0..3000 }.minByOrNull { it.remainDistance }
            onSignal("cautionType", near?.type?.name)
            onSignal("cautionM", near?.remainDistance)
        }

        override fun onWayPointInfo(list: List<WaypointInfo>) {
            onEvent("waypoints", JSONObject().put("items", JSONArray(list.map {
                JSONObject().put("name", it.name).put("poiId", it.poiId).put("lat", it.latitude).put("lon", it.longitude)
                    .put("remainKm", it.remainDistance / 1000.0).put("remainMin", it.remainTime / 60.0)
            })))
        }

        override fun onWayPointArrived(info: WaypointArrivedInfo) {
            SdkTrace.ok("NaviHelperEventListener.onWayPointArrived", info.name)
            onEvent("waypointArrived", JSONObject().put("name", info.name))
        }

        override fun onDestinationArrived(info: ai.pleos.playground.navi.data.DestinationArrivedInfo) {
            onEvent("destinationArrived", JSONObject().put("name", info.name))
        }

        // Real ETA, distance and state of charge on arrival for the rest stop the planner picked.
        override fun onTripInfo(info: TripInfo) {
            SdkTrace.ok("NaviHelperEventListener.onTripInfo", "${info.distance}m ${info.eta}s soc=${info.estimatedSocAtDest}")
            onEvent("tripInfo", JSONObject().put("poiId", lastTripPoi).put("distanceKm", info.distance / 1000.0)
                .put("etaMin", info.eta / 60.0).put("socAtDest", info.estimatedSocAtDest))
        }

        override fun onRecentDestinationInfo(list: List<RecentDestinationInfo>) {
            onEvent("recentDestinations", JSONObject().put("items", JSONArray(list.take(5).map {
                JSONObject().put("name", it.name).put("lat", it.latitude).put("lon", it.longitude)
            })))
        }

        /**
         * Navi's EV charging plan: a DC stop ahead (max charging power, target SoC). Lets the guard check battery
         * preconditioning before a winter fast charge.
         */
        override fun onDrivingInfo(info: ai.pleos.playground.navi.data.DrivingInfo) {
            val stops = listOf(info.destination) + info.waypoints
            val charge = stops.filter { it.isChargingStation }.maxByOrNull { it.maxChargingPower }
            onSignal("fastChargePlanned", charge != null && charge.maxChargingPower >= 50)
            onSignal("plannedChargeKw", charge?.maxChargingPower ?: 0)
            onSignal("plannedChargeKm", charge?.distance?.let { it / 1000.0 } ?: 0.0)
        }

        /** Section / point speed cameras: count each over-speed episode (habits: risk of an accident on record). */
        override fun onCameraAlert(list: List<ai.pleos.playground.navi.data.CameraAlert>) {
            val over = list.any { it.isOverSpeed || it.isOverSectionAvrSpeed }
            if (over && !overSpeedNow) onSignal("cameraOverSpeed", ++cameraOverSpeed)
            overSpeedNow = over
        }

        override fun onBookmarkInfo(list: List<ai.pleos.playground.navi.data.BookmarkInfo>) {
            SdkTrace.readOk("NaviHelper.onBookmarkInfo", "${list.size} bookmarks")
            // HOME anchors gentle overnight charging; EV_CHARGING_STATION bookmarks are the driver's usual chargers.
            val arr = org.json.JSONArray()
            for (b in list) arr.put(org.json.JSONObject().put("name", b.name).put("category", b.category.name).put("lat", b.latitude).put("lng", b.longitude))
            onEvent("bookmarks", org.json.JSONObject().put("items", arr))
        }

        override fun onChargerOperatorInfo(list: List<ChargerOperator>) {
            onEvent("chargerOperators", JSONObject().put("items", JSONArray(list.map { it.name })))
        }

        override fun onNavigationStatus(status: NavigationStatus) {
            onSignal("navStatus", status.name)
        }
    }

    @Volatile private var lastTripPoi = ""

    private val poll = object : Runnable {
        override fun run() {
            refresh()
            main.postDelayed(this, POLL_MS)
        }
    }

    fun start(onReady: (Boolean) -> Unit) {
        try {
            helper.initialize({
                connected = true
                SdkTrace.ok("NaviHelper.initialize()", "connected")
                helper.addListener(listener)
                main.post(poll)
                // Once per start: where the driver usually goes (trip length estimate) and the charger networks.
                runCatching { helper.getRecentDestinationInfo() }.onFailure { SdkTrace.fail("NaviHelper.getRecentDestinationInfo()", it) }
                runCatching { helper.getChargerOperatorInfo() }.onFailure { SdkTrace.fail("NaviHelper.getChargerOperatorInfo()", it) }
                runCatching { helper.getBookmarkInfo() }.onFailure { SdkTrace.fail("NaviHelper.getBookmarkInfo()", it) }
                onReady(true)
            }, { t: Throwable ->
                connected = false
                SdkTrace.fail("NaviHelper.initialize()", t)
                onReady(false)
            })
        } catch (t: Throwable) {
            SdkTrace.fail("NaviHelper.initialize()", t)
            onReady(false)
        }
    }

    fun refresh() {
        if (!connected) return
        runCatching {
            helper.getRouteStateInfo()
            helper.getDestinationInfo()
            if (routing) {
                helper.getTBTInfo()
                helper.getWaypointInfo()
            }
            if (useAsLocationSource) helper.getCurrentLocationInfo()
        }
    }

    /**
     * Adds a rest stop as the FIRST waypoint (max 2). Result arrives as onWaypointChanged / onError.
     * UNCERTAIN: whether the navi accepts our own stop id as poiId (the samples use a navi POI id).
     */
    fun addWaypoint(lat: Double, lon: Double, name: String, poiId: String, address: String): Boolean {
        val call = "NaviHelper.addWaypoint(RequestWaypointInfo(lat=%.5f, lon=%.5f, \"%s\", FIRST))".format(lat, lon, name)
        if (!connected) {
            SdkTrace.skip(call, "NaviHelper not connected")
            return false
        }
        if (!routing) return requestRouteTo(lat, lon, name, poiId, address)
        return try {
            helper.addWaypoint(
                // (latitude, longitude, poiName, waypointIndex, poiId, address, poiSubId, poiProvider)
                RequestWaypointInfo(lat, lon, name, WaypointIndex.FIRST, poiId, address, "0", ""),
            )
            SdkTrace.ok(call, "requested")
            true
        } catch (t: Throwable) {
            SdkTrace.fail(call, t)
            false
        }
    }

    /**
     * No active guidance (driving without a destination): a waypoint cannot be inserted, so the rest stop
     * becomes the destination instead. Verified on Pleos Connect emulator 2.1.0, where addWaypoint without
     * a route only opened the navigation home screen.
     */
    private fun requestRouteTo(lat: Double, lon: Double, name: String, poiId: String, address: String): Boolean {
        val call = "NaviHelper.requestRoute(RouteInfo(lat=%.5f, lon=%.5f, \"%s\", RECOMMENDED))".format(lat, lon, name)
        return try {
            // (latitude, longitude, displayLat, displayLon, poiName, poiId, address, poiSubId, routeOption, poiProvider, isMobileRequest)
            helper.requestRoute(RouteInfo(lat, lon, null, null, name, poiId, address, "0", RouteOption.RECOMMENDED, "", false))
            SdkTrace.ok(call, "requested (no active route → destination)")
            true
        } catch (t: Throwable) {
            SdkTrace.fail(call, t)
            false
        }
    }

    /** Driver declined / cancelled the rest stop after it was added. */
    fun removeWaypoint(): Boolean {
        val call = "NaviHelper.removeWaypoint(FIRST)"
        if (!connected || !routing) return SdkTrace.skip(call, "no active route").let { false }
        return runCatching { helper.removeWaypoint(WaypointIndex.FIRST); SdkTrace.ok(call, "requested"); true }
            .getOrElse { SdkTrace.fail(call, it); false }
    }

    /** Asks navi for the real ETA / distance / SoC on arrival to a candidate stop (answer: onTripInfo). */
    fun tripTo(lat: Double, lon: Double, name: String, poiId: String): Boolean {
        val call = "NaviHelper.requestTrip(TripRequest(%.5f, %.5f, \"%s\"))".format(lat, lon, name)
        if (!connected) return SdkTrace.skip(call, "NaviHelper not connected").let { false }
        lastTripPoi = poiId
        // (latitude, longitude, poiId, poiName, poiSubId)
        return runCatching { helper.requestTrip(TripRequest(lat, lon, poiId, name, "0")); SdkTrace.ok(call, "requested"); true }
            .getOrElse { SdkTrace.fail(call, it); false }
    }

    /** Low battery: open navi's nearby-charging list so the rest can double as a charging stop. */
    fun showNearbyChargers(): Boolean {
        val call = "NaviHelper.requestNavigationScreen(NearbyChargingStations)"
        if (!connected) return SdkTrace.skip(call, "NaviHelper not connected").let { false }
        return runCatching { helper.requestNavigationScreen(NavigationScreenRequest.NearbyChargingStations); SdkTrace.ok(call); true }
            .getOrElse { SdkTrace.fail(call, it); false }
    }

    /** Opens navi's place search, e.g. "블루핸즈" when a maintenance lamp comes on. */
    fun searchPlace(keyword: String): Boolean {
        val call = "NaviHelper.requestNavigationScreen(SearchPlace(\"$keyword\"))"
        if (!connected) return SdkTrace.skip(call, "NaviHelper not connected").let { false }
        return runCatching { helper.requestNavigationScreen(NavigationScreenRequest.SearchPlace(keyword)); SdkTrace.ok(call); true }
            .getOrElse { SdkTrace.fail(call, it); false }
    }

    /** Re-routes the active guidance with a route option (COMFORTABLE: fewer stop-and-go and sharp manoeuvres). */
    fun changeRouteOption(option: String): Boolean {
        val opt = runCatching { RouteOption.valueOf(option) }.getOrNull() ?: return false
        val call = "NaviHelper.changeRouteOption($opt)"
        if (!connected || !routing) return SdkTrace.skip(call, if (!connected) "NaviHelper not connected" else "no active route").let { false }
        return runCatching { helper.changeRouteOption(opt); SdkTrace.ok(call); true }
            .getOrElse { SdkTrace.fail(call, it); false }
    }

    fun release() {
        main.removeCallbacks(poll)
        runCatching { helper.removeListener(listener) }
        runCatching { helper.release() }
        connected = false
    }

    private companion object {
        const val POLL_MS = 10_000L
        val RISK_POINTS = setOf(
            "ACCIDENT_PRONE_AREA", "FOG_AREA", "DOWNHILL_CAUTION_AREA", "SLIPPERY_ROAD_ALERT",
            "WILDLIFE_CROSSING", "FALLING_ROCK_AREA", "WRONG_WAY_DRIVING_ALERT", "HIGHWAY_CONSTRUCTION",
        )
    }
}
