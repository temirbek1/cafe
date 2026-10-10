@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Stop-Cafe.ps1"
if /I not "%~1"=="-NoPause" pause
