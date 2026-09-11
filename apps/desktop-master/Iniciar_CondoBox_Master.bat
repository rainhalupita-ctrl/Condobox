@echo off
chcp 65001 > nul
title Iniciar CondoBox SaaS Master

cd /d "%~dp0"

if exist "..\desktop\node_modules\electron\dist\electron.exe" (
    start "" "..\desktop\node_modules\electron\dist\electron.exe" .
    exit
)

where electron >nul 2>nul
if %ERRORLEVEL% equ 0 (
    start "" electron .
    exit
)

call npx electron .
exit
