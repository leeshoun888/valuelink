package com.carvalue.app

import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.net.HttpURLConnection
import java.net.URL

/**
 * Relays https://appassets.androidplatform.net/pub/... to the public-data proxy, so the WebView stays on its
 * HTTPS origin (no mixed content, no CORS) and never learns the proxy address. Only GET, only /pub/.
 * The proxy holds the data.go.kr / safemap keys; the request carries a grid cell, tile or district code only.
 */
object PublicDataRelay {
    private const val PREFIX = "/assets/web/pub/"

    fun intercept(request: WebResourceRequest): WebResourceResponse? {
        val proxy = BuildConfig.PUBLIC_PROXY
        val url = request.url
        if (proxy.isEmpty() || request.method != "GET" || url.host != MainActivity.APP_HOST) return null
        val path = url.encodedPath ?: return null
        if (!path.startsWith(PREFIX)) return null
        val target = proxy.trimEnd('/') + "/" + path.removePrefix(PREFIX) + (url.encodedQuery?.let { "?$it" } ?: "")
        return try {
            val c = URL(target).openConnection() as HttpURLConnection
            c.connectTimeout = 8000
            c.readTimeout = 20000
            val code = c.responseCode
            val type = (c.contentType ?: "application/json").substringBefore(';').trim()
            val body = if (code < 400) c.inputStream else c.errorStream
            WebResourceResponse(type, "utf-8", code, c.responseMessage ?: "OK", mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "max-age=300"), body)
        } catch (e: Exception) {
            Log.w("CvPub", "relay failed: ${e.message}")
            WebResourceResponse("application/json", "utf-8", 502, "Bad Gateway", emptyMap(), "{\"error\":\"relay\"}".byteInputStream())
        }
    }
}
