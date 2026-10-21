@echo off
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py server.py --open
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py --open
  goto :eof
)
echo.
echo Python nao encontrado.
echo Instale Python 3 e marque a opcao "Add Python to PATH".
echo.
pause
