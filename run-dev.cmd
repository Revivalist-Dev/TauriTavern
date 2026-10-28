@echo off
rem ===========================================================================
rem  TauriTavern dev runner (Windows x64)
rem
rem  Starts scripts/tauri-dev-server.mjs, waits until the frontend is served,
rem  then launches the debug executable. The dev server is stopped again when
rem  the app exits, unless it was already running before this script started.
rem
rem  Usage:
rem    run-dev.cmd                 build when the exe is missing, then run
rem    run-dev.cmd --build         force a debug rebuild first
rem    run-dev.cmd --pilot         build/run with the Tauri Pilot feature
rem    run-dev.cmd --release       launch the release exe (no dev server)
rem    run-dev.cmd --no-server     launch the exe without managing the server
rem    run-dev.cmd --stop          stop a dev server started by this script
rem    run-dev.cmd --help          show this help
rem ===========================================================================

setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "DEV_URL=http://localhost:1430/"
set "MANIFEST=src-tauri\Cargo.toml"
set "DEBUG_EXE=src-tauri\target\debug\tauritavern.exe"
set "RELEASE_EXE=src-tauri\target\release\tauritavern.exe"
set "SERVER_SCRIPT=scripts\tauri-dev-server.mjs"
set "LOG_FILE=%TEMP%\tauritavern-dev-server.log"
set "ERR_FILE=%TEMP%\tauritavern-dev-server.err.log"
set "PID_FILE=%TEMP%\tauritavern-dev-server.pid"
set "FEATURES=control-api"
set "DO_BUILD=0"
set "START_SERVER=1"
set "SERVER_OWNED=0"
set "MODE=debug"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--help" goto usage
if /I "%~1"=="-h" goto usage
if /I "%~1"=="--build" set "DO_BUILD=1"
if /I "%~1"=="--pilot" set "FEATURES=control-api,devtools-pilot"
if /I "%~1"=="--release" set "MODE=release"
if /I "%~1"=="--no-server" set "START_SERVER=0"
if /I "%~1"=="--stop" goto stop_server
shift
goto parse_args
:args_done

where node >nul 2>&1
if errorlevel 1 (
    echo [tauritavern] Node.js was not found on PATH. Install Node 22.13+ first.
    exit /b 1
)
where cargo >nul 2>&1
if errorlevel 1 (
    echo [tauritavern] cargo was not found on PATH. Install the Rust toolchain first.
    exit /b 1
)
if not exist "%MANIFEST%" (
    echo [tauritavern] Run this script from the tauri-tavern checkout root.
    exit /b 1
)

if /I "%MODE%"=="release" goto run_release

set "EXE=%DEBUG_EXE%"
if "%DO_BUILD%"=="0" if not exist "%EXE%" set "DO_BUILD=1"

if "%DO_BUILD%"=="1" (
    echo [tauritavern] Building debug binary with features: %FEATURES%
    pushd src-tauri
    cargo build -p tauritavern --no-default-features --features "%FEATURES%"
    set "BUILD_RESULT=!ERRORLEVEL!"
    popd
    if not "!BUILD_RESULT!"=="0" (
        echo [tauritavern] Build failed.
        exit /b !BUILD_RESULT!
    )
)

