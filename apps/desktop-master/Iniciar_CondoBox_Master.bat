@echo off
title CondoBox SaaS Master

REM 1. Fecha eventuais instancias anteriores do Electron
taskkill /F /IM electron.exe >nul 2>&1

REM 2. Garante que o servidor web esteja rodando na porta 3000 de forma 100% invisivel
netstat -ano | findstr :3000 >nul 2>&1
if %ERRORLEVEL% neq 0 (
    powershell -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList '/c npm run dev' -WorkingDirectory '%~dp0..\web' -WindowStyle Hidden"
)

set "ELECTRON_EXE=%~dp0..\desktop\node_modules\electron\dist\electron.exe"
set "APP_DIR=%~dp0"

REM 3. Inicia o aplicativo Desktop Master diretamente
if exist "%ELECTRON_EXE%" (
    start "" /d "%APP_DIR%" "%ELECTRON_EXE%" "%APP_DIR%"
    exit
)

cd /d "%APP_DIR%"
where electron >nul 2>&1
if %ERRORLEVEL% equ 0 (
    start "" electron .
    exit
)

call npx electron .
exit
