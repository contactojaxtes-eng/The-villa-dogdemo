@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Instalar impresion automatica - The Villa Dog
color 0F

set "SOURCE_DIR=%~dp0"
set "INSTALL_DIR=%LOCALAPPDATA%\TheVillaDog\PrinterBridge"
set "BRIDGE_JS=%INSTALL_DIR%\printer-bridge.js"
set "CONFIG_PATH=%INSTALL_DIR%\config.json"
set "LAUNCHER_PATH=%INSTALL_DIR%\iniciar_puente.vbs"
set "WATCHDOG_PATH=%INSTALL_DIR%\vigilar_puente.vbs"
set "UNINSTALL_PATH=%INSTALL_DIR%\desinstalar_puente.bat"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_DIR%\TheVillaDogPrinterBridge.lnk"
set "TASK_NAME=TheVillaDogPrinterBridgeWatchdog"
set "NODE_DIR=%INSTALL_DIR%\node"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NODE_VERSION=v20.18.1"
set "NODE_ARCH=win-x64"
set "NODE_ZIP=%TEMP%\node-%NODE_VERSION%-%NODE_ARCH%.zip"
set "NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-%NODE_ARCH%.zip"

rem --- Backend URL: se sobreescribe si el .cmd lanzador define BRIDGE_BACKEND_URL ---
if not defined BRIDGE_BACKEND_URL set "BRIDGE_BACKEND_URL=http://localhost:3000"

echo ==============================================================
echo       IMPRESION AUTOMATICA - THE VILLA DOG
echo ==============================================================
echo.
echo Esta instalacion se realiza una sola vez. El puente se iniciara
echo con Windows y se recuperara solo si otra aplicacion lo cierra.

rem --- Crear directorio de instalacion ---
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%" >nul 2>&1
if not exist "%INSTALL_DIR%" (
  echo [ERROR] Windows no permitio crear la carpeta de instalacion.
  echo.
  pause
  exit /b 1
)

rem --- Copiar printer-bridge.js desde el directorio del instalador si existe ---
set "SOURCE_JS=%SOURCE_DIR%printer-bridge.js"
if exist "%SOURCE_JS%" (
  copy /Y "%SOURCE_JS%" "%BRIDGE_JS%" >nul
) else (
  rem --- Descargar printer-bridge.js del backend ---
  echo Descargando componente de impresion...
  where curl.exe >nul 2>&1
  if not errorlevel 1 (
    curl.exe --fail --location --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 60 --progress-bar --output "%BRIDGE_JS%" "%BRIDGE_BACKEND_URL%/downloads/printer-bridge.js"
  ) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri ($env:BRIDGE_BACKEND_URL + '/downloads/printer-bridge.js') -OutFile $env:BRIDGE_JS; exit 0 } catch { Write-Host $_; exit 1 }"
  )
  if not exist "%BRIDGE_JS%" (
    echo [ERROR] No se pudo descargar el componente de impresion.
    echo Comprueba la conexion a Internet o el servidor.
    pause
    exit /b 1
  )
)

rem --- Verificar o instalar Node.js portable ---
if exist "%NODE_EXE%" goto node_ready

echo.
echo Verificando si Node.js esta disponible...
where node.exe >nul 2>&1
if not errorlevel 1 (
  echo Node.js del sistema detectado.
  for /f "delims=" %%I in ('where node.exe') do set "NODE_EXE=%%I"
  goto node_ready
)

echo Descargando Node.js portable (solo una vez, ~30 MB)...
if not exist "%NODE_DIR%" mkdir "%NODE_DIR%" >nul 2>&1

where curl.exe >nul 2>&1
if not errorlevel 1 (
  curl.exe --fail --location --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 300 --progress-bar --output "%NODE_ZIP%" "%NODE_URL%"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 300 -Uri $env:NODE_URL -OutFile $env:NODE_ZIP; exit 0 } catch { Write-Host $_; exit 1 }"
)

if not exist "%NODE_ZIP%" (
  echo [ERROR] No se pudo descargar Node.js.
  echo Instala Node.js manualmente desde https://nodejs.org y ejecuta este instalador de nuevo.
  pause
  exit /b 1
)

echo Extrayendo Node.js...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Expand-Archive -Path $env:NODE_ZIP -DestinationPath $env:NODE_DIR -Force; exit 0 } catch { Write-Host $_; exit 1 }"
if errorlevel 1 (
  echo [ERROR] No se pudo extraer Node.js.
  pause
  exit /b 1
)

rem --- Mover node.exe del subdirectorio al directorio raiz de Node ---
for /d %%D in ("%NODE_DIR%\node-*") do (
  if exist "%%D\node.exe" (
    move /Y "%%D\node.exe" "%NODE_EXE%" >nul 2>&1
    rmdir /S /Q "%%D" >nul 2>&1
  )
)

