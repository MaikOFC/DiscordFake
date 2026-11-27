#!/usr/bin/env bash
#
# Baixa a versão nova do NexusVoice do GitHub e reinstala no servidor,
# mantendo o banco, os arquivos enviados e as chaves.
#
# Uso, dentro do servidor:
#   sudo bash /opt/nexusvoice/scripts/servidor/atualizar.sh

set -Eeuo pipefail

# Tudo dentro de uma função: o bash lê o arquivo inteiro antes de rodar, então
# o "git pull" pode trocar este próprio script sem atrapalhar.
main() {
  local app_dir dominio
  app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

  if [[ $EUID -ne 0 ]]; then
    echo "Rode com sudo: sudo bash $0" >&2
    exit 1
  fi

  dominio="$(cat /etc/nexusvoice/dominio 2>/dev/null || true)"
  if [[ -z "$dominio" ]]; then
    echo "Não achei a instalação anterior. Rode primeiro o instalar.sh com o domínio." >&2
    exit 1
  fi

  echo "> Baixando a versão nova do GitHub"
  git -C "$app_dir" pull --ff-only

  exec bash "$app_dir/scripts/servidor/instalar.sh" "$dominio"
}

main "$@"
