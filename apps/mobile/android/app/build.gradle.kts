import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing comes from android/key.properties (never committed):
//   storeFile=/abs/path/upload-keystore.jks
//   storePassword=...
//   keyAlias=upload
//   keyPassword=...
// Without it, release builds fall back to the debug key so `flutter run
// --release` still works locally; such an APK must not be uploaded.
val keystoreProperties = Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val hasReleaseKey = keystoreProperties.getProperty("storeFile") != null

// Telegram Login's App Link host (@BotFather → Login Widget → Native Login).
// BotFather takes one package and SHA-256 per Android entry and derives the
// host from them, so each app and signing key has its own: the store app's
// release host is registered with the Play App Signing key Google signs store
// builds with, its debug host with ~/.android/debug.keystore; the test app
// (@takeaway_test_bot) with the upload key its release builds are signed
// with. Must match telegramAndroidAppLink in env.dart. A build with no host
// registered (the test app's debug builds) gets one that resolves nowhere:
// its intent filter never verifies, and the app falls back to its URL scheme.
val telegramReleaseHost = "app3387643188-login.tg.dev"
val telegramDebugHost = "app3004048938-login.tg.dev"
val telegramTestAppReleaseHost = "app314551967-login.tg.dev"
val telegramUnregisteredHost = "not-registered.invalid"

android {
    namespace = "md.takeaway.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "md.takeaway.app"
        // Firebase Messaging needs 23; Flutter's own floor is 24.
        minSdk = maxOf(flutter.minSdkVersion, 24)
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // prod is the store app and the default (pubspec.yaml: default-flavor);
    // staging is «takeAway Test», a separate app against test.takeaway.md
    // that installs next to it (docs/environments.md). The flavor sets what
    // the app is — id, name, URL scheme; config/<env>.json what it talks to.
    flavorDimensions += "app"
    productFlavors {
        create("prod") {
            dimension = "app"
            resValue("string", "app_name", "takeAway")
            manifestPlaceholders["appUrlScheme"] = "takeaway"
        }
        create("staging") {
            dimension = "app"
            applicationIdSuffix = ".staging"
            resValue("string", "app_name", "takeAway Test")
            // Env.appUrlScheme. A scheme of its own, or the store app could
            // catch the test app's sign-in and payment returns.
            manifestPlaceholders["appUrlScheme"] = "takeawaytest"
        }
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
}

// The App Link host per flavor and build type. A store-app release APK
// signed with the upload or debug key (not from Play) fails its host's
// verification and gets Telegram's page back instead of the app; the
// Telegram-app path still works.
androidComponents {
    onVariants { variant ->
        val release = variant.buildType == "release"
        val host = when (variant.flavorName) {
            "staging" -> if (release) telegramTestAppReleaseHost else telegramUnregisteredHost
            else -> if (release) telegramReleaseHost else telegramDebugHost
        }
        variant.manifestPlaceholders.put("telegramAppLinkHost", host)
    }
}

flutter {
    source = "../.."
}
