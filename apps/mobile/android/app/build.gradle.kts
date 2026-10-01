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
// BotFather takes one SHA-256 per Android entry and derives the host from it,
// so each signing key has its own: the release host is registered with the
// Play App Signing key Google signs store builds with, the debug host with
// ~/.android/debug.keystore. Must match TELEGRAM_ANDROID_APP_LINK (env.dart).
val telegramReleaseHost = "app3387643188-login.tg.dev"
val telegramDebugHost = "app3004048938-login.tg.dev"

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
        manifestPlaceholders["telegramAppLinkHost"] = telegramDebugHost
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
            // A release APK signed with the upload or debug key (not from
            // Play) fails this host's verification and gets Telegram's page
            // back instead of the app; the Telegram-app path still works.
            manifestPlaceholders["telegramAppLinkHost"] = telegramReleaseHost
        }
    }
}

flutter {
    source = "../.."
}
