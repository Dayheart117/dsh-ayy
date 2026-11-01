@echo off
rem Move the DSH sessions directory to E: and leave a junction behind.
rem Run this ONLY while DSH is fully closed (this script checks and refuses otherwise).
setlocal

set "SRC=C:\Users\dayheart\.dsh\sessions"
set "DST=E:\AI\dsh-data\sessions"

rem refuse when DSH is running
tasklist /fi "imagename eq DeepSeek Harness.exe" | find /i "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
  echo [STOP] DSH is still running. Close it completely, then run this again.
  pause
  exit /b 1
)

if not exist "%SRC%" (
  echo [SKIP] Source not found: %SRC%
  pause
  exit /b 0
)

rem already a junction? (dir /al lists reparse points)
dir /al "C:\Users\dayheart\.dsh" 2>nul | find /i "sessions" >nul
if not errorlevel 1 (
  echo [SKIP] sessions already looks like a junction.
  pause
  exit /b 0
)

echo Moving %SRC%  ->  %DST%
robocopy "%SRC%" "%DST%" /MOVE /E /NFL /NDL /NJH /NJS /NC /NS /R:1 /W:1
if exist "%SRC%" (
  echo [FAIL] Original folder still exists - something holds it. Nothing changed.
  pause
  exit /b 1
)
mklink /J "%SRC%" "%DST%"
echo.
echo Done. Start DSH again.
pause
