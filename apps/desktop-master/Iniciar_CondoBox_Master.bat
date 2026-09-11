@echo off
chcp 65001 > nul
title CondoBox SaaS Master

set ROOT_DIR=%~dp0..\..\

:: 1. Fecha instâncias zumbis anteriores
taskkill /F /IM electron.exe 2>nul

:: 2. Verifica se o servidor local do sistema está ativo
netstat -ano | findstr :3000 >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [1/2] Iniciando servidor web do sistema...
    start "CondoBox Server" /min cmd /c "cd /d %ROOT_DIR%apps\web && npm run dev"
    timeout /t 4 /nobreak >nul
) else (
    echo [1/2] Servidor web já está ativo.
)

:: 3. Abre o programa do proprietário
echo [2/2] Abrindo aplicativo CondoBox Master...
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
