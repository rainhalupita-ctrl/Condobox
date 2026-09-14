@echo off
title CondoBox SaaS Master

REM 1. Fecha eventuais instancias anteriores do Electron
taskkill /F /IM electron.exe >nul 2>&1

REM 2. Garante que o servidor web (3000) e a API local (3001) estejam rodando de forma 100% invisivel
netstat -ano | findstr :3000 >nul 2>&1
if %ERRORLEVEL% neq 0 (
    powershell -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList '/c npm run dev' -WorkingDirectory '%~dp0apps\web' -WindowStyle Hidden"
)

netstat -ano | findstr :3001 >nul 2>&1
if %ERRORLEVEL% neq 0 (
    powershell -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd.exe -ArgumentList '/c npm run dev' -WorkingDirectory '%~dp0apps\local-api' -WindowStyle Hidden"
)

REM 2.1 Garante que o Microservico EasyOCR (5055) esteja rodando em segundo plano
netstat -ano | findstr :5055 >nul 2>&1
if %ERRORLEVEL% neq 0 (
    if exist "%~dp0tools\easyocr\.venv\Scripts\python.exe" (
        powershell -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~dp0tools\easyocr\.venv\Scripts\python.exe' -ArgumentList '%~dp0tools\easyocr\easyocr_bridge.py --serve --port 5055' -WindowStyle Hidden"
    )
)

set "ELECTRON_EXE=%~dp0apps\desktop\node_modules\electron\dist\electron.exe"
set "APP_DIR=%~dp0apps\desktop-master"

REM 3. Inicia o aplicativo Desktop Master diretamente
cd /d "%APP_DIR%"
if exist "%ELECTRON_EXE%" (
    start "" "%ELECTRON_EXE%" .
    exit
)

where electron >nul 2>&1
if %ERRORLEVEL% equ 0 (
    start "" electron .
    exit
)

call npx electron .
exit
