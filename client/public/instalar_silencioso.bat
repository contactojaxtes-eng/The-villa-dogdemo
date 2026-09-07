@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Instalar impresion automatica - The Villa Dog
color 0F

set "SOURCE_DIR=%~dp0"
set "SOURCE_EXE=%SOURCE_DIR%the-villa-dog-printer-bridge.exe"
if not exist "%SOURCE_EXE%" set "SOURCE_EXE=%SOURCE_DIR%bridge.exe"
set "INSTALL_DIR=%LOCALAPPDATA%\TheVillaDog\PrinterBridge"
set "INSTALLED_EXE=%INSTALL_DIR%\the-villa-dog-printer-bridge.exe"
set "CONFIG_PATH=%INSTALL_DIR%\config.json"
set "LAUNCHER_PATH=%INSTALL_DIR%\iniciar_puente.vbs"
set "WATCHDOG_PATH=%INSTALL_DIR%\vigilar_puente.vbs"
set "UNINSTALL_PATH=%INSTALL_DIR%\desinstalar_puente.bat"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_DIR%\TheVillaDogPrinterBridge.lnk"
set "TASK_NAME=TheVillaDogPrinterBridgeWatchdog"
set "BACKEND_URL=https://the-villa-dog-backend-production.up.railway.app"

echo ==============================================================
echo       IMPRESION AUTOMATICA - THE VILLA DOG
echo ==============================================================
echo.
echo Esta instalacion se realiza una sola vez. El puente se iniciara
echo con Windows y se recuperara solo si otra aplicacion lo cierra.
echo.

if not exist "%SOURCE_EXE%" (
  echo [ERROR] El instalador no encontro el componente de impresion.
  echo Descarga nuevamente el instalador desde Configuracion.
  echo.
  pause
  exit /b 1
)

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%" >nul 2>&1
if not exist "%INSTALL_DIR%" (
  echo [ERROR] Windows no permitio crear la carpeta de instalacion.
  echo.
  pause
  exit /b 1
)

set "BRIDGE_TOKEN="
if exist "%CONFIG_PATH%" (
  echo Se encontro una instalacion anterior. Se conservara su clave.
  echo Para reemplazarla, escribe una nueva. Para conservarla, pulsa Enter.
  set /p "BRIDGE_TOKEN=Nueva clave PRINT_BRIDGE_TOKEN: "
) else (
  echo Copia el valor PRINT_BRIDGE_TOKEN de Railway y pegalo aqui.
  echo Solo se solicita durante esta primera instalacion.
  set /p "BRIDGE_TOKEN=Clave PRINT_BRIDGE_TOKEN: "
  if not defined BRIDGE_TOKEN (
    echo.
    echo [ERROR] La clave es obligatoria en la primera instalacion.
    pause
    exit /b 1
  )
)

echo.
echo Instalando en una ubicacion estable...
taskkill /F /IM the-villa-dog-printer-bridge.exe >nul 2>&1
copy /Y "%SOURCE_EXE%" "%INSTALLED_EXE%" >nul
if errorlevel 1 (
  echo [ERROR] No se pudo copiar el puente a %INSTALL_DIR%
  pause
  exit /b 1
)

if defined BRIDGE_TOKEN (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$config = [ordered]@{ backendUrl = $env:BACKEND_URL; bridgeToken = $env:BRIDGE_TOKEN; pollIntervalMs = 3000 }; $config | ConvertTo-Json | Set-Content -LiteralPath $env:CONFIG_PATH -Encoding UTF8"
  if errorlevel 1 (
    echo [ERROR] No se pudo guardar la configuracion.
    pause
    exit /b 1
  )
)

(
  echo Set shell = CreateObject^("WScript.Shell"^)
  echo shell.Run Chr^(34^) ^& "%INSTALLED_EXE%" ^& Chr^(34^), 0, False
) > "%LAUNCHER_PATH%"

(
  echo On Error Resume Next
  echo Set service = GetObject^("winmgmts:\\.\root\cimv2"^)
  echo Set processes = service.ExecQuery^("Select * From Win32_Process Where Name='the-villa-dog-printer-bridge.exe'"^)
  echo If processes.Count = 0 Then
  echo   Set shell = CreateObject^("WScript.Shell"^)
  echo   shell.Run Chr^(34^) ^& "%INSTALLED_EXE%" ^& Chr^(34^), 0, False
  echo End If
) > "%WATCHDOG_PATH%"

(
  echo @echo off
  echo taskkill /F /IM the-villa-dog-printer-bridge.exe ^>nul 2^>^&1
  echo schtasks /Delete /TN "%TASK_NAME%" /F ^>nul 2^>^&1
  echo del /Q "%SHORTCUT_PATH%" ^>nul 2^>^&1
  echo echo Puente de impresion desinstalado.
  echo pause
  echo start "" cmd /c "timeout /t 2 ^>nul ^& rmdir /S /Q ""%INSTALL_DIR%"""
) > "%UNINSTALL_PATH%"

set "SHORTCUT_CREATOR=%TEMP%\the_villa_dog_shortcut_%RANDOM%.vbs"
(
  echo Set shell = CreateObject^("WScript.Shell"^)
  echo Set shortcut = shell.CreateShortcut^("%SHORTCUT_PATH%"^)
  echo shortcut.TargetPath = "wscript.exe"
  echo shortcut.Arguments = "//B //NoLogo ""%WATCHDOG_PATH%"""
  echo shortcut.WorkingDirectory = "%INSTALL_DIR%"
  echo shortcut.Description = "Puente de impresion The Villa Dog"
  echo shortcut.Save
) > "%SHORTCUT_CREATOR%"
cscript.exe //B //NoLogo "%SHORTCUT_CREATOR%"
del /Q "%SHORTCUT_CREATOR%" >nul 2>&1

schtasks /Create /TN "%TASK_NAME%" /TR "wscript.exe //B //NoLogo \"%WATCHDOG_PATH%\"" /SC MINUTE /MO 1 /F >nul 2>&1
if errorlevel 1 (
  echo [AVISO] Windows no permitio crear el vigilante por minuto.
  echo El inicio automatico de Windows si quedo configurado.
)

start "" wscript.exe //B //NoLogo "%WATCHDOG_PATH%"

echo.
echo ==============================================================
echo [LISTO] Puente instalado e iniciado en segundo plano.
echo ==============================================================
echo - No necesitas abrirlo cada dia.
echo - Inicia automaticamente al entrar a Windows.
echo - El vigilante lo recupera si se cierra.
echo - Diagnostico: %INSTALL_DIR%\bridge.log
echo - Desinstalar: %UNINSTALL_PATH%
echo.
echo Ya puedes enviar una prueba desde Configuracion - Cocina domicilios.
echo.
pause
exit /b 0
