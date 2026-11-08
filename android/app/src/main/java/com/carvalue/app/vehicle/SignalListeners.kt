package com.carvalue.app.vehicle

import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.area.WindowArea
import ai.pleos.playground.vehicle.constant.area.WindowValue
import ai.pleos.playground.vehicle.constant.control.LightState
import ai.pleos.playground.vehicle.constant.control.WiperState
import ai.pleos.playground.vehicle.listener.BrakePedalStatusListener
import ai.pleos.playground.vehicle.listener.DistanceDrivenListener
import ai.pleos.playground.vehicle.listener.EvBatteryStateOfChargeListener
import ai.pleos.playground.vehicle.listener.LightStateListener
import ai.pleos.playground.vehicle.listener.RangeRemainingListener
import ai.pleos.playground.vehicle.listener.WiperStateListener
import com.carvalue.app.util.SdkTrace

/**
 * Vehicle SDK change listeners (Pleos performance guide: prefer listeners over polling; < 5 % CPU while
 * driving). Each listener writes one or more `VehicleSignals` keys through [put]; a registration that
 * fails (unsupported on this build, no permission) is traced and the poll in [SignalCollector] remains
 * the fallback for that value.
 *
 * Signals for the value engine: odometerKm (mileage passport), socPct / rangeKm (charging habits),
 * headlightsOn (left on in P → 12 V drain), raining (wiper: open windows in rain), brakeEvents (pedal
 * presses, the denominator for hard-braking share).
 */
class SignalListeners(
    private val vehicle: Vehicle,
    private val put: (String, Any?) -> Unit,
) {
    @Volatile var odometerLive = false
        private set
    private var brakeEvents = 0
    private var lastBrake = false
    private val undo = mutableListOf<() -> Unit>()

    fun start() {
        val odo = vehicle.getOdometer()
        reg("Odometer.registerDistanceDriven", {
            val l = object : DistanceDrivenListener {
                // UNCERTAIN unit (undocumented): km on the Virtual Console Odometer card.
                override fun onDistanceDrivenUpdated(km: Float?) {
                    km?.let { put("odometerKm", it.toDouble()); odometerLive = true }
                }
                override fun onFailed(e: Exception) = SdkTrace.readFail("Odometer.onDistanceDrivenUpdated", e)
            }
            odo.registerDistanceDriven(l)
            undo += { odo.unregisterDistanceDriven(l) }
        })
        reg("Odometer.registerRangeRemainingListener", {
            val l = object : RangeRemainingListener {
                // UNCERTAIN unit (undocumented): metres on AAOS RANGE_REMAINING; values > 2,000 are treated as metres.
                override fun onRangeRemainingChanged(range: Float?) {
                    range?.let { put("rangeKm", if (it > 2000f) it / 1000.0 else it.toDouble()) }
                }
                override fun onFailed(e: Exception) = SdkTrace.readFail("Odometer.onRangeRemainingChanged", e)
            }
            odo.registerRangeRemainingListener(l)
            undo += { odo.unregisterRangeRemainingListener(l) }
        })

        val ev = vehicle.getEvBattery()
        reg("EvBattery.registerEvBatteryStateOfCharge", {
            val l = object : EvBatteryStateOfChargeListener {
                override fun onEvBatteryStateOfChargeUpdated(soc: Int?) {
                    soc?.let { put("socPct", it) }
                }
                override fun onFailed(e: Exception) = SdkTrace.readFail("EvBattery.onEvBatteryStateOfChargeUpdated", e)
            }
            ev.registerEvBatteryStateOfCharge(l)
            undo += { ev.unregisterEvBatteryStateOfCharge(l) }
        })

        val light = vehicle.getLight()
        reg("Light.registerLowBeamLightState", {
            val l = object : LightStateListener {
                override fun onLightStateUpdated(state: LightState?) {
                    state?.let { put("headlightsOn", it == LightState.ON) }
                }
                override fun onFailed(e: Exception) = SdkTrace.readFail("Light.onLowBeamLightStateUpdated", e)
            }
            light.registerLowBeamLightState(l)
            undo += { light.unregisterLowBeamLightState(l) }
        })

        val wiper = vehicle.getWiper()
        val front = WindowArea(WindowValue.FRONT_WINDSHIELD)
        reg("Wiper.registerWiperState(FRONT_WINDSHIELD)", {
            val l = object : WiperStateListener {
                override fun onWiperStateUpdated(state: WiperState?) {
                    state?.let { put("raining", it == WiperState.ON) }
                }
                override fun onFailed(e: Exception) = SdkTrace.readFail("Wiper.onWiperStateUpdated", e)
            }
            wiper.registerWiperState(front, l)
            undo += { wiper.unregisterWiperState(front, l) }
        })

        val brake = vehicle.getBrake()
        reg("Brake.registerBrakePedalStatus", {
            val l = object : BrakePedalStatusListener {
                override fun onBrakePedalStatusUpdated(pressed: Boolean?) {
                    if (pressed == true && !lastBrake) put("brakeEvents", ++brakeEvents)
                    lastBrake = pressed == true
                }
                override fun onFailed(e: Exception) = SdkTrace.readFail("Brake.onBrakePedalStatusUpdated", e)
            }
            brake.registerBrakePedalStatus(l)
            undo += { brake.unregisterBrakePedalStatus(l) }
        })
    }

    fun stop() {
        undo.forEach { runCatching(it) }
        undo.clear()
    }

    private fun reg(call: String, block: () -> Unit) {
        try {
            block()
            SdkTrace.ok(call)
        } catch (t: Throwable) {
            SdkTrace.fail(call, t)
        }
    }
}
