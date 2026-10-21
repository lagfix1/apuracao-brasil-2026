#!/data/data/com.termux/files/usr/bin/bash
PORT="${APURACAO_PORT:-8088}"
if ! command -v tailscale >/dev/null 2>&1; then
  echo "Comando tailscale não encontrado neste ambiente."
  exit 1
fi
echo "Publicando http://127.0.0.1:$PORT pela internet via Tailscale Funnel..."
echo "Atenção: o endereço ficará PUBLICAMENTE acessível enquanto o Funnel estiver ativo."
tailscale funnel --bg "$PORT"
tailscale funnel status
