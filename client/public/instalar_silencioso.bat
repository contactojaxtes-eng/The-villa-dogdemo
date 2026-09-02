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
set "CONFIG_PATH=%CURRENT_DIR%config.json"

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
echo   "backendUrl": "http://localhost:3000"
echo }
) > "%CONFIG_PATH%"

:: Crear el script VBS silencioso
echo Creando script de inicio silencioso...
(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo WshShell.Run Chr^(34^) ^& "%EXE_PATH%" ^& Chr^(34^), 0, false
) > "%VBS_PATH%"

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

echo.
echo [EXITO] ¡Puente de impresion THE VILLA DOG configurado e iniciado de forma 100%% automatica!
echo Se ejecutara automaticamente cada vez que enciendas el computador.
echo.
echo Iniciando servicio en segundo plano...
start "" wscript.exe "%VBS_PATH%"
echo.
echo Listo. Ya puedes cerrar esta ventana.
timeout /t 5 >nul
exit
