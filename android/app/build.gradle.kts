import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---- build inputs -------------------------------------------------------------------------------

val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use(::load)
}
val apkBaseName = (findProperty("apkBaseName") as String?)?.takeIf { it.isNotBlank() } ?: "JEGAP_jegap"
val pleosClientId = (findProperty("pleosClientId") as String?).orEmpty()
val pleosClientSecret = (findProperty("pleosClientSecret") as String?).orEmpty()

/** Vite output of the React UI (`web/`, built with `base: './'`). */
val webDist = rootProject.file("../web/dist")
val webAssets = file("src/main/assets/web")

fun String.asBuildConfigString() = "\"" + replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "com.carvalue.app"
    compileSdk = 34

    // AAOS Car API (CarPropertyManager) for speed / gear / parking brake / outside temperature.
    useLibrary("android.car")

    defaultConfig {
        applicationId = "com.carvalue.app"
        minSdk = 28 // Pleos: signing-key lineage requirement
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "PLEOS_CLIENT_ID", pleosClientId.asBuildConfigString())
        buildConfigField("String", "PLEOS_CLIENT_SECRET", pleosClientSecret.asBuildConfigString())
        // How the opaque Light.setAmbientLightBrightnessColor Int is encoded: "rgb" (0xRRGGBB) or
        // "preset" (Virtual Console index Cyan=0, Blue=1, Purple=2, White=3). Undocumented: probe on the emulator.
        buildConfigField(
            "String", "AMBIENT_COLOR_MODE",
            ((findProperty("ambientColorMode") as String?) ?: "rgb").asBuildConfigString(),
        )
    }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isDebuggable = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug").also {
                logger.warn("keystore.properties not found: release APK is signed with the DEBUG key (not submittable).")
            }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { buildConfig = true }

    // Voice clips are streamed with AssetManager.openFd(), which only works on uncompressed entries.
    androidResources { noCompress += listOf("mp3") }

    packaging {
        resources.excludes += listOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/*.kotlin_module", "/META-INF/versions/9/previous-compilation-data.bin")
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")

    implementation("ai.pleos.playground:Vehicle:2.3.2")
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
    implementation("ai.pleos.playground:TextToSpeech:3.3.1")
    implementation("ai.pleos.playground:SpeechToText:3.3.1")
    implementation("ai.pleos.playground:FusedLocation:1.1.3")
}

// ---- web UI → assets/web -----------------------------------------------------------------------

val copyWebDist by tasks.registering(Sync::class) {
    description = "Mirrors ../web/dist (Vite build) into src/main/assets/web, removing stale hashed bundles."
    group = "carvalue"
    from(webDist)
    into(webAssets)
    onlyIf {
        val present = webDist.resolve("index.html").exists()
        if (!present) logger.warn("web/dist/index.html missing: run `npm run build` in web/ first. Keeping existing assets/web.")
        present
    }
}
tasks.named("preBuild") { dependsOn(copyWebDist) }

// ---- release APK → <repo>/apk/<apkBaseName>_release.apk -----------------------------------------

val copyReleaseApk by tasks.registering(Copy::class) {
    description = "Copies the signed release APK to ../apk/${apkBaseName}_release.apk"
    group = "carvalue"
    from(layout.buildDirectory.dir("outputs/apk/release")) {
        include("*.apk")
        rename { "${apkBaseName}_release.apk" }
    }
    into(rootProject.file("../apk"))
}
tasks.matching { it.name == "assembleRelease" }.configureEach { finalizedBy(copyReleaseApk) }
