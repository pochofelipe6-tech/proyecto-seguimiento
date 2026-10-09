$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$androidRoot = Join-Path $projectRoot 'android'
$wrapper = Join-Path $androidRoot 'gradlew.bat'
$sourceApk = Join-Path $androidRoot 'app\build\outputs\apk\debug\app-debug.apk'
$outputApk = Join-Path $projectRoot 'Ruta-Segura.apk'

$localJdkRoot = Join-Path $projectRoot '.jdk'
$localJdk = Get-ChildItem -LiteralPath $localJdkRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
    Select-Object -First 1
if (-not $env:JAVA_HOME -and $localJdk) {
    $env:JAVA_HOME = $localJdk.FullName
}
if (-not $env:JAVA_HOME -and -not (Get-Command java -ErrorAction SilentlyContinue)) {
    throw 'Se necesita Java 17 o superior. Instala Android Studio o configura JAVA_HOME.'
}

$localSdk = Join-Path $projectRoot '.android-tools\sdk'
if (-not $env:ANDROID_SDK_ROOT -and (Test-Path -LiteralPath $localSdk)) {
    $env:ANDROID_SDK_ROOT = $localSdk
}
if (-not $env:ANDROID_SDK_ROOT -and -not $env:ANDROID_HOME) {
    throw 'Se necesita Android SDK. Instala Android Studio o configura ANDROID_SDK_ROOT.'
}

$localGradleCache = Join-Path $projectRoot '.android-tools\gradle-cache'
if (-not $env:GRADLE_USER_HOME -and (Test-Path -LiteralPath $localGradleCache)) {
    $env:GRADLE_USER_HOME = $localGradleCache
}

Push-Location $projectRoot
try {
    & npm run android:sync
    if ($LASTEXITCODE -ne 0) { throw 'Falló la sincronización de Capacitor.' }

    Push-Location $androidRoot
    try {
        & $wrapper assembleDebug --no-daemon
        if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de Gradle.' }
    }
    finally { Pop-Location }

    if (-not (Test-Path -LiteralPath $sourceApk)) {
        throw 'Gradle terminó sin producir app-debug.apk.'
    }
    Copy-Item -LiteralPath $sourceApk -Destination $outputApk -Force
    Write-Output "APK lista: $outputApk"
}
finally { Pop-Location }
