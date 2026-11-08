package com.carvalue.app.voice

import ai.pleos.playground.stt.SpeechToText
import ai.pleos.playground.stt.listener.ResultListener
import ai.pleos.playground.tts.TextToSpeech
import ai.pleos.playground.tts.listener.EventListener
import android.content.Context
import android.content.res.AssetFileDescriptor
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import com.carvalue.app.BuildConfig
import com.carvalue.app.util.Barrier
import com.carvalue.app.util.SdkTrace
import java.util.Locale
import ai.pleos.playground.stt.constant.ErrorType as SttError
import ai.pleos.playground.stt.constant.Mode as SttMode
import ai.pleos.playground.stt.listener.OnInitializeListener as SttInit
import ai.pleos.playground.stt.listener.OnServerConnectionListener as SttServer
import ai.pleos.playground.tts.constant.ErrorType as TtsError
import ai.pleos.playground.tts.constant.Mode as TtsMode
import ai.pleos.playground.tts.listener.OnInitializeListener as TtsInit
import ai.pleos.playground.tts.listener.OnServerConnectionListener as TtsServer

/**
 * Voice I/O for the web UI.
 *
 * speak(key, text): bundled clip `assets/web/voice/<key>.mp3` via MediaPlayer if present, else Pleos TTS with
 * `text`. Utterances are queued and each one holds transient, duckable audio focus while it plays.
 *
 * listen(requestId): Pleos STT; events are forwarded as onBeginningOfSpeech / onPartialResult / onResult /
 * onEndOfSpeech / onError.
 *
 * Mode: ON_DEVICE unless Pleos client credentials are configured (HYBRID needs registerApp).
 */
