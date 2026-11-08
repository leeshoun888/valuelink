package com.carvalue.app.vehicle

import android.car.Car
import android.car.VehiclePropertyIds
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.content.Context
import com.carvalue.app.util.SdkTrace
import kotlin.math.abs

/**
 * Standard signals the Pleos Vehicle SDK does not carry, read through the AAOS Car API.
 * Every property below was read successfully by a 3rd-party app on Pleos Connect emulator 2.1.0.
 *
 * - PERF_VEHICLE_SPEED (m/s, CAR_SPEED: dangerous → runtime grant), GEAR_SELECTION, PARKING_BRAKE_ON
 *   (CAR_POWERTRAIN), ENV_OUTSIDE_TEMPERATURE (CAR_EXTERIOR_ENVIRONMENT)
 * - Battery health: EV_CURRENT_BATTERY_CAPACITY / INFO_EV_BATTERY_CAPACITY (Wh) → state of health, the
 *   car's own number rather than an estimate (emulator: 77,000 / 77,400 Wh = 99.5 %)
 * - Charging: EV_CHARGE_STATE, EV_BATTERY_INSTANTANEOUS_CHARGE_RATE (mW), EV_CHARGE_TIME_REMAINING (s),
 *   EV_CHARGE_PORT_CONNECTED, EV_CHARGE_PERCENT_LIMIT, EV_CHARGE_CURRENT_DRAW_LIMIT (CAR_ENERGY)
 * - Identity: INFO_MAKE / INFO_MODEL / INFO_MODEL_YEAR / INFO_FUEL_TYPE (CAR_INFO, read once)
 * - WHEEL_TICK [resetCount, fl, fr, rl, rr] (CAR_SPEED): an odometer-independent distance witness
 *   for the mileage passport
 *
 * Not readable by a 3rd-party app (signature|privileged): PERF_ODOMETER, ABS_ACTIVE,
 * TRACTION_CONTROL_ACTIVE, AUTOMATIC_EMERGENCY_BRAKING_STATE, FORWARD_COLLISION_WARNING_STATE,
 * CRITICALLY_LOW_TIRE_PRESSURE. Mileage comes from the Pleos Odometer API instead.
 *
 * Support is checked with getCarPropertyConfig(); missing properties are traced and skipped.
 */
class CarPropertySource(private val context: Context, private val onValue: (key: String, value: Any) -> Unit) {

    private var car: Car? = null
    private var manager: CarPropertyManager? = null

    private val callback = object : CarPropertyManager.CarPropertyEventCallback {
        override fun onChangeEvent(value: CarPropertyValue<*>) {
            if (value.status != CarPropertyValue.STATUS_AVAILABLE) return
            handle(value.propertyId, value.value)
        }

        override fun onErrorEvent(propertyId: Int, zone: Int) {
            SdkTrace.line("CarPropertyManager.onErrorEvent(${VehiclePropertyIds.toString(propertyId)}, zone=$zone)")
        }
    }

    private fun handle(id: Int, v: Any?) {
        when (id) {
            VehiclePropertyIds.PERF_VEHICLE_SPEED ->
                (v as? Float)?.let { onValue("speedKph", abs(it) * 3.6) }
            VehiclePropertyIds.GEAR_SELECTION ->
                (v as? Int)?.let { g -> gearLetter(g)?.let { onValue("gear", it) } }
            VehiclePropertyIds.PARKING_BRAKE_ON ->
                (v as? Boolean)?.let { onValue("parkingBrake", it) }
            VehiclePropertyIds.ENV_OUTSIDE_TEMPERATURE ->
                (v as? Float)?.let { onValue("outsideTempC", it.toDouble()) }
            VehiclePropertyIds.EV_CURRENT_BATTERY_CAPACITY ->
                (v as? Float)?.let { onValue("batteryCapWh", it.toDouble()) }
            VehiclePropertyIds.EV_CHARGE_STATE ->
                (v as? Int)?.let { onValue("chargeState", chargeState(it)) }
            VehiclePropertyIds.EV_BATTERY_INSTANTANEOUS_CHARGE_RATE ->
                (v as? Float)?.let { onValue("chargeKw", it / 1_000_000.0) }
            VehiclePropertyIds.EV_CHARGE_TIME_REMAINING ->
                (v as? Int)?.let { onValue("chargeMinLeft", it / 60.0) }
            VehiclePropertyIds.EV_CHARGE_PORT_CONNECTED ->
                (v as? Boolean)?.let { onValue("plugged", it) }
            VehiclePropertyIds.EV_CHARGE_PERCENT_LIMIT ->
                (v as? Float)?.let { onValue("chargeLimitPct", it.toDouble()) }
            VehiclePropertyIds.EV_CHARGE_CURRENT_DRAW_LIMIT ->
                (v as? Float)?.let { onValue("chargeCurrentA", it.toDouble()) }
            VehiclePropertyIds.WHEEL_TICK -> wheelKm(v)?.let { onValue("wheelTickKm", it) }
        }
    }

