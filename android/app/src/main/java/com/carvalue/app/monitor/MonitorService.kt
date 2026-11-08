package com.carvalue.app.monitor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import com.carvalue.app.MainActivity
import com.carvalue.app.R
import com.carvalue.app.util.SdkTrace

/**
 * Keeps the value guard alive while another app (usually full-screen navigation) is in front.
 *
 * Found on Pleos Connect emulator 2.1.0: once the activity is stopped, Android 14's cached-app freezer
 * freezes the process, CarPropertyService's speed callbacks then fail with FAILED BINDER TRANSACTION and
 * the system kills the app, so charging and habit tracking stopped exactly when the driver
 * was following navigation. A foreground service keeps the process un-cached; the notification is the
 * user-visible "monitoring" state Android requires for it.
 */
class MonitorService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "차량 가치 지킴", NotificationManager.IMPORTANCE_LOW).apply {
                description = "다른 앱을 쓰는 동안에도 제값이 배터리와 차 상태를 계속 지킵니다."
                setShowBadge(false)
            },
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("제값 · 차량 가치 지키는 중")
            .setContentText("충전, 경고등, 운전 습관을 계속 살피고 있어요.")
            .setOngoing(true)
            .setContentIntent(open)
            .build()
        try {
            startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            SdkTrace.ok("MonitorService.startForeground(SPECIAL_USE)")
        } catch (t: Throwable) {
            SdkTrace.fail("MonitorService.startForeground", t)
            stopSelf()
        }
        return START_STICKY
    }

    companion object {
        private const val CHANNEL = "cv_monitor"
        private const val ID = 7

        fun start(context: Context) {
            runCatching { context.startForegroundService(Intent(context, MonitorService::class.java)) }
                .onFailure { SdkTrace.fail("MonitorService.start", it) }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, MonitorService::class.java)) }
        }
    }
}
