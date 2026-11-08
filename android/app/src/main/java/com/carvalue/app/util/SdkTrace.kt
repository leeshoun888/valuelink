package com.carvalue.app.util

import android.util.Log
import ai.pleos.playground.vehicle.api.model.area.SeatArea
import ai.pleos.playground.vehicle.api.model.area.WindowArea
import java.util.concurrent.ConcurrentHashMap

/**
 * One human-readable line per real SDK call, mirrored to logcat and to the web UI
 * (`window.__cv.onSdkTrace`), e.g. `HVAC.setHvacRecirculation(SeatArea(ROW_1_LEFT), false) → OK`.
 *
 * Periodic reads are traced once per distinct outcome so the 1 Hz poll does not flood the UI.
 * Never put location or other PII in a trace line.
 */
object SdkTrace {
    private const val TAG = "CvSdk"

    /** Set by the web channel; called from any thread. */
    @Volatile var sink: ((String) -> Unit)? = null

    private val seen = ConcurrentHashMap.newKeySet<String>()

    fun line(text: String) {
        Log.i(TAG, text)
        sink?.invoke(text)
    }

    fun ok(call: String, result: Any? = null) = line("$call → ${result?.let { "OK ($it)" } ?: "OK"}")

    fun fail(call: String, e: Throwable) = line("$call → FAILED ${e.errorName()}")

    fun skip(call: String, why: String) = line("$call → SKIPPED ($why)")

    /** Traces a read only the first time it succeeds and the first time it fails. */
    fun readOk(call: String, value: Any?) {
        if (seen.add("$call:ok")) line("$call → $value (first read; polling)")
    }

    fun readFail(call: String, e: Throwable) {
        val name = e.errorName()
        if (seen.add("$call:$name")) line("$call → FAILED $name")
    }
}

/**
 * Vehicle SDK 2.3.2 ships `VehicleException` obfuscated (`…callback.exception.a`), so `e is VehicleException`
 * does not compile. Its message is `"Error code: <ErrorCode name>"`; fall back to class name + message.
 */
fun Throwable.errorName(): String =
    message?.substringAfter("Error code: ", "")?.trim()?.takeIf { it.isNotEmpty() }
        ?: "${javaClass.simpleName}${message?.let { ": $it" } ?: ""}"

fun SeatArea.label(): String = "SeatArea(${values.joinToString { it.name }})"

fun WindowArea.label(): String = "WindowArea(${values.joinToString { it.name }})"
