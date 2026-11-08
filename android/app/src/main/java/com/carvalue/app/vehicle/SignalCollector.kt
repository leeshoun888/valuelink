package com.carvalue.app.vehicle

import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.area.SeatArea
import ai.pleos.playground.vehicle.api.model.area.WheelArea
import ai.pleos.playground.vehicle.api.model.area.WindowArea
import ai.pleos.playground.vehicle.api.model.telltale.Telltales
import ai.pleos.playground.vehicle.constant.area.SeatValue
import ai.pleos.playground.vehicle.constant.area.WheelValue
import ai.pleos.playground.vehicle.constant.area.WindowValue
import ai.pleos.playground.vehicle.constant.control.OilLevelState
import ai.pleos.playground.vehicle.constant.telltale.TelltaleState
import ai.pleos.playground.vehicle.constant.telltale.TelltaleType
import android.os.Handler
import android.os.Looper
import com.carvalue.app.util.SdkTrace
import com.carvalue.app.util.errorName
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Merges every signal source into the partial `VehicleSignals` object the web value engine expects
 * (web/src/engine/types.ts) and pushes it about once per second.
 *
 * Sources: Vehicle SDK getters (slow poll) + [SignalListeners], CarPropertySource (speed, gear, battery
 * health, charging, identity, wheel ticks), LocationGateway and NaviGateway, which write through [put].
 * Only keys that have a real value are sent: the web keeps its defaults otherwise.
 */