    fun start() {
        val c = try {
            Car.createCar(context)
        } catch (t: Throwable) {
            SdkTrace.fail("Car.createCar()", t)
            null
        } ?: return
        car = c
        val m = c.getCarManager(Car.PROPERTY_SERVICE) as? CarPropertyManager ?: return
        manager = m
        subscribe(m, VehiclePropertyIds.PERF_VEHICLE_SPEED, CarPropertyManager.SENSOR_RATE_NORMAL)
        subscribe(m, VehiclePropertyIds.GEAR_SELECTION, CarPropertyManager.SENSOR_RATE_ONCHANGE)
        subscribe(m, VehiclePropertyIds.PARKING_BRAKE_ON, CarPropertyManager.SENSOR_RATE_ONCHANGE)
        subscribe(m, VehiclePropertyIds.ENV_OUTSIDE_TEMPERATURE, CarPropertyManager.SENSOR_RATE_ONCHANGE)
        for (id in ENERGY_IDS) subscribe(m, id, CarPropertyManager.SENSOR_RATE_ONCHANGE)
        subscribe(m, VehiclePropertyIds.WHEEL_TICK, CarPropertyManager.SENSOR_RATE_NORMAL)
        readOnce(m, VehiclePropertyIds.INFO_EV_BATTERY_CAPACITY) { onValue("batteryDesignWh", (it as Float).toDouble()) }
        readOnce(m, VehiclePropertyIds.INFO_MAKE) { onValue("make", it.toString()) }
        readOnce(m, VehiclePropertyIds.INFO_MODEL) { onValue("model", it.toString()) }
        readOnce(m, VehiclePropertyIds.INFO_MODEL_YEAR) { onValue("modelYear", (it as Number).toInt()) }
        readOnce(m, VehiclePropertyIds.INFO_FUEL_TYPE) { onValue("fuelType", fuelType(it)) }
        // On-change properties only fire on change: seed the current values once.
        for (id in ENERGY_IDS) readOnce(m, id) { v -> handle(id, v) }
    }

    private fun readOnce(m: CarPropertyManager, id: Int, use: (Any) -> Unit) {
        val call = "CarPropertyManager.getProperty(${VehiclePropertyIds.toString(id)})"
        try {
            val cfg = m.getCarPropertyConfig(id) ?: return SdkTrace.skip(call, "property not supported")
            val v = m.getProperty<Any>(id, cfg.areaIds.firstOrNull() ?: 0)?.value ?: return
            SdkTrace.readOk(call, v)
            use(v)
        } catch (t: Throwable) {
            SdkTrace.readFail(call, t)
        }
    }

    private fun subscribe(m: CarPropertyManager, id: Int, rate: Float, label: String = VehiclePropertyIds.toString(id)) {
        val call = "CarPropertyManager.registerCallback($label)"
        try {
            if (m.getCarPropertyConfig(id) == null) {
                SdkTrace.skip(call, "property not supported")
                return
            }
            if (m.registerCallback(callback, id, rate)) SdkTrace.ok(call) else SdkTrace.line("$call → false")
        } catch (t: Throwable) { // SecurityException without CAR_SPEED / CAR_POWERTRAIN grant
            SdkTrace.fail(call, t)
        }
    }

    fun release() {
        runCatching { manager?.unregisterCallback(callback) }
        runCatching { car?.disconnect() }
        manager = null
        car = null
    }

    private fun gearLetter(gear: Int): String? = when (gear) {
        GEAR_PARK -> "P"
        GEAR_REVERSE -> "R"
        GEAR_NEUTRAL -> "N"
        GEAR_UNKNOWN -> null
        else -> if (gear >= GEAR_DRIVE) "D" else null // DRIVE and GEAR_1..GEAR_9
    }

    /** WHEEL_TICK = [resetCount, frontLeft, frontRight, rearLeft, rearRight] ticks; km from the mean wheel. */
    private var tickBase: Double? = null
    private fun wheelKm(raw: Any?): Double? {
        val ticks = (raw as? Array<*>)?.mapNotNull { (it as? Number)?.toDouble() } ?: (raw as? LongArray)?.map { it.toDouble() } ?: return null
        if (ticks.size < 5) return null
        val mean = ticks.drop(1).average()
        val base = tickBase ?: mean.also { tickBase = it }
        return (mean - base) * MM_PER_TICK / 1_000_000.0
    }

    private fun chargeState(v: Int) = when (v) {
        1 -> "charging"
        2 -> "full"
        3 -> "idle"
        4 -> "error"
        else -> "unknown"
    }

    private fun fuelType(v: Any): String = when ((v as? Array<*>)?.firstOrNull() ?: (v as? IntArray)?.firstOrNull() ?: v) {
        10 -> "ev"
        1 -> "gasoline"
        2 -> "diesel"
        else -> v.toString()
    }

    private companion object {
        val ENERGY_IDS = listOf(
            VehiclePropertyIds.EV_CURRENT_BATTERY_CAPACITY,
            VehiclePropertyIds.EV_CHARGE_STATE,
            VehiclePropertyIds.EV_BATTERY_INSTANTANEOUS_CHARGE_RATE,
            VehiclePropertyIds.EV_CHARGE_TIME_REMAINING,
            VehiclePropertyIds.EV_CHARGE_PORT_CONNECTED,
            VehiclePropertyIds.EV_CHARGE_PERCENT_LIMIT,
            VehiclePropertyIds.EV_CHARGE_CURRENT_DRAW_LIMIT,
        )

        /** UNCERTAIN: WHEEL_TICK config reports µm per tick per wheel; 2,000 µm assumed when absent. */
        const val MM_PER_TICK = 2_000.0

        // android.car.VehicleGear
        const val GEAR_UNKNOWN = 0x0
        const val GEAR_NEUTRAL = 0x1
        const val GEAR_REVERSE = 0x2
        const val GEAR_PARK = 0x4
        const val GEAR_DRIVE = 0x8
    }
}
