#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"
PORT="${APURACAO_PORT:-8088}"
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared não encontrado. No Termux: pkg install cloudflared -y"
  exit 1
fi
if ! command -v curl >/dev/null 2>&1 || ! curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "O painel não respondeu em http://127.0.0.1:${PORT}. Inicie ./start.sh primeiro."
  exit 1
fi
echo "Publicando Apuração Brasil pela Cloudflare..."
echo "O endereço trycloudflare.com ficará ativo enquanto este processo estiver rodando."
exec cloudflared tunnel --url "http://127.0.0.1:${PORT}"
