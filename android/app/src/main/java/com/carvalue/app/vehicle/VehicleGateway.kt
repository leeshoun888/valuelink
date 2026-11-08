package com.carvalue.app.vehicle

import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.area.DoorArea
import ai.pleos.playground.vehicle.api.model.area.SeatArea
import ai.pleos.playground.vehicle.api.model.area.WindowArea
import ai.pleos.playground.vehicle.api.model.capability.AccessType
import ai.pleos.playground.vehicle.api.model.capability.AreaBounds
import ai.pleos.playground.vehicle.api.model.capability.CapabilityConfig
import ai.pleos.playground.vehicle.api.model.telltale.Telltales
import ai.pleos.playground.vehicle.constant.area.SeatValue
import ai.pleos.playground.vehicle.constant.control.LightSwitch
import ai.pleos.playground.vehicle.constant.control.MoveControl
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.carvalue.app.util.Barrier
import com.carvalue.app.util.SdkTrace
import com.carvalue.app.util.errorName
import com.carvalue.app.util.label
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.roundToInt

/**
 * Pleos Vehicle SDK 2.3.2: capability discovery at startup, then `act()` maps the value engine's
 * "guard" actions to setters.
 *
 * Guard actions (all verified on Pleos Connect emulator 2.1.0 unless noted):
 * - chargeLimit   EvBattery.setEvChargePercentLimit       80 % for daily use, 100 % only before a long trip
 * - chargeCurrent EvBattery.setEvChargeCurrentDrawLimit   gentle overnight AC charging at home
 * - closeWindows  Window.setWindowPosition (every area)   rain on an open cabin while parked
 * - lightsAuto    Light.setLowBeamLightSwitch(AUTOMATIC)  headlights left on in P drain the 12 V battery
 * - lockDoors     Door.setDoorLock (capability areas)     parked and unlocked
 * - blind         Window.moveWindowBlind                  sun on a parked cabin (interior UV / heat)
 * - ambient       Light.setAmbient*                       a short glow when the car protected its value
 *
 * Every setter is gated on a cached capability with WRITE access. CONTROL_CAR_* permissions need App Market
 * approval, so `act()` returns false when unsupported and the web falls back to a spoken suggestion.
 * Cabin-moving actions (windows, doors, blind, lights) are refused unless the car is confirmed parked.
 */
class VehicleGateway(context: Context, private val isParked: () -> Boolean) {

    val vehicle = Vehicle(context)
    private val main = Handler(Looper.getMainLooper())

    private val ev get() = vehicle.getEvBattery()
    private val light get() = vehicle.getLight()
    private val window get() = vehicle.getWindow()
    private val door get() = vehicle.getDoor()

    // Capability cache (written on SDK callback threads, read on the JS bridge thread).
    @Volatile private var chargeLimitSteps: List<Float> = emptyList()
    @Volatile private var chargeLimitWritable = false
    @Volatile private var chargeCurrentSteps: List<Float> = emptyList()
    @Volatile private var chargeCurrentWritable = false
    @Volatile private var windowBounds: Map<WindowArea, AreaBounds<Int>> = emptyMap()
    @Volatile private var lockAreas: List<DoorArea> = emptyList()
    @Volatile private var lowBeamSwitches: List<LightSwitch> = emptyList()
    @Volatile private var blindAreas: List<WindowArea> = emptyList()
    @Volatile private var ambientBrightness: Map<SeatArea, AreaBounds<Int>> = emptyMap()
    @Volatile private var ambientColorAreas: List<SeatArea> = emptyList()
    @Volatile var telltalesReadable = false
        private set

    private val autoColorDisabled = AtomicBoolean(false)

    fun start() {
        try {
            vehicle.initialize()
            SdkTrace.ok("Vehicle.initialize()")
        } catch (t: Throwable) {
            SdkTrace.fail("Vehicle.initialize()", t)
        }
    }

    fun release() {
        runCatching { vehicle.release() }
    }

    // ---- capabilities -------------------------------------------------------------------------------------

    /** Number of [Barrier.arrive] calls [probe] will make. */
    val probeCount = 9

