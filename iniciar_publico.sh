#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"
PORT="${APURACAO_PORT:-8088}"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
fi

if ! command -v python >/dev/null 2>&1; then
  echo "Python não encontrado. Instale com: pkg install python -y"
  exit 1
fi
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared não encontrado. Instale com: pkg install cloudflared -y"
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl não encontrado. Instale com: pkg install curl -y"
  exit 1
fi

if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "Servidor já está rodando na porta ${PORT}."
else
  echo "Iniciando servidor em segundo plano..."
  nohup python server.py > servidor.log 2>&1 &
  echo $! > servidor.pid
  for i in 1 2 3 4 5 6 7 8; do
    sleep 1
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then break; fi
  done
  if ! curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    echo "O servidor não iniciou. Veja: tail -50 servidor.log"
    exit 1
  fi
fi

echo
echo "Servidor OK. Abrindo Quick Tunnel da Cloudflare..."
echo "Copie a URL https://....trycloudflare.com que aparecer abaixo."
echo "O túnel fica ativo enquanto este processo cloudflared estiver rodando."
echo
exec cloudflared tunnel --url "http://127.0.0.1:${PORT}"
