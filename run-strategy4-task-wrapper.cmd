@echo off
"C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0run-strategy4.ps1"
exit /b %ERRORLEVEL%