class VoiceGateway(
    private val context: Context,
    private val onSpeech: (requestId: String, event: String, payload: String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val focus = AudioFocusGuard(context)
    private val hybrid = BuildConfig.PLEOS_CLIENT_ID.isNotBlank() && BuildConfig.PLEOS_CLIENT_SECRET.isNotBlank()

    private val tts = TextToSpeech(context, if (hybrid) TtsMode.HYBRID else TtsMode.ON_DEVICE)
    private val stt = SpeechToText(context, if (hybrid) SttMode.HYBRID else SttMode.ON_DEVICE)

    @Volatile var ttsReady = false
        private set
    @Volatile var sttReady = false
        private set

    private data class Utterance(val key: String, val text: String)

    private val queue = ArrayDeque<Utterance>()
    private var speaking = false
    private var ttsActive = false
    /** Terminal TTS events we caused ourselves via tts.stop(); they must not end the *next* utterance. */
    private var staleTtsEvents = 0
    private var player: MediaPlayer? = null
    private val watchdog = Runnable { stopCurrent("watchdog timeout") }

    // ---- lifecycle ----------------------------------------------------------------------------------------

    /** Number of [Barrier.arrive] calls [start] makes (TTS init + STT init). */
    val probeCount = 2

    fun start(barrier: Barrier) {
        initTts(barrier)
        initStt(barrier)
    }

    private fun initTts(barrier: Barrier) {
        val call = "TextToSpeech.initialize(${if (hybrid) "HYBRID" else "ON_DEVICE"})"
        try {
            tts.initialize(object : TtsInit {
                override fun onSuccess() {
                    // The SDK's engine is bound inside initialize(); adding the listener earlier throws
                    // "lateinit property tts has not been initialized" (seen on Pleos Connect emulator 2.1.0).
                    runCatching { tts.addEventListener(ttsEvents) }.onFailure { SdkTrace.fail("TextToSpeech.addEventListener", it) }
                    runCatching { tts.setLocale(Locale.KOREA) }
                    runCatching { tts.setAudioAttributes(focus.attributes) }
                    ttsReady = true
                    SdkTrace.ok(call)
                    if (hybrid) {
                        tts.registerApp(BuildConfig.PLEOS_CLIENT_ID, BuildConfig.PLEOS_CLIENT_SECRET, object : TtsServer {
                            override fun onConnected() = SdkTrace.ok("TextToSpeech.registerApp")
                            override fun onFailed(errorType: TtsError) = SdkTrace.line("TextToSpeech.registerApp → FAILED $errorType")
                        })
                    }
                    barrier.arrive()
                }

                override fun onFailure(errorType: TtsError) {
                    SdkTrace.line("$call → FAILED $errorType")
                    barrier.arrive()
                }
            })
        } catch (t: Throwable) {
            SdkTrace.fail(call, t)
            barrier.arrive()
        }
    }

    private fun initStt(barrier: Barrier) {
        val call = "SpeechToText.initialize(${if (hybrid) "HYBRID" else "ON_DEVICE"})"
        try {
            stt.addListener(sttEvents)
            stt.initialize(object : SttInit {
                override fun onSuccess() {
                    runCatching { stt.setLocale(Locale.KOREA) }
                    sttReady = true
                    SdkTrace.ok(call)
                    if (hybrid) {
                        stt.registerApp(BuildConfig.PLEOS_CLIENT_ID, BuildConfig.PLEOS_CLIENT_SECRET, object : SttServer {
                            override fun onConnected() = SdkTrace.ok("SpeechToText.registerApp")
                            override fun onFailed(errorType: SttError) = SdkTrace.line("SpeechToText.registerApp → FAILED $errorType")
                        })
                    }
                    barrier.arrive()
                }

                override fun onFailure(errorType: SttError) {
                    SdkTrace.line("$call → FAILED $errorType")
                    barrier.arrive()
                }
            })
        } catch (t: Throwable) {
            SdkTrace.fail(call, t)
            barrier.arrive()
        }
    }

    fun release() {
        main.removeCallbacksAndMessages(null)
        queue.clear()
        player?.release()
        player = null
        focus.release()
        runCatching { tts.removeEventListener(ttsEvents); tts.release() }
        runCatching { stt.removeListener(sttEvents); stt.release() }
    }

    // ---- speak --------------------------------------------------------------------------------------------

    fun speak(key: String, text: String) = main.post {
        queue.addLast(Utterance(key, text))
        if (!speaking) playNext()
    }

    private fun playNext() {
        val u = queue.removeFirstOrNull() ?: return
        speaking = true
        main.postDelayed(watchdog, UTTERANCE_TIMEOUT_MS)
        if (!focus.acquire(onLoss = { main.post { stopCurrent("audio focus lost") } })) {
            SdkTrace.skip("speak(${u.key})", "audio focus denied")
            finishUtterance(null)
            return
        }
        val clip = openClip(u.key)
        when {
            clip != null -> playClip(u.key, clip)
            u.text.isNotBlank() && ttsReady -> speakTts(u.text)
            else -> {
                SdkTrace.skip("speak(${u.key})", if (u.text.isBlank()) "no clip, no text" else "TTS not ready")
                finishUtterance(null)
            }
        }
    }

    private fun openClip(key: String): AssetFileDescriptor? {
        if (!SAFE_KEY.matches(key)) return null
        return try {
            context.assets.openFd("web/voice/$key.mp3")
        } catch (_: Exception) {
            null
        }
    }

    private fun playClip(key: String, afd: AssetFileDescriptor) {
        try {
            val mp = MediaPlayer()
            player = mp
            mp.setAudioAttributes(focus.attributes)
            afd.use { mp.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
            mp.setOnCompletionListener { finishUtterance(null) }
            mp.setOnErrorListener { _, what, extra -> finishUtterance("MediaPlayer error $what/$extra"); true }
            mp.setOnPreparedListener { it.start() }
            mp.prepareAsync()
            SdkTrace.line("MediaPlayer.play(voice/$key.mp3) → OK")
        } catch (t: Throwable) {
            SdkTrace.fail("MediaPlayer.play(voice/$key.mp3)", t)
            finishUtterance(null)
        }
    }

    private fun speakTts(text: String) {
        val call = "TextToSpeech.speak(\"${text.take(24)}${if (text.length > 24) "…" else ""}\")"
        try {
            ttsActive = true
            tts.speak(text, true)
            SdkTrace.ok(call, "requested")
        } catch (t: Throwable) {
            SdkTrace.fail(call, t)
            finishUtterance(null)
        }
    }

    private fun stopCurrent(reason: String) {
        if (!speaking) return
        player?.let { runCatching { it.stop() } }
        if (ttsActive) {
            staleTtsEvents++
            runCatching { tts.stop() }
        }
        finishUtterance(reason)
    }

    /** Must run on the main thread. */
    private fun finishUtterance(error: String?) {
        if (!speaking) return
        error?.let { SdkTrace.line("speak → stopped ($it)") }
        main.removeCallbacks(watchdog)
        player?.release()
        player = null
        focus.release()
        speaking = false
        ttsActive = false
        playNext()
    }

    private val ttsEvents = object : EventListener {
        override fun onReady() = Unit
        override fun onStart() = Unit
        override fun onUpdatedRms(rms: Double) = Unit
        override fun onDone() = ttsEnded(null)
        override fun onStop() = ttsEnded(null)
        override fun onError(errorType: TtsError) = ttsEnded("TTS $errorType")
    }

    private fun ttsEnded(error: String?) {
        main.post {
            when {
                staleTtsEvents > 0 -> staleTtsEvents--
                ttsActive -> finishUtterance(error)
            }
        }
    }

    // ---- listen -------------------------------------------------------------------------------------------

    @Volatile private var listenId: String? = null
    @Volatile private var speechBegun = false
    private val listenTimeout = Runnable {
        if (listenId != null) runCatching { stt.stop() }
    }

    fun listen(requestId: String) = main.post {
        if (!sttReady) {
            onSpeech(requestId, "onError", "STT_NOT_READY")
            return@post
        }
        if (listenId != null) runCatching { stt.stop() }
        listenId = requestId
        speechBegun = false
        try {
            stt.request()
            SdkTrace.ok("SpeechToText.request()", "id=$requestId")
            main.removeCallbacks(listenTimeout)
            main.postDelayed(listenTimeout, LISTEN_TIMEOUT_MS)
        } catch (t: Throwable) {
            SdkTrace.fail("SpeechToText.request()", t)
            emit("onError", t.javaClass.simpleName)
            listenId = null
        }
    }

    private fun emit(event: String, payload: String = "") {
        val id = listenId ?: return
        onSpeech(id, event, payload)
    }

    private fun begin() {
        if (!speechBegun) {
            speechBegun = true
            emit("onBeginningOfSpeech")
        }
    }

    private val sttEvents = object : ResultListener {
        override fun onReady() = emit("onReady")
        override fun onStartedRecognition() = emit("onStartedRecognition")
        override fun onUpdatedRms(rms: Double) = Unit

        /** End-point detection: a non-zero `on` offset is the first sign of voice onset (used for reaction time). */
        override fun onUpdatedEpdData(on: Long, off: Long) {
            if (on > 0) begin()
        }

        override fun onUpdated(text: String, completed: Boolean) {
            begin()
            emit(if (completed) "onResult" else "onPartialResult", text)
        }

        override fun onEndedRecognition() {
            emit("onEndOfSpeech")
            finishListening()
        }

        override fun onError(errorType: SttError) {
            SdkTrace.line("SpeechToText → onError $errorType")
            emit("onError", errorType.name)
            finishListening()
        }
    }

    private fun finishListening() {
        main.removeCallbacks(listenTimeout)
        listenId = null
    }

    private companion object {
        val SAFE_KEY = Regex("[A-Za-z0-9_-]{1,64}")
        const val UTTERANCE_TIMEOUT_MS = 20_000L
        const val LISTEN_TIMEOUT_MS = 10_000L
    }
}