if not exist "%EXE%" (
    echo [tauritavern] Missing %EXE% after the build.
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$exe = Get-Item -LiteralPath '%EXE%';" ^
    "$newest = Get-ChildItem -LiteralPath 'src-tauri\crates' -Recurse -File -Filter '*.rs' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1;" ^
    "if ($newest -and $newest.LastWriteTime -gt $exe.LastWriteTime) { exit 1 } else { exit 0 }"
if errorlevel 1 (
    echo [tauritavern] Warning: Rust sources are newer than %EXE%.
    echo [tauritavern] Run: run-dev.cmd --build
)

if "%START_SERVER%"=="0" goto launch

rem Reuse an already-running dev server instead of starting a second one.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try { $null = Invoke-WebRequest -UseBasicParsing -Uri '%DEV_URL%' -TimeoutSec 3; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
    echo [tauritavern] Reusing the dev server already listening on %DEV_URL%
    set "START_SERVER=0"
    goto launch
)

echo [tauritavern] Starting the frontend dev server...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "$p = Start-Process -FilePath 'node' -ArgumentList '%SERVER_SCRIPT%' -WorkingDirectory '%CD%' -RedirectStandardOutput '%LOG_FILE%' -RedirectStandardError '%ERR_FILE%' -WindowStyle Hidden -PassThru;" ^
    "Set-Content -LiteralPath '%PID_FILE%' -Value $p.Id -Encoding ascii"
if errorlevel 1 (
    echo [tauritavern] Could not start the dev server.
    exit /b 1
)
set "SERVER_OWNED=1"

echo [tauritavern] Waiting for %DEV_URL% ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$deadline = (Get-Date).AddSeconds(120);" ^
    "while ((Get-Date) -lt $deadline) {" ^
    "  try { $null = Invoke-WebRequest -UseBasicParsing -Uri '%DEV_URL%' -TimeoutSec 3; exit 0 }" ^
    "  catch { Start-Sleep -Milliseconds 500 }" ^
    "}; exit 1"
if errorlevel 1 (
    echo [tauritavern] The dev server did not become ready in 120 seconds.
    echo [tauritavern] Server log: %LOG_FILE%
    echo [tauritavern] Server errors: %ERR_FILE%
    if "%SERVER_OWNED%"=="1" call :stop_owned_server
    exit /b 1
)

:launch
title TauriTavern dev
echo [tauritavern] Launching %EXE%
start "" /wait "%EXE%"
set "APP_RESULT=%ERRORLEVEL%"

if "%SERVER_OWNED%"=="1" call :stop_owned_server
echo [tauritavern] App exited with code %APP_RESULT%.
exit /b %APP_RESULT%

:run_release
set "EXE=%RELEASE_EXE%"
if "%DO_BUILD%"=="1" (
    echo [tauritavern] Building release binary...
    pushd src-tauri
    cargo build --release -p tauritavern
    set "BUILD_RESULT=!ERRORLEVEL!"
    popd
    if not "!BUILD_RESULT!"=="0" (
        echo [tauritavern] Build failed.
        exit /b !BUILD_RESULT!
    )
)
if not exist "%EXE%" (
    echo [tauritavern] Missing %EXE%. Run: run-dev.cmd --release --build
    exit /b 1
)
echo [tauritavern] Launching %EXE% (embedded frontend, no dev server)
start "" /wait "%EXE%"
exit /b %ERRORLEVEL%

:stop_server
call :stop_owned_server
echo [tauritavern] Dev server stopped.
exit /b 0

:stop_owned_server
if not exist "%PID_FILE%" goto :eof
set "SERVER_PID="
for /f "usebackq delims=" %%p in ("%PID_FILE%") do set "SERVER_PID=%%p"
if not defined SERVER_PID goto cleanup_pid
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$pidFile = '%PID_FILE%';" ^
    "$serverPid = 0;" ^
    "if (Test-Path -LiteralPath $pidFile) { $serverPid = [int](Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1) };" ^
    "if ($serverPid -gt 0) {" ^
    "  $process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $serverPid) -ErrorAction SilentlyContinue;" ^
    "  if ($process -and $process.CommandLine -like '*tauri-dev-server.mjs*') {" ^
    "    taskkill /PID $serverPid /T /F *> $null" ^
    "  }" ^
    "}; Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue"
:cleanup_pid
goto :eof

:usage
echo TauriTavern dev runner
echo.
echo   run-dev.cmd                 build when the exe is missing, then run
echo   run-dev.cmd --build         force a debug rebuild first
echo   run-dev.cmd --pilot         build/run with the Tauri Pilot feature
echo   run-dev.cmd --release       launch the release exe (no dev server)
echo   run-dev.cmd --no-server     launch the exe without managing the server
echo   run-dev.cmd --stop          stop a dev server started by this script
echo.
echo Logs: %LOG_FILE% (stdout^), %ERR_FILE% (stderr^)
exit /b 0
