@echo off
cd /d "%~dp0"
call npm.cmd run backup
if errorlevel 1 pause
