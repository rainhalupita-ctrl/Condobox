@echo off
chcp 65001 > nul
title Iniciar CondoBox SaaS Master

set ROOT_DIR=%~dp0

echo =======================================================
echo    👑 CONDOBOX SAAS MASTER - PROGRAMA DO PROPRIETÁRIO
echo =======================================================
echo.

netstat -ano | findstr :3000 >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [1/2] Inicializando servidor web em segundo plano...
    start "CondoBox Server" /min cmd /c "cd /d "%ROOT_DIR%apps\web" && npm run dev"
    timeout /t 4 /nobreak >nul
) else (
    echo [1/2] Servidor web ativo e respondendo.
)

echo [2/2] Abrindo aplicativo executivo CondoBox Master...
cd /d "%ROOT_DIR%apps\desktop-master"

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
