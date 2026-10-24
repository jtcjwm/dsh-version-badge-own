@echo off
REM ============================================================
REM dsh-version-badge-own - auto update launcher
REM ------------------------------------------------------------
REM Double-click this file. It detaches a hidden PowerShell
REM process that does: plan -> stop host -> apply -> relaunch.
REM The hidden process is NOT a child of DSH, so killing DSH
REM will not kill it.
REM ============================================================

setlocal
set SCRIPT=D:\DSH\plugins\dsh-version-badge-own\scripts\auto-update.ps1
set LOGDIR=D:\DSH\_tmp\update-runner

if not exist "%LOGDIR%" mkdir "%LOGDIR%"

echo.
echo  ============================================
echo   DSH plugin auto-update
echo  ============================================
echo   It will: scan -^> close DSH -^> update plugins
echo            -^> relaunch DSH window
echo.
echo   Log:    %LOGDIR%\auto-update.log
echo   Report: %LOGDIR%\auto-update-report.json
echo.
echo   DSH will close in a few seconds. Window comes back
echo   by itself when the update finishes.
echo  ============================================
echo.

REM start detached hidden process, then return immediately
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT%"

echo  Launched. This window can be closed.
timeout /t 3 >nul
exit /b 0