    fun probe(barrier: Barrier) {
        check("EvBattery.checkEvChargePercentLimitCapabilities", barrier) { done, fail ->
            ev.checkEvChargePercentLimitCapabilities({ cfg: CapabilityConfig, steps: List<Float> ->
                chargeLimitWritable = cfg.writable
                chargeLimitSteps = steps
                done(cfg.summary(steps))
            }, fail)
        }
        check("EvBattery.checkEvChargeCurrentDrawLimitCapabilities", barrier) { done, fail ->
            ev.checkEvChargeCurrentDrawLimitCapabilities({ cfg: CapabilityConfig, steps: List<Float> ->
                chargeCurrentWritable = cfg.writable
                chargeCurrentSteps = steps
                done(cfg.summary(steps))
            }, fail)
        }
        check("Window.checkWindowPositionCapabilities", barrier) { done, fail ->
            window.checkWindowPositionCapabilities({ cfg: CapabilityConfig, bounds: Map<WindowArea, AreaBounds<Int>> ->
                if (cfg.writable) windowBounds = bounds
                done(cfg.summary(bounds.entries.map { "${it.key.label()}=${it.value.minValue}..${it.value.maxValue}" }))
            }, fail)
        }
        check("Door.checkDoorLockCapabilities", barrier) { done, fail ->
            door.checkDoorLockCapabilities({ cfg: CapabilityConfig, areas: List<DoorArea> ->
                // The emulator also reports the HOOD as a lockable area; only cabin doors are locked.
                if (cfg.writable) lockAreas = areas.filter { a -> a.values.none { it.name == "HOOD" } }
                done(cfg.summary(areas.map { it.values.joinToString("+") }))
            }, fail)
        }
        check("Light.checkLowBeamLightSwitchCapabilities", barrier) { done, fail ->
            light.checkLowBeamLightSwitchCapabilities({ cfg: CapabilityConfig, switches: List<LightSwitch> ->
                if (cfg.writable) lowBeamSwitches = switches
                done(cfg.summary(switches))
            }, fail)
        }
        check("Window.checkMoveWindowBlindCapabilities", barrier) { done, fail ->
            window.checkMoveWindowBlindCapabilities({ cfg: CapabilityConfig, areas: List<WindowArea> ->
                if (cfg.writable) blindAreas = areas
                done(cfg.summary(areas.map { it.label() }))
            }, fail)
        }
        check("Light.checkAmbientLightBrightnessCapabilities", barrier) { done, fail ->
            light.checkAmbientLightBrightnessCapabilities({ cfg: CapabilityConfig, bounds: Map<SeatArea, AreaBounds<Int>> ->
                if (cfg.writable) ambientBrightness = bounds
                done(cfg.summary(bounds.keys.map { it.label() }))
            }, fail)
        }
        check("Light.checkAmbientLightBrightnessColorCapabilities", barrier) { done, fail ->
            light.checkAmbientLightBrightnessColorCapabilities({ cfg: CapabilityConfig, areas: List<SeatArea> ->
                if (cfg.writable) ambientColorAreas = areas
                done(cfg.summary(areas.map { it.label() }))
            }, fail)
        }
        // checkTelltalesCapabilities needs PRIVATE_CAR_SAFETY, so a successful poll is the capability test.
        check("Safety.getTelltalesInfo", barrier) { done, fail ->
            vehicle.getSafety().getTelltalesInfo({ t: Telltales? ->
                telltalesReadable = true
                done("${t?.telltales?.size ?: 0} telltales")
            }, fail)
        }
    }

    fun capabilities(): JSONObject = JSONObject()
        .put("chargeLimit", chargeLimitWritable)
        .put("chargeCurrent", chargeCurrentWritable)
        .put("window", windowBounds.isNotEmpty())
        .put("doorLock", lockAreas.isNotEmpty())
        .put("headlights", LightSwitch.AUTOMATIC in lowBeamSwitches || LightSwitch.OFF in lowBeamSwitches)
        .put("blind", blindAreas.isNotEmpty())
        .put("ambientLight", ambientBrightness.isNotEmpty() || ambientColorAreas.isNotEmpty())
        .put("telltales", telltalesReadable)

