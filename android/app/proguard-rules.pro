# Minify is off for the contest build. If you turn it on:
-keepclassmembers class com.carvalue.app.bridge.CarValueBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class ai.pleos.playground.** { *; }
-dontwarn ai.pleos.playground.**