del /Q "%NODE_ZIP%" >nul 2>&1

if not exist "%NODE_EXE%" (
  echo [ERROR] node.exe no se encontro despues de la extraccion.
  echo Instala Node.js manualmente desde https://nodejs.org
  pause
  exit /b 1
)
echo Node.js portable instalado correctamente.

:node_ready

rem --- Solicitar o conservar token ---
if defined BRIDGE_TOKEN goto token_ready
set "BRIDGE_TOKEN="
if exist "%CONFIG_PATH%" (
  echo Se encontro una instalacion anterior. Se conservara su clave.
  echo Para reemplazarla, escribe una nueva. Para conservarla, pulsa Enter.
  set /p "BRIDGE_TOKEN=Nueva clave PRINT_BRIDGE_TOKEN: "
) else (
  echo Copia el valor PRINT_BRIDGE_TOKEN del servidor y pegalo aqui.
  echo Solo se solicita durante esta primera instalacion.
  set /p "BRIDGE_TOKEN=Clave PRINT_BRIDGE_TOKEN: "
  if not defined BRIDGE_TOKEN (
    echo.
    echo [ERROR] La clave es obligatoria en la primera instalacion.
    pause
    exit /b 1
  )
)
:token_ready

rem --- Detener instancias anteriores ---
echo Instalando en una ubicacion estable...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq TheVillaDogBridge" >nul 2>&1

rem --- Guardar configuracion ---
if defined BRIDGE_TOKEN (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$config = [ordered]@{ backendUrl = $env:BRIDGE_BACKEND_URL; bridgeToken = $env:BRIDGE_TOKEN; pollIntervalMs = 3000 }; $config | ConvertTo-Json | Set-Content -LiteralPath $env:CONFIG_PATH -Encoding UTF8"
  if errorlevel 1 (
    echo [ERROR] No se pudo guardar la configuracion.
    pause
    exit /b 1
  )
)

rem --- Crear launcher VBS (ejecuta node printer-bridge.js oculto) ---
(
  echo Set shell = CreateObject^("WScript.Shell"^)
  echo shell.Run "cmd /c title TheVillaDogBridge & """ ^& "%NODE_EXE%" ^& """ """ ^& "%BRIDGE_JS%" ^& """", 0, False
) > "%LAUNCHER_PATH%"

rem --- Crear watchdog VBS ---
(
  echo On Error Resume Next
  echo Set service = GetObject^("winmgmts:\\.\root\cimv2"^)
  echo Set processes = service.ExecQuery^("Select * From Win32_Process Where CommandLine Like '%%printer-bridge.js%%'"^)
  echo If processes.Count = 0 Then
  echo   Set shell = CreateObject^("WScript.Shell"^)
  echo   shell.Run "cmd /c title TheVillaDogBridge & """ ^& "%NODE_EXE%" ^& """ """ ^& "%BRIDGE_JS%" ^& """", 0, False
  echo End If
) > "%WATCHDOG_PATH%"

rem --- Crear desinstalador ---
(
  echo @echo off
  echo taskkill /F /FI "WINDOWTITLE eq TheVillaDogBridge" ^>nul 2^>^&1
  echo schtasks /Delete /TN "%TASK_NAME%" /F ^>nul 2^>^&1
  echo del /Q "%SHORTCUT_PATH%" ^>nul 2^>^&1
  echo echo Puente de impresion desinstalado.
  echo pause
  echo start "" cmd /c "timeout /t 2 ^>nul ^& rmdir /S /Q ""%INSTALL_DIR%"""
) > "%UNINSTALL_PATH%"

rem --- Crear acceso directo en Startup ---
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

rem --- Crear tarea programada de vigilancia ---
schtasks /Create /TN "%TASK_NAME%" /TR "wscript.exe //B //NoLogo \"%WATCHDOG_PATH%\"" /SC MINUTE /MO 1 /F >nul 2>&1
if errorlevel 1 (
  echo [AVISO] Windows no permitio crear el vigilante por minuto.
  echo El inicio automatico de Windows si quedo configurado.
)

rem --- Iniciar el puente ---
start "" wscript.exe //B //NoLogo "%WATCHDOG_PATH%"

echo.
echo ==============================================================
echo [LISTO] Puente instalado e iniciado en segundo plano.
echo ==============================================================
echo - Inicia automaticamente al entrar a Windows.
echo - El vigilante lo recupera si se cierra.
echo - Diagnostico: %INSTALL_DIR%\bridge.log
echo.
echo Ya puedes enviar una prueba desde Configuracion - Cocina domicilios.
exit /b 0
