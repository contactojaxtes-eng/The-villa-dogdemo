@echo off
setlocal EnableExtensions
title Desinstalar Puente de Impresion - The Villa Dog
color 0C

set "INSTALL_DIR=%LOCALAPPDATA%\TheVillaDog\PrinterBridge"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_DIR%\TheVillaDogPrinterBridge.lnk"

echo ==============================================================
echo       DESINSTALAR PUENTE DE IMPRESION - THE VILLA DOG
echo ==============================================================
echo.
echo Deteniendo procesos del puente...
taskkill /F /IM TheVillaDogBridge.exe >nul 2>&1
taskkill /F /IM Instalar-Impresion-TheVillaDog.exe >nul 2>&1

if exist "%SHORTCUT_PATH%" (
  del /Q "%SHORTCUT_PATH%" >nul 2>&1
  echo [OK] Se elimino el inicio automatico con Windows.
)

if exist "%INSTALL_DIR%" (
  echo [OK] Carpeta de instalacion: %INSTALL_DIR%
  echo Puedes eliminarla manualmente si no necesitas los registros historicos.
)

echo.
echo El puente ha sido detenido y desactivado de Windows.
echo.
pause
