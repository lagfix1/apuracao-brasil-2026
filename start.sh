#!/data/data/com.termux/files/usr/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v python >/dev/null 2>&1; then
  echo "Python não encontrado. No Termux, instale com: pkg install python -y"
  exit 1
fi
python server.py
