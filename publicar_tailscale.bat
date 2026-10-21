@echo off
set PORT=8088
echo Publicando http://127.0.0.1:%PORT% pela internet via Tailscale Funnel...
echo ATENCAO: o endereco ficara PUBLICAMENTE acessivel enquanto o Funnel estiver ativo.
tailscale funnel --bg %PORT%
tailscale funnel status
pause