    /**
     * Runs one capability call; retries ERROR_SERVICE_CONNECTION_FAILURE because `initialize()` has no
     * connected callback and the first IPC can race the service bind.
     */
    private fun check(
        call: String,
        barrier: Barrier,
        attempt: Int = 0,
        run: (done: (String) -> Unit, fail: (Exception) -> Unit) -> Unit,
    ) {
        val arrived = AtomicBoolean(false)
        val arrive = { if (arrived.compareAndSet(false, true)) barrier.arrive() }
        val fail: (Exception) -> Unit = { e ->
            SdkTrace.fail(call, e)
            if (e.errorName() == "ERROR_SERVICE_CONNECTION_FAILURE" && attempt < MAX_RETRIES) {
                main.postDelayed({ check(call, barrier, attempt + 1, run) }, RETRY_DELAY_MS)
            } else {
                arrive()
            }
        }
        try {
            run({ summary -> SdkTrace.ok(call, summary); arrive() }, fail)
        } catch (t: Throwable) {
            SdkTrace.fail(call, t)
            arrive()
        }
    }

    // ---- actions ------------------------------------------------------------------------------------------

    /** Returns true when the request was dispatched to the SDK; the SDK outcome arrives in the trace. */
    fun act(kind: String, value: Any?): Boolean = try {
        when (kind) {
            "chargeLimit" -> value.asDouble()?.let(::setChargeLimit) ?: invalid(kind, value)
            "chargeCurrent" -> value.asDouble()?.let(::setChargeCurrent) ?: invalid(kind, value)
            "closeWindows" -> parkedOnly(kind) { closeWindows() }
            "lightsAuto" -> parkedOnly(kind) { lightsAuto() }
            "lockDoors" -> parkedOnly(kind) { lockDoors() }
            "blind" -> parkedOnly(kind) { blind(close = value == "close" || value == true) }
            "ambient" -> (value as? JSONObject)?.let(::setAmbient) ?: invalid(kind, value)
            else -> {
                SdkTrace.skip("act($kind)", "unknown action")
                false
            }
        }
    } catch (t: Throwable) { // SecurityException when a permission is not granted, IPC errors, ...
        SdkTrace.fail("act($kind)", t)
        false
    }

    private inline fun parkedOnly(kind: String, block: () -> Boolean): Boolean {
        if (isParked()) return block()
        SdkTrace.skip("act($kind)", "vehicle not confirmed parked (gear P / speed 0)")
        return false
    }

    /** Snaps to the closest supported step when the capability lists discrete values. */
    private fun snap(v: Float, steps: List<Float>) = steps.minByOrNull { kotlin.math.abs(it - v) } ?: v

    private fun setChargeLimit(pct: Double): Boolean {
        if (!chargeLimitWritable) return unsupported("EvBattery.setEvChargePercentLimit")
        val v = snap(pct.toFloat().coerceIn(50f, 100f), chargeLimitSteps)
        val call = "EvBattery.setEvChargePercentLimit($v)"
        ev.setEvChargePercentLimit(v, { r: Float? -> SdkTrace.ok(call, "now $r %") }, { e -> SdkTrace.fail(call, e) })
        return true
    }

    private fun setChargeCurrent(amps: Double): Boolean {
        if (!chargeCurrentWritable) return unsupported("EvBattery.setEvChargeCurrentDrawLimit")
        // Pleos reports the supported maximum (emulator: [48.0]) rather than a list of steps.
        val max = chargeCurrentSteps.maxOrNull() ?: 48f
        val v = amps.toFloat().coerceIn(6f, max)
        val call = "EvBattery.setEvChargeCurrentDrawLimit($v)"
        ev.setEvChargeCurrentDrawLimit(v, { r: Float? -> SdkTrace.ok(call, "now $r A") }, { e -> SdkTrace.fail(call, e) })
        return true
    }

    /** Fully closes every window whose capability is writable (assumes minValue = closed, as on the VC). */
    private fun closeWindows(): Boolean {
        if (windowBounds.isEmpty()) return unsupported("Window.setWindowPosition")
        for ((area, b) in windowBounds) {
            val call = "Window.setWindowPosition(${area.label()}, ${b.minValue})"
            window.setWindowPosition(area, b.minValue, { _: WindowArea?, _: Int? -> SdkTrace.ok(call) }, { e -> SdkTrace.fail(call, e) })
        }
        return true
    }

    private fun lightsAuto(): Boolean {
        val target = when {
            LightSwitch.AUTOMATIC in lowBeamSwitches -> LightSwitch.AUTOMATIC
            LightSwitch.OFF in lowBeamSwitches -> LightSwitch.OFF
            else -> return unsupported("Light.setLowBeamLightSwitch")
        }
        val call = "Light.setLowBeamLightSwitch($target)"
        light.setLowBeamLightSwitch(target, { _: LightSwitch? -> SdkTrace.ok(call) }, { e -> SdkTrace.fail(call, e) })
        return true
    }

