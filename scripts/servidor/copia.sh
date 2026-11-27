#!/usr/bin/env bash
#
# Faz uma cópia completa dos dados do NexusVoice (banco e arquivos enviados)
# num .tar.gz na pasta pessoal de quem rodou, para baixar no PC com o scp.
# O servidor continua no ar enquanto a cópia é feita.
#
# Uso, dentro do servidor:
#   sudo bash /opt/nexusvoice/scripts/servidor/copia.sh

set -Eeuo pipefail

DATA_DIR="/var/lib/nexusvoice"
SERVICE_USER="nexusvoice"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Rode com sudo: sudo bash $0" >&2
  exit 1
fi
if [[ ! -f "$DATA_DIR/nexusvoice.db" ]]; then
  echo "Não achei o banco em $DATA_DIR/nexusvoice.db." >&2
  exit 1
fi

dono="${SUDO_USER:-root}"
pasta_dono="$(getent passwd "$dono" | cut -d: -f6)"
node_bin="$(command -v node)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
chown "$SERVICE_USER" "$tmp"

# A cópia do banco roda como o usuário do serviço, pelo backup do próprio
# SQLite: fica consistente mesmo com gente usando, e não cria arquivo do root
# na pasta de dados.
echo "> Copiando o banco"
cd "$APP_DIR/apps/server"
runuser -u "$SERVICE_USER" -- env DB="$DATA_DIR/nexusvoice.db" OUT="$tmp/nexusvoice.db" \
  "$node_bin" -e "
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DB, { fileMustExist: true });
    db.backup(process.env.OUT)
      .then(() => db.close())
      .catch((error) => { console.error(error); process.exit(1); });
  "

echo "> Juntando com os arquivos enviados"
arquivo="$pasta_dono/nexusvoice-dados-$(date +%Y-%m-%d_%H%M).tar.gz"
partes=(-C "$tmp" nexusvoice.db)
if [[ -d "$DATA_DIR/uploads" ]]; then
  partes+=(-C "$DATA_DIR" uploads)
fi
tar -czf "$arquivo" "${partes[@]}"
chown "$dono": "$arquivo"

echo ""
echo "Cópia pronta: $arquivo ($(du -h "$arquivo" | cut -f1))"
echo "Para baixar no PC, no PowerShell:"
echo "  scp -i CAMINHO\\DA\\CHAVE.key $dono@IP_DO_SERVIDOR:$arquivo D:\\"
