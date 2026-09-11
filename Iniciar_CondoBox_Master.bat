@echo off
chcp 65001 > nul
title Iniciar CondoBox SaaS Master

echo =======================================================
echo    👑 CONDOBOX SAAS MASTER - PROGRAMA DO PROPRIETÁRIO
echo =======================================================
echo.
echo Iniciando o Painel Central de Gestão SaaS...
echo.

set ELECTRON_PATH=%~dp0apps\desktop\node_modules\electron\dist\electron.exe
set APP_DIR=%~dp0apps\desktop-master

if exist "%ELECTRON_PATH%" (
    start "" "%ELECTRON_PATH%" "%APP_DIR%"
    exit
) else (
    where electron >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        start "" electron "%APP_DIR%"
        exit
    ) else (
        echo [!] Electron não encontrado localmente.
        echo Tentando iniciar via npm na pasta apps\desktop...
        cd /d "%~dp0apps\desktop"
        call npx electron "%APP_DIR%"
        exit
    )
)