    private fun lockDoors(): Boolean {
        if (lockAreas.isEmpty()) return unsupported("Door.setDoorLock")
        for (area in lockAreas) {
            val call = "Door.setDoorLock(${area.values.joinToString("+")}, true)"
            door.setDoorLock(area, true, { _: DoorArea?, _: Boolean? -> SdkTrace.ok(call) }, { e -> SdkTrace.fail(call, e) })
        }
        return true
    }

    /** Roof / rear blind. UNCERTAIN: FORWARD is assumed to close (extend) the blind; a timed jog, then STOP. */
    private fun blind(close: Boolean): Boolean {
        val area = blindAreas.firstOrNull() ?: return unsupported("Window.moveWindowBlind")
        val dir = if (close) MoveControl.FORWARD else MoveControl.BACKWARD
        val call = "Window.moveWindowBlind(${area.label()}, $dir)"
        window.moveWindowBlind(area, dir, { _: WindowArea?, _: MoveControl? -> SdkTrace.ok(call) }, { e -> SdkTrace.fail(call, e) })
        main.postDelayed({
            val stop = "Window.moveWindowBlind(${area.label()}, STOP)"
            window.moveWindowBlind(area, MoveControl.STOP, { _: WindowArea?, _: MoveControl? -> SdkTrace.ok(stop) }, { e -> SdkTrace.fail(stop, e) })
        }, BLIND_JOG_MS)
        return true
    }

    /** value = { color: '#RRGGBB', brightness: 0..100 } */
    private fun setAmbient(value: JSONObject): Boolean {
        val area = (ambientBrightness.keys + ambientColorAreas).pickDriver() ?: return unsupported("Light.setAmbientLight*")
        val brightness = value.optDouble("brightness", Double.NaN)
        var dispatched = false
        if (autoColorDisabled.compareAndSet(false, true)) {
            val call = "Light.setAmbientColorAutoByDriveModeEnabled(false)"
            light.setAmbientColorAutoByDriveModeEnabled(false, { _: Boolean? -> SdkTrace.ok(call) }, { e -> SdkTrace.fail(call, e) })
        }
        val bounds = ambientBrightness[area]
        if (bounds != null && !brightness.isNaN()) {
            val v = brightness.roundToInt().coerceIn(bounds.minValue, bounds.maxValue)
            val call = "Light.setAmbientLightBrightness(${area.label()}, $v)"
            light.setAmbientLightBrightness(area, v, { _: SeatArea?, _: Int? -> SdkTrace.ok(call) }, { e -> SdkTrace.fail(call, e) })
            dispatched = true
        }
        val encoded = value.optString("color").takeIf { it.isNotEmpty() }?.let(AmbientColor::encode)
        if (area in ambientColorAreas && encoded != null) {
            val call = "Light.setAmbientLightBrightnessColor(${area.label()}, ${encoded.value} [${encoded.description}])"
            light.setAmbientLightBrightnessColor(area, encoded.value, { _: SeatArea?, _: Int? -> SdkTrace.ok(call) }, { e -> SdkTrace.fail(call, e) })
            dispatched = true
        }
        return dispatched || unsupported("Light.setAmbientLight*")
    }

    private fun unsupported(call: String): Boolean {
        SdkTrace.skip(call, "capability not writable or not supported")
        return false
    }

    private fun invalid(kind: String, value: Any?): Boolean {
        SdkTrace.skip("act($kind)", "invalid value $value")
        return false
    }

    companion object {
        private const val MAX_RETRIES = 3
        private const val RETRY_DELAY_MS = 700L
        private const val BLIND_JOG_MS = 4_000L
    }
}

internal val CapabilityConfig.writable: Boolean
    get() = accessType == AccessType.WRITE || accessType == AccessType.READ_WRITE

private fun CapabilityConfig.summary(detail: Any): String = "$accessType $detail"

/** The driver is ROW_1_LEFT (KR LHD); a combined area that contains it also qualifies. */
private fun Collection<SeatArea>.pickDriver(): SeatArea? =
    firstOrNull { SeatValue.ROW_1_LEFT in it.values } ?: firstOrNull()

private fun Any?.asDouble(): Double? = when (this) {
    is Number -> toDouble().takeIf { it.isFinite() }
    is String -> toDoubleOrNull()
    else -> null
}
