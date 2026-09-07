@echo off
title Instalador de Impresion Silenciosa The Villa Dog
echo =======================================================
echo    INSTALADOR DE IMPRESION SILENCIOSA THE VILLA DOG (AUTOMATICO)
echo =======================================================
echo.

:: Detectar ruta del directorio actual
set "CURRENT_DIR=%~dp0"
set "EXE_PATH=%CURRENT_DIR%the-villa-dog-printer-bridge.exe"
set "VBS_PATH=%CURRENT_DIR%iniciar_puente.vbs"
set "WATCHDOG_PATH=%CURRENT_DIR%vigilar_puente.vbs"
set "CONFIG_PATH=%CURRENT_DIR%config.json"

:: La URL y el token son datos estables de la instalacion. La IP de cada
:: impresora se administra despues desde Configuracion en el sistema web.
set "BACKEND_URL=%~1"
if not defined BACKEND_URL set /p "BACKEND_URL=URL del servidor Railway (https://...): "
set "BRIDGE_TOKEN=%~2"
if not defined BRIDGE_TOKEN set /p "BRIDGE_TOKEN=Token PRINT_BRIDGE_TOKEN de Railway: "

if not defined BACKEND_URL (
    echo [ERROR] Debes indicar la URL publica de Railway.
    pause
    exit /b 1
)
if not defined BRIDGE_TOKEN (
    echo [ERROR] Debes indicar el token configurado como PRINT_BRIDGE_TOKEN en Railway.
    pause
    exit /b 1
)

:: Detener cualquier proceso previo del puente local
echo Deteniendo versiones anteriores...
taskkill /F /IM the-villa-dog-printer-bridge.exe >nul 2>&1

:: Verificar si el ejecutable existe en la misma carpeta
if not exist "%EXE_PATH%" (
    echo.
    echo [ERROR] No se encontro the-villa-dog-printer-bridge.exe en esta carpeta.
    echo Asegurate de descargar el puente local y colocar este instalador en la misma carpeta.
    echo.
    pause
    exit /b
)

:: Crear o actualizar config.json automáticamente con la URL correcta
echo Configurando conexion al servidor...
(
echo {
echo   "backendUrl": "%BACKEND_URL%",
echo   "bridgeToken": "%BRIDGE_TOKEN%",
echo   "pollIntervalMs": 3000
echo }
) > "%CONFIG_PATH%"

:: Crear el script VBS silencioso
echo Creando script de inicio silencioso...
(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo WshShell.Run Chr^(34^) ^& "%EXE_PATH%" ^& Chr^(34^), 0, false
) > "%VBS_PATH%"

:: Vigilante liviano: si otra aplicacion o Windows cierra el puente, lo levanta
:: de nuevo como maximo un minuto despues, sin mostrar ventanas.
echo Creando recuperacion automatica...
(
echo Set service = GetObject^("winmgmts:\\.\root\cimv2"^)
echo Set processes = service.ExecQuery^("Select * From Win32_Process Where Name='the-villa-dog-printer-bridge.exe'"^)
echo If processes.Count = 0 Then
echo   Set shell = CreateObject^("WScript.Shell"^)
echo   shell.Run Chr^(34^) ^& "%EXE_PATH%" ^& Chr^(34^), 0, false
echo End If
) > "%WATCHDOG_PATH%"

:: Obtener la ruta de la carpeta Startup (Inicio) de Windows
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

:: Crear un archivo VBS temporal para generar el acceso directo en Inicio
set "SHORTCUT_CREATOR=%temp%\create_shortcut.vbs"
echo Set oWS = CreateObject^("WScript.Shell"^) > "%SHORTCUT_CREATOR%"
echo sLinkFile = "%STARTUP_DIR%\TheVillaDogPrinterBridge.lnk" >> "%SHORTCUT_CREATOR%"
echo Set oLink = oWS.CreateShortcut^(sLinkFile^) >> "%SHORTCUT_CREATOR%"
echo oLink.TargetPath = "%VBS_PATH%" >> "%SHORTCUT_CREATOR%"
echo oLink.WorkingDirectory = "%CURRENT_DIR%" >> "%SHORTCUT_CREATOR%"
echo oLink.Save >> "%SHORTCUT_CREATOR%"

:: Ejecutar el creador de acceso directo y luego borrarlo
cscript //nologo "%SHORTCUT_CREATOR%"
del "%SHORTCUT_CREATOR%"

:: Ejecutar el vigilante cada minuto para recuperarse de cierres inesperados.
schtasks /Create /TN "TheVillaDogPrinterBridgeWatchdog" /TR "wscript.exe \"%WATCHDOG_PATH%\"" /SC MINUTE /MO 1 /F >nul 2>&1

echo.
echo [EXITO] ¡Puente de impresion THE VILLA DOG configurado e iniciado de forma 100%% automatica!
echo Se ejecutara automaticamente cada vez que enciendas el computador.
echo.
echo Iniciando servicio en segundo plano...
start "" wscript.exe "%WATCHDOG_PATH%"
echo.
echo Listo. Ya puedes cerrar esta ventana.
timeout /t 5 >nul
exit
