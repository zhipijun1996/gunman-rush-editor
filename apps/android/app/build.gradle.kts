plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "org.gunmanrush.editor"
    compileSdk = 36
    defaultConfig { applicationId = "org.gunmanrush.editor"; minSdk = 26; targetSdk = 36; versionCode = 2; versionName = "0.1.1"; buildConfigField("String", "GODOT_VERSION", "\"${providers.gradleProperty("godotVersion").orElse("UNCONFIGURED").get()}\"") }
    packaging { jniLibs { useLegacyPackaging = true } }
    buildFeatures { buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    signingConfigs {
        if (System.getenv("EDITOR_KEYSTORE") != null) create("editorRelease") {
            storeFile = file(System.getenv("EDITOR_KEYSTORE"))
            storePassword = System.getenv("EDITOR_STORE_PASSWORD")
            keyAlias = System.getenv("EDITOR_KEY_ALIAS")
            keyPassword = System.getenv("EDITOR_KEY_PASSWORD")
        }
    }
    buildTypes { release {
        isMinifyEnabled = false
        if (System.getenv("EDITOR_KEYSTORE") != null) signingConfig = signingConfigs.getByName("editorRelease")
    } }
}
dependencies {
    implementation(files("libs/godot-lib.aar"))
    implementation("androidx.fragment:fragment-ktx:1.8.6")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.nimbusds:nimbus-jose-jwt:9.47")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
