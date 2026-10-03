@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-codeme.ps1" %*
exit /b %ERRORLEVEL%
