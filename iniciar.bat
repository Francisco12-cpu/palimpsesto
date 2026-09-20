@echo off
chcp 65001 >nul
title Palimpsesto - servidor
cd /d "%~dp0"

rem Usa o Node embutido (pasta runtime) se existir; senão o Node instalado no PC.
set "NODE=node"
if exist "%~dp0runtime\node.exe" set "NODE=%~dp0runtime\node.exe"

"%NODE%" --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo  Node.js nao encontrado neste computador.
  echo  Instale em https://nodejs.org  ^(versao LTS^) e rode este arquivo de novo,
  echo  ou use a versao empacotada gerada por "npm run pack" ^(ja inclui o Node^).
  echo.
  pause
  exit /b 1
)

"%NODE%" serve.mjs --open
echo.
echo  O servidor foi encerrado.
pause