class SignalCollector(
    private val vehicle: Vehicle,
    private val push: (String) -> Unit,
) {

    private val main = Handler(Looper.getMainLooper())
    private val values = ConcurrentHashMap<String, Any>()

    /** Reads that failed permanently (unsupported / no permission) are not polled again. */
    private val dead = ConcurrentHashMap.newKeySet<String>()
    private val windowOpen = ConcurrentHashMap<WindowValue, Boolean>()

    @Volatile private var aaosParkingBrake = false
    private var lastSpeedKph: Double? = null
    private var harshAccel = 0
    private var harshBrake = 0
    private var fallbackKm = 0.0

    private var ticks = 0
    private var running = false

    private val listeners = SignalListeners(vehicle, ::put)

    fun put(key: String, value: Any?) {
        if (value == null) values.remove(key) else values[key] = value
    }

    fun get(key: String): Any? = values[key]

    /** True only when the car is positively known to be stopped in P (or stopped with the parking brake on). */
    fun isParked(): Boolean {
        val gear = values["gear"] as? String
        val speed = values["speedKph"] as? Double
        val brake = values["parkingBrake"] as? Boolean
        return when {
            gear != null -> gear == "P" && (speed == null || speed < 1.0)
            else -> speed != null && speed < 1.0 && brake == true
        }
    }

    fun start() {
        if (running) return
        running = true
        put("harshAccel", 0)
        put("harshBrake", 0)
        listeners.start()
        main.post(tick)
    }

    fun stop() {
        running = false
        main.removeCallbacks(tick)
        listeners.stop()
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            ticks++
            if (ticks % 2 == 1) pollTelltales()
            if (ticks % 5 == 1) pollVehicle()
            if (ticks % 60 == 1) pollIdentity()
            sampleDriving()
            push(snapshot())
            main.postDelayed(this, TICK_MS)
        }
    }

    private fun snapshot(): String {
        val o = JSONObject()
        for ((k, v) in values) o.put(k, if (v is DoubleArray) JSONArray(v.toList()) else v)
        return o.toString()
    }

    // ---- Vehicle SDK polling ------------------------------------------------------------------------------

    private fun pollVehicle() {
        val safety = vehicle.getSafety()
        read<OilLevelState>("Safety.getEngineOilLevelState", "engineOil", { it.name.lowercase() }) { ok, fail -> safety.getEngineOilLevelState(ok, fail) }
        read<OilLevelState>("Safety.getBrakeFluidLevelState", "brakeFluid", { it.name.lowercase() }) { ok, fail -> safety.getBrakeFluidLevelState(ok, fail) }
        read<OilLevelState>("Safety.getTransmissionOilLevelState", "transmissionOil", { it.name.lowercase() }) { ok, fail -> safety.getTransmissionOilLevelState(ok, fail) }
        read<Boolean>("Safety.hasLowWasherFluidWarning", "lowWasher") { ok, fail -> safety.hasLowWasherFluidWarning(ok, fail) }
        read<Boolean>("Safety.hasPowerDownWarningIndicator", "powerDownWarning") { ok, fail -> safety.hasPowerDownWarningIndicator(ok, fail) }
        read<Boolean>("Safety.hasSeatAirbagBeenDeployed(ROW_1_LEFT)", "airbagDeployed") { ok, fail -> safety.hasSeatAirbagBeenDeployed(DRIVER, ok, fail) }
        read<Float>("Tire.getLowTirePressure(LEFT_FRONT)", "lowTireKpa", { it.toDouble() }) { ok, fail -> vehicle.getTire().getLowTirePressure(FRONT_LEFT_WHEEL, ok, fail) }

        val ev = vehicle.getEvBattery()
        read<Float>("EvBattery.getCumulativeEvEfficiency", "evEfficiency", { it.toDouble() }) { ok, fail -> ev.getCumulativeEvEfficiency(ok, fail) }
        read<Boolean>("EvBattery.isEvChargePortOpen", "chargePortOpen") { ok, fail -> ev.isEvChargePortOpen(ok, fail) }
        read<Boolean>("EvBattery.getEvChargeSwitchState", "chargeSwitch") { ok, fail -> ev.getEvChargeSwitchState(ok, fail) }
        if (!listeners.odometerLive) {
            read<Float>("Odometer.getCurrentDistanceDriven", "odometerKm", { it.toDouble() }) { ok, fail -> vehicle.getOdometer().getCurrentDistanceDriven(ok, fail) }
        }
        read<Any>("DrivingMode.getCurrentDrivingModeState", "driveMode", { it.toString().lowercase() }) { ok, fail -> vehicle.getDrivingMode().getCurrentDrivingModeState(ok, fail) }

        for (w in WINDOWS) {
            val call = "Window.getCurrentWindowPosition(${w.name})"
            if (call in dead) continue
            guarded(call) {
                vehicle.getWindow().getCurrentWindowPosition(WindowArea(w), { v: Int? ->
                    if (v != null) {
                        SdkTrace.readOk(call, v)
                        windowOpen[w] = v > 0
                        put("windowsOpen", windowOpen.values.count { it })
                    }
                }, { e -> onReadFailed(call, e) })
            }
        }
    }

    /** Identity rarely changes: VIN once a minute until it is read. */
    private fun pollIdentity() {
        if (values["vin"] != null) return
        read<String>("CarInfo.getVINInfo", "vin", { it.trim('"') }) { ok, fail -> vehicle.getCarInfo().getVINInfo(ok, fail) }
    }

    /**
     * Telltales by poll (registerTelltales needs PRIVATE_CAR_SAFETY). Two value signals come out of it:
     * - warnings: maintenance lamps that are on now (each one costs value until it is fixed)
     * - adasWarnings: the summed `warningCount` of the driver-assist warnings (forward collision, lane keeping,
     *   blind spot), the closest thing to a near-miss counter a 3rd-party app can read; AEB / ABS events are
     *   signature-only in AAOS.
     */
    private fun pollTelltales() {
        val call = "Safety.getTelltalesInfo"
        if (call in dead) return
        guarded(call) {
            vehicle.getSafety().getTelltalesInfo({ t: Telltales? ->
                val list = t?.telltales.orEmpty()
                SdkTrace.readOk(call, "${list.size} telltales")
                val warnings = JSONArray()
                for (d in list) {
                    if (d.type in MAINTENANCE && d.state != TelltaleState.OFF) {
                        warnings.put(JSONObject().put("type", d.type.name).put("state", d.state.name).put("count", d.warningCount))
                    }
                }
                put("warnings", warnings)
                put("adasWarnings", list.filter { it.type in ADAS }.sumOf { it.warningCount })
                put("overSpeedWarnings", list.filter { it.type == TelltaleType.OVER_SPEED }.sumOf { it.warningCount })
                fun on(type: TelltaleType) = list.any { it.type == type && it.state != TelltaleState.OFF }
                put("batteryConditioning", on(TelltaleType.EV_BATTERY_CONDITIONING))
                put("sportMode", on(TelltaleType.DRIVE_MODE_SPORT))
                if (!aaosParkingBrake) {
                    put("parkingBrake", list.any { (it.type == TelltaleType.PARKING_BRAKE || it.type == TelltaleType.ELECTRONIC_PARKING_BRAKE) && it.state != TelltaleState.OFF })
                }
            }, { e -> onReadFailed(call, e) })
        }
    }

    /** The AAOS PARKING_BRAKE_ON feed, once seen, wins over the telltale fallback. */
    fun putParkingBrakeFromCar(on: Boolean) {
        aaosParkingBrake = true
        put("parkingBrake", on)
    }

    private fun <T> read(
        call: String,
        key: String,
        map: (T) -> Any? = { it },
        fetch: (ok: (T?) -> Unit, fail: (Exception) -> Unit) -> Unit,
    ) {
        if (call in dead) return
        guarded(call) {
            fetch({ v ->
                if (v != null) {
                    SdkTrace.readOk(call, v)
                    put(key, map(v)?.let(::jsonValue))
                }
            }, { e -> onReadFailed(call, e) })
        }
    }

    private inline fun guarded(call: String, block: () -> Unit) {
        try {
            block()
        } catch (t: Throwable) {
            SdkTrace.readFail(call, t)
            dead += call
        }
    }

    /** Unsupported on this vehicle (no such sensor) is permanent; the emulator EV has no engine oil, for one. */
    private fun onReadFailed(call: String, e: Exception) {
        SdkTrace.readFail(call, e)
        val name = e.errorName()
        if (name in PERMANENT_ERRORS || e.message?.contains("not supported") == true) dead += call
    }

    // ---- derived signals ----------------------------------------------------------------------------------

    /**
     * Harsh acceleration / braking from the 1 Hz speed derivative. Thresholds follow common telematics
     * practice (≈ 0.3 g accel, 0.35 g braking); they feed tyre, brake and battery-stress wear in the value model.
     */
    private fun sampleDriving() {
        val speed = values["speedKph"] as? Double ?: return
        lastSpeedKph?.let { prev ->
            val a = (speed - prev) / 3.6 / (TICK_MS / 1000.0)
            if (a > HARSH_ACCEL_MS2) put("harshAccel", ++harshAccel)
            if (a < -HARSH_BRAKE_MS2) put("harshBrake", ++harshBrake)
        }
        lastSpeedKph = speed
        if (speed >= 1.0) {
            fallbackKm += speed * TICK_MS / 3_600_000.0
            put("tripKm", fallbackKm)
        }
    }

    private fun jsonValue(v: Any): Any = when (v) {
        is Float -> v.toDouble()
        else -> v
    }

    private companion object {
        const val TICK_MS = 1_000L
        const val HARSH_ACCEL_MS2 = 2.9
        const val HARSH_BRAKE_MS2 = 3.4

        val DRIVER = SeatArea(SeatValue.ROW_1_LEFT)
        val FRONT_LEFT_WHEEL = WheelArea(WheelValue.LEFT_FRONT)
        val WINDOWS = listOf(WindowValue.ROW_1_LEFT, WindowValue.ROW_1_RIGHT, WindowValue.ROW_2_LEFT, WindowValue.ROW_2_RIGHT)

        /** Lamps that mean "service needed": unresolved, they cost resale value and turn into repair bills. */
        val MAINTENANCE = setOf(
            TelltaleType.MASTER_WARNING, TelltaleType.ENGINE, TelltaleType.ENGINE_OIL_PRESSURE, TelltaleType.ENGINE_TEMPERATURE,
            TelltaleType.EV_SYSTEM, TelltaleType.HEV_SYSTEM, TelltaleType.LOW_VOLT_BATTERY, TelltaleType.TPMS, TelltaleType.ABS,
            TelltaleType.ESC, TelltaleType.MDPS, TelltaleType.AIRBAG, TelltaleType.RBS, TelltaleType.PARTICLE_FILTER,
            TelltaleType.SCR, TelltaleType.LED_HEADLAMP, TelltaleType.AFS, TelltaleType.POWER_DOWN,
        )
        val ADAS = setOf(
            TelltaleType.FCA, TelltaleType.LKA, TelltaleType.LFA, TelltaleType.LCA_LEFT, TelltaleType.LCA_RIGHT, TelltaleType.ELK,
        )
        val PERMANENT_ERRORS = setOf(
            "ERROR_NOT_SUPPORTED_PROPERTY", "ERROR_NOT_SUPPORTED_AREA",
            "ERROR_NOT_SUPPORTED_VALUE_TYPE", "ERROR_SECURITY_PERMISSION",
        )
    }
}
