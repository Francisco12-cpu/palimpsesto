@echo off
chcp 65001 >nul
rem Libera a porta do jogo no Firewall do Windows (pede permissao de administrador).
net session >nul 2>&1
if errorlevel 1 (
  echo Pedindo permissao de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="Palimpsesto" >nul 2>&1
netsh advfirewall firewall add rule name="Palimpsesto" dir=in action=allow protocol=TCP localport=8080-8100 profile=private
echo.
echo  Pronto! Portas 8080-8100 liberadas para a rede privada.
echo  Agora os amigos ja conseguem entrar pelo endereco mostrado no servidor.
echo.
pause
