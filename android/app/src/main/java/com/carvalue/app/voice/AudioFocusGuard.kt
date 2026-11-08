package com.carvalue.app.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager

/**
 * Transient, duck-friendly audio focus for voice prompts (Pleos audio focus guide): GAIN_TRANSIENT_MAY_DUCK
 * with USAGE_ASSISTANCE_NAVIGATION_GUIDANCE so music ducks under us and we coexist with navi guidance.
 */
class AudioFocusGuard(context: Context) {

    private val audioManager = context.getSystemService(AudioManager::class.java)
    private var request: AudioFocusRequest? = null

    val attributes: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    /** @param onLoss called when another stream takes focus permanently or transiently: stop speaking. */
    fun acquire(onLoss: () -> Unit): Boolean {
        release()
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attributes)
            .setWillPauseWhenDucked(false) // speech keeps playing; the system ducks us if needed
            .setOnAudioFocusChangeListener { change ->
                when (change) {
                    AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> onLoss()
                    else -> Unit // GAIN / LOSS_TRANSIENT_CAN_DUCK: keep going
                }
            }
            .build()
        request = req
        return audioManager.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    fun release() {
        request?.let(audioManager::abandonAudioFocusRequest)
        request = null
    }
}
