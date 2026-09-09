@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Instalar Puente de Impresion - The Villa Dog
color 0A

set "SOURCE_DIR=%~dp0"
set "INSTALL_DIR=%LOCALAPPDATA%\TheVillaDog\PrinterBridge"
set "TARGET_EXE=%INSTALL_DIR%\TheVillaDogBridge.exe"
set "CONFIG_PATH=%INSTALL_DIR%\config.json"
set "LAUNCHER_PATH=%INSTALL_DIR%\iniciar_puente.vbs"
set "UNINSTALL_PATH=%INSTALL_DIR%\desinstalar_puente.bat"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_DIR%\TheVillaDogPrinterBridge.lnk"

rem Backend URL predeterminado si no viene definido
if not defined BRIDGE_BACKEND_URL (
  if not "%~2"=="" (
    set "BRIDGE_BACKEND_URL=%~2"
  ) else (
    set "BRIDGE_BACKEND_URL=https://the-villa-dog-backend-production.up.railway.app"
  )
)

rem Token predeterminado si viene como argumento %1 o preconfigurado de Railway
if not defined BRIDGE_TOKEN (
  if not "%~1"=="" (
    set "BRIDGE_TOKEN=%~1"
  ) else (
    set "BRIDGE_TOKEN=1e855b5dc09473209300ce27a6203479ad5dcdd664ce8ccfa62d013b49100135"
  )
)

echo ==============================================================
echo       INSTALADOR DEL PUENTE DE IMPRESION - THE VILLA DOG
echo ==============================================================
echo.
echo Esta instalacion configura el puente para que funcione en segundo
echo plano y arranque solo cada vez que se encienda este computador.
echo.

rem 1. Crear carpeta destino
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%" >nul 2>&1
if not exist "%INSTALL_DIR%" (
  echo [ERROR] Windows impidio crear la carpeta de instalacion en:
  echo %INSTALL_DIR%
  pause
  exit /b 1
)

rem 2. Copiar o descargar el ejecutable autonomo
if exist "%SOURCE_DIR%TheVillaDogBridge.exe" (
  echo Copiando ejecutable local TheVillaDogBridge.exe...
  copy /Y "%SOURCE_DIR%TheVillaDogBridge.exe" "%TARGET_EXE%" >nul
) else if exist "%SOURCE_DIR%Instalar-Impresion-TheVillaDog.exe" (
  echo Copiando ejecutable local Instalar-Impresion-TheVillaDog.exe...
  copy /Y "%SOURCE_DIR%Instalar-Impresion-TheVillaDog.exe" "%TARGET_EXE%" >nul
) else if not exist "%TARGET_EXE%" (
  echo Descargando TheVillaDogBridge.exe desde el servidor...
  echo Servidor: %BRIDGE_BACKEND_URL%
  where curl.exe >nul 2>&1
  if not errorlevel 1 (
    curl.exe --fail --location --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 180 --progress-bar --output "%TARGET_EXE%" "%BRIDGE_BACKEND_URL%/downloads/TheVillaDogBridge.exe"
  ) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 -Uri ($env:BRIDGE_BACKEND_URL + '/downloads/TheVillaDogBridge.exe') -OutFile $env:TARGET_EXE; exit 0 } catch { Write-Host $_; exit 1 }"
  )
)

if not exist "%TARGET_EXE%" (
  echo [AVISO] No se pudo obtener TheVillaDogBridge.exe de forma automatica.
  echo Copia el archivo TheVillaDogBridge.exe en la misma carpeta que este instalador y reintenta.
  pause
  exit /b 1
)

rem 3. Solicitar o conservar la clave PRINT_BRIDGE_TOKEN
if defined BRIDGE_TOKEN goto token_ok

if exist "%CONFIG_PATH%" (
  echo Se detecto una instalacion previa en este equipo.
  echo Para conservar la clave actual, presiona ENTER.
  echo Para cambiarla, escribe la nueva clave.
  set /p "BRIDGE_TOKEN=Clave PRINT_BRIDGE_TOKEN: "
) else (
  echo.
  echo Introduce la clave del puente de impresion (PRINT_BRIDGE_TOKEN)
  echo Puedes consultarla en Configuración -^> Cocina domicilios en el sistema.
  echo.
  set /p "BRIDGE_TOKEN=Pega la clave PRINT_BRIDGE_TOKEN: "
  if not defined BRIDGE_TOKEN (
    echo.
    echo [ERROR] La clave PRINT_BRIDGE_TOKEN es requerida.
    pause
    exit /b 1
  )
)

:token_ok

rem 4. Guardar archivo config.json
echo Guardando configuracion...
if defined BRIDGE_TOKEN (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$cfg = [ordered]@{ backendUrl = $env:BRIDGE_BACKEND_URL; bridgeToken = $env:BRIDGE_TOKEN; pollIntervalMs = 3000 }; $cfg | ConvertTo-Json | Set-Content -LiteralPath $env:CONFIG_PATH -Encoding UTF8"
) else (
  if not exist "%CONFIG_PATH%" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$cfg = [ordered]@{ backendUrl = $env:BRIDGE_BACKEND_URL; bridgeToken = ''; pollIntervalMs = 3000 }; $cfg | ConvertTo-Json | Set-Content -LiteralPath $env:CONFIG_PATH -Encoding UTF8"
  )
)

rem 5. Detener instancias anteriores si existen
echo Cerrando instancias previas...
taskkill /F /IM TheVillaDogBridge.exe >nul 2>&1
taskkill /F /IM Instalar-Impresion-TheVillaDog.exe >nul 2>&1

rem 6. Crear launcher VBS (ejecuta sin ventana negra de consola)
(
  echo Set shell = CreateObject^("WScript.Shell"^)
  echo shell.CurrentDirectory = "%INSTALL_DIR%"
  echo shell.Run """%TARGET_EXE%""", 0, False
) > "%LAUNCHER_PATH%"

rem 7. Crear acceso directo en Inicio de Windows
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut($env:SHORTCUT_PATH); $s.TargetPath = $env:LAUNCHER_PATH; $s.WorkingDirectory = $env:INSTALL_DIR; $s.Description = 'The Villa Dog Printer Bridge'; $s.Save()"

rem 8. Crear script de desinstalacion
(
  echo @echo off
  echo title Desinstalar Puente The Villa Dog
  echo echo Deteniendo puente de impresion...
  echo taskkill /F /IM TheVillaDogBridge.exe ^>nul 2^>^&1
  echo del /Q "%SHORTCUT_PATH%" ^>nul 2^>^&1
  echo echo Acceso directo de inicio eliminado.
  echo echo Si deseas eliminar los datos, borra la carpeta:
  echo echo %INSTALL_DIR%
  echo echo Desinstalacion completada con exito.
  echo pause
) > "%UNINSTALL_PATH%"

rem 9. Iniciar el puente en segundo plano
echo Iniciando puente de impresion...
wscript.exe "%LAUNCHER_PATH%"

echo.
echo ==============================================================
echo         [OK] INSTALACION COMPLETADA CORRECTAMENTE
echo ==============================================================
echo - El ejecutable quedo en: %INSTALL_DIR%
echo - Se configuraron las impresoras con el servidor: %BRIDGE_BACKEND_URL%
echo - El servicio iniciara automaticamente con Windows.
echo - Para desinstalarlo en el futuro, ejecuta desinstalar_puente.bat
echo ==============================================================
echo.
timeout /t 5 >nul 2>&1
exit /b 0
