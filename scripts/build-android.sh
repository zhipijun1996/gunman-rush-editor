#!/usr/bin/env bash
set -euo pipefail
editor_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
game_root="${GUNMAN_GAME_ROOT:-$editor_root/../gunman-rush}"
android_source="${GUNMAN_ANDROID_SOURCE:-$editor_root/../toolchains/godot-android-source}"
test -f "$android_source/libs/release/godot-lib.template_release.aar" || { echo 'Install the game-locked Android source template first.' >&2; exit 1; }
cd "$editor_root"
npm run build
mkdir -p apps/android/app/src/main/assets/editor apps/android/app/libs apps/android/gradle/wrapper
find apps/android/app/src/main/assets/editor -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -R dist/editor/. apps/android/app/src/main/assets/editor/
cp "$android_source/libs/release/godot-lib.template_release.aar" apps/android/app/libs/godot-lib.aar
cp "$android_source/gradle/wrapper/gradle-wrapper.jar" apps/android/gradle/wrapper/
cp "$android_source/gradle/wrapper/gradle-wrapper.properties" apps/android/gradle/wrapper/
if test -f "$game_root/build/editor-native/game.pck"; then
  mkdir -p apps/android/app/src/main/assets/game
  cp "$game_root/build/editor-native/game.pck" "$game_root/build/editor-native/manifest.json" apps/android/app/src/main/assets/game/
fi
cd apps/android
game_godot_version="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["godot"]["version_exact"])' "$game_root/config/toolchain.json")"
variant="${EDITOR_BUILD_VARIANT:-Debug}"
if test "$variant" = Release; then
  test -n "${EDITOR_KEYSTORE:-}" || { echo 'A private editor signing key is required for release.' >&2; exit 1; }
fi
if test -n "${GUNMAN_GRADLE_BIN:-}"; then
  "$GUNMAN_GRADLE_BIN" --no-daemon "-PgodotVersion=$game_godot_version" ":app:test${variant}UnitTest" ":app:assemble${variant}"
else
  java -classpath gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain --no-daemon "-PgodotVersion=$game_godot_version" ":app:test${variant}UnitTest" ":app:assemble${variant}"
fi
mkdir -p "$editor_root/build/android"
variant_lower="$(echo "$variant" | tr '[:upper:]' '[:lower:]')"
cp "app/build/outputs/apk/$variant_lower/app-$variant_lower.apk" "$editor_root/build/android/gunman-world-editor-preview.apk"
