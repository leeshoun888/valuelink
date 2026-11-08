package com.carvalue.app.util

import android.os.Handler
import android.os.Looper
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Runs [onDone] once on the main thread when [parties] tasks have called [arrive], or after [timeoutMs],
 * whichever comes first. Used to hold the web UI until startup capability checks have answered.
 */
class Barrier(parties: Int, timeoutMs: Long, private val onDone: () -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val remaining = AtomicInteger(parties)
    private val fired = AtomicBoolean(false)

    init {
        main.postDelayed(::fire, timeoutMs)
        if (parties <= 0) fire()
    }

    fun arrive() {
        if (remaining.decrementAndGet() <= 0) main.post(::fire)
    }

    private fun fire() {
        if (fired.compareAndSet(false, true)) {
            main.removeCallbacksAndMessages(null)
            onDone()
        }
    }
}
