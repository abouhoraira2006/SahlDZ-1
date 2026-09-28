@echo off
REM ============================================================
REM   SahlDZ Desktop - Build Script (Windows 7 SP1 compatible)
REM
REM   IMPORTANT - do not raise the Electron version:
REM   Electron >= 23 hard-imports KERNEL32!DiscardVirtualMemory,
REM   which only exists on Windows 10 1803+.  On the Win7 terminals
REM   the cashier/kitchen use, the loader aborts with
REM   "Point d'entrée de procedure DiscardVirtual Memory introuvable".
REM   Electron 22.3.27 is the newest 22.x and the last Win7-safe line.
REM   The check at the end of this script enforces that.
REM ============================================================
setlocal
cd /d "%~dp0"

echo ============================================================
echo   SahlDZ Desktop - Build Script
echo   Target: Windows 7 SP1 / 8 / 8.1 / 10+  -  ia32 (x86)
echo ============================================================
echo.

REM ---- 0. Sanity check: refuse to build with a too-new Electron ----
for /f "delims=" %%v in ('node -p "require('./package.json').devDependencies.electron"') do set PINNED=%%v
echo [0/4] Pinned Electron: %PINNED%
node -e "const m=require('./package.json').devDependencies.electron.match(/(\d+)\./);if(m&&+m[1]>22){console.error('FATAL: Electron '+require('./package.json').devDependencies.electron+' drops Windows 7. Pin 22.3.27.');process.exit(1)}"
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Electron version is not Windows 7 compatible.
    echo        Install electron@22.3.27 and rebuild.
    pause
    exit /b 1
)

echo.
echo [1/4] Removing previous output (stale x64 builds are a known trap)...
if exist "release-build" rmdir /s /q "release-build"
if exist "release" rmdir /s /q "release"
if exist "release2" rmdir /s /q "release2"
if exist "release3" rmdir /s /q "release3"
if exist "release4" rmdir /s /q "release4"

echo.
echo [2/4] Installing dependencies...
REM If github.com release downloads time out, uncomment the mirror below.
REM set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
call npm install
if %errorlevel% neq 0 (
    echo Error installing dependencies!
    pause
    exit /b 1
)

echo.
echo [3/4] Building Windows ia32 package...
call npx electron-builder --win --ia32
if %errorlevel% neq 0 (
    echo Error building desktop app!
    pause
    exit /b 1
)

echo.
echo [4/4] Verifying Windows 7 compatibility of the produced binaries...
node ..\scripts\check-win7-compat.cjs "release-build\win-ia32-unpacked"
if %errorlevel% neq 0 (
    echo.
    echo ERROR: the build requires Windows 10 1803 or newer.
    echo        DO NOT ship it to the cashier/kitchen terminals.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Build complete and Win7-safe.
echo   Output: desktop\release-build\SahlDZ Setup *.exe
echo ============================================================
pause
