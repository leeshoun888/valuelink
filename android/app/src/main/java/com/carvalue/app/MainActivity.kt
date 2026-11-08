package com.carvalue.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.content.res.Configuration
import android.os.Bundle
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import com.carvalue.app.bridge.CarValueBridge
import com.carvalue.app.bridge.WebChannel
import com.carvalue.app.location.LocationGateway
import com.carvalue.app.navi.NaviGateway
import com.carvalue.app.util.Barrier
import com.carvalue.app.util.SdkTrace
import com.carvalue.app.vehicle.CarPropertySource
import com.carvalue.app.vehicle.SignalCollector
import com.carvalue.app.vehicle.VehicleGateway
import com.carvalue.app.voice.VoiceGateway

/**
 * Hosts the React UI (assets/web, served by WebViewAssetLoader) and wires the Pleos SDK gateways to it.
 *
 * Startup: SDK capability checks run first (≤ [CAPS_TIMEOUT_MS]) so `CarValueNative.capabilities()` is final
 * when the page reads it, then the UI loads and the 1 Hz signal push starts.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var channel: WebChannel
    private lateinit var collector: SignalCollector
    private lateinit var vehicle: VehicleGateway
    private lateinit var navi: NaviGateway
    private lateinit var voice: VoiceGateway
    private lateinit var location: LocationGateway
    private lateinit var carProps: CarPropertySource

    @Volatile private var trustedPage = false

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { onPermissionsSettled() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        channel = WebChannel(webView)
        SdkTrace.sink = channel::pushTrace

        vehicle = VehicleGateway(this) { collector.isParked() }
        collector = SignalCollector(vehicle.vehicle, channel::pushSignals)
        navi = NaviGateway(
            this,
            onRoute = { km, eta ->
                collector.put("routeRemainingKm", km)
                collector.put("routeEtaMin", eta)
            },
            onLocation = ::onLocation,
            onSignal = { key, value -> collector.put(key, value) },
            onEvent = { type, payload -> channel.pushEvent(type, payload.toString()) },
        )
        location = LocationGateway(this, ::onLocation) { stopId, transition ->
            channel.pushEvent("geofence", org.json.JSONObject().put("stopId", stopId).put("transition", transition).toString())
        }
        carProps = CarPropertySource(this) { key, value ->
            if (key == "parkingBrake") collector.putParkingBrakeFromCar(value as Boolean) else collector.put(key, value)
        }
        voice = VoiceGateway(this) { id, event, payload -> channel.pushSpeech(id, event, payload) }

        configureWebView()

        // CCP / hardware Back at the top level must background the app, never finish() it (Pleos review rule).
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                moveTaskToBack(true)
            }
        })

        vehicle.start()
        val barrier = Barrier(vehicle.probeCount + voice.probeCount + 1, CAPS_TIMEOUT_MS) {
            loadUi()
            collector.start()
            pushUiMode(resources.configuration)
        }
        vehicle.probe(barrier)
        voice.start(barrier)
        navi.start { barrier.arrive() }

        requestRuntimePermissions()
        com.carvalue.app.monitor.MonitorService.start(this)
    }

    override fun onDestroy() {
        com.carvalue.app.monitor.MonitorService.stop(this)
        SdkTrace.sink = null
        channel.detach()
        collector.stop()
        carProps.release()
        location.release()
        navi.release()
        voice.release()
        vehicle.release()
        webView.removeJavascriptInterface(JS_NAME)
        webView.destroy()
        super.onDestroy()
    }

    // ---- WebView ------------------------------------------------------------------------------------------

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun configureWebView() {
        // Pleos security guide: no remote debugging in release.
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(APP_HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Restrict local file access: everything is served over https://appassets.androidplatform.net.
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            setGeolocationEnabled(false)
            safeBrowsingEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }
        webView.setBackgroundColor(ContextCompat.getColor(this, R.color.app_bg))

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            /** The UI never navigates away from our origin; anything else (http, other sites) is blocked. */
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != APP_HOST || request.url.scheme != "https"

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                val uri = url?.let(Uri::parse)
                trustedPage = uri?.scheme == "https" && uri.host == APP_HOST
                channel.onPageStarted()
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            // Mic/camera go through the Pleos SDKs, never through the page.
            override fun onPermissionRequest(request: PermissionRequest) = request.deny()

            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG) android.util.Log.d("CvWeb", "${message.message()} @${message.lineNumber()}")
                return true
            }
        }
        webView.addJavascriptInterface(CarValueBridge(vehicle, navi, voice, location) { trustedPage }, JS_NAME)
    }

    private fun loadUi() {
        val hasUi = runCatching { assets.open("web/index.html").close() }.isSuccess
        if (hasUi) {
            webView.loadUrl(UI_URL)
        } else {
            SdkTrace.line("assets/web/index.html missing: build web/ (npm run build) and rebuild the APK")
            webView.loadDataWithBaseURL(
                null,
                "<body style='background:#05070B;color:#3CF2C8;font:24px sans-serif;padding:40px'>" +
                    "깨움 UI bundle missing.<br>Run <code>npm run build</code> in web/ and rebuild.</body>",
                "text/html", "utf-8", null,
            )
        }
    }

    // ---- permissions & location ---------------------------------------------------------------------------

    private fun requestRuntimePermissions() {
        val missing = RUNTIME_PERMISSIONS.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) onPermissionsSettled() else permissionLauncher.launch(missing.toTypedArray())
    }

    /** Starts the sources that depend on runtime grants; each one traces its own failure if still denied. */
    private fun onPermissionsSettled() {
        carProps.start()
        val fusedOk = ContextCompat.checkSelfPermission(this, PERMISSION_FUSED_LOCATION) == PackageManager.PERMISSION_GRANTED &&
            location.start()
        navi.useAsLocationSource = !fusedOk
    }

    /** uiMode is in android:configChanges, so day/night switches arrive here without recreating the WebView. */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (::collector.isInitialized) pushUiMode(newConfig)
    }

    /** The web UI follows the vehicle's day/night theme (Pleos light / dark system palettes). */
    private fun pushUiMode(config: Configuration) {
        collector.put("uiNight", (config.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES)
    }

    private fun onLocation(lat: Double, lon: Double, heading: Double) {
        collector.put("position", doubleArrayOf(lon, lat)) // web expects [lng, lat]
        collector.put("headingDeg", heading)
    }

    private companion object {
        const val APP_HOST = "appassets.androidplatform.net"
        const val UI_URL = "https://$APP_HOST/assets/web/index.html#/car"
        const val JS_NAME = "CarValueNative"
        const val CAPS_TIMEOUT_MS = 2_500L
        const val PERMISSION_FUSED_LOCATION = "pleos.car.permission.FUSED_LOCATION"
        val RUNTIME_PERMISSIONS = listOf(
            Manifest.permission.RECORD_AUDIO,
            PERMISSION_FUSED_LOCATION,
            "android.car.permission.CAR_SPEED", // dangerous on AAOS
            "android.car.permission.CAR_ENERGY", // battery health, charge state (dangerous on AAOS)
        )
    }
}
