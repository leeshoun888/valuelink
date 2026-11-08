package com.carvalue.app.vehicle

import android.graphics.Color
import com.carvalue.app.BuildConfig

/**
 * Converts the web UI's '#RRGGBB' into the Int taken by `Light.setAmbientLightBrightnessColor`.
 *
 * UNCERTAIN: the Vehicle SDK does not document the encoding and the colour capability returns no range.
 * The Virtual Console offers only Cyan / Blue / Purple / White presets, so the Int is either a packed RGB
 * value or a preset index. Select with `-PambientColorMode=rgb|preset` (default rgb). To calibrate, pick a
 * preset in the Virtual Console and look for the `Light.getAmbientLightBrightnessColor` line in the SDK trace.
 */
object AmbientColor {
    private data class Preset(val name: String, val index: Int, val hue: Float, val saturated: Boolean)

    private val presets = listOf(
        Preset("Cyan", 0, 180f, true),
        Preset("Blue", 1, 225f, true),
        Preset("Purple", 2, 280f, true),
        Preset("White", 3, 0f, false),
    )

    data class Encoded(val value: Int, val description: String)

    fun encode(hex: String): Encoded? {
        val rgb = runCatching { Color.parseColor(hex) }.getOrNull() ?: return null
        return if (BuildConfig.AMBIENT_COLOR_MODE == "preset") {
            val p = nearestPreset(rgb)
            Encoded(p.index, "$hex≈${p.name}#${p.index}")
        } else {
            val packed = rgb and 0xFFFFFF
            Encoded(packed, "$hex=0x%06X".format(packed))
        }
    }

    /** Warm or pale colours (nap amber, wake daylight) fall back to White: the presets have no warm tone. */
    private fun nearestPreset(rgb: Int): Preset {
        val hsv = FloatArray(3).also { Color.colorToHSV(rgb, it) }
        val (hue, sat) = hsv[0] to hsv[1]
        if (sat < 0.35f || hue < 150f || hue > 320f) return presets.last()
        return presets.filter { it.saturated }.minBy { kotlin.math.abs(it.hue - hue) }
    }
}
