@echo off
set PORT=8088
where cloudflared >nul 2>&1 || (echo cloudflared nao encontrado.& pause & exit /b 1)
echo Publicando Apuracao Brasil pela Cloudflare...
cloudflared tunnel --url http://127.0.0.1:%PORT%
pause
