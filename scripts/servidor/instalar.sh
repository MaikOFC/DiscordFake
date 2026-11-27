#!/usr/bin/env bash
#
# Instala (ou atualiza) o NexusVoice num servidor Linux com Ubuntu, como a
# máquina grátis da Oracle Cloud. No fim fica tudo rodando e subindo sozinho
# junto com a máquina:
#   - Node.js 24 e as dependências do projeto
#   - o servidor do NexusVoice e a versão web do app
#   - o LiveKit (voz, câmera e tela)
#   - o Caddy, que cuida do HTTPS com certificado grátis do Let's Encrypt
#   - as portas liberadas no firewall da própria máquina
#
# Uso, dentro do servidor:
#   sudo git clone https://github.com/MaikOFC/NexusVoice.git /opt/nexusvoice
#   sudo bash /opt/nexusvoice/scripts/servidor/instalar.sh seunome.duckdns.org
#
# Pode rodar de novo quantas vezes quiser. As chaves do LiveKit, o banco e os
# arquivos enviados são mantidos. O passo a passo completo está em
# docs/SERVIDOR-NA-NUVEM.md.

set -Eeuo pipefail
umask 022

LIVEKIT_VERSION="1.13.11"
NODE_MAJOR="24"
SERVICE_USER="nexusvoice"
DATA_DIR="/var/lib/nexusvoice"
CONFIG_DIR="/etc/nexusvoice"
ENV_FILE="$CONFIG_DIR/servidor.env"
LIVEKIT_CONFIG="$CONFIG_DIR/livekit.yaml"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

passo() { printf '\n\033[1;36m> %s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
erro() {
  printf '\033[1;31mErro: %s\033[0m\n' "$*" >&2
  exit 1
}
trap 'erro "o comando da linha $LINENO falhou (a mensagem dele está logo acima). Corrija e rode o script de novo."' ERR

# ---------- Conferências ----------

[[ $EUID -eq 0 ]] || erro "rode com sudo: sudo bash $0 seunome.duckdns.org"

DOMINIO="${1:-}"
DOMINIO="${DOMINIO#http://}"
DOMINIO="${DOMINIO#https://}"
DOMINIO="${DOMINIO%%/*}"
DOMINIO="${DOMINIO,,}"
[[ -n "$DOMINIO" ]] || erro "informe o domínio. Exemplo: sudo bash $0 seunome.duckdns.org"
[[ "$DOMINIO" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || erro "domínio inválido: $DOMINIO"

# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "ubuntu" || "${ID:-}" == "debian" ]] ||
  erro "este script é para Ubuntu (a imagem 'Canonical Ubuntu' da Oracle)."

[[ -f "$APP_DIR/package.json" && -d "$APP_DIR/apps/server" ]] || erro "não achei o projeto em $APP_DIR."
case "$APP_DIR" in
  /home/* | /root/*)
    erro "o projeto precisa ficar fora da pasta pessoal, porque o serviço não tem acesso a ela. Clone em /opt/nexusvoice como está no passo a passo."
    ;;
esac

case "$(uname -m)" in
  aarch64 | arm64)
    NODE_ARCH="arm64"
    LIVEKIT_ARCH="arm64"
    ;;
  x86_64 | amd64)
    NODE_ARCH="x64"
    LIVEKIT_ARCH="amd64"
    ;;
  *) erro "processador não suportado: $(uname -m)" ;;
esac

export DEBIAN_FRONTEND=noninteractive

# Com o ufw ligado (comum fora da Oracle), as portas são abertas por ele.
# Na Oracle o firewall da máquina é o iptables puro.
USA_UFW=0
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  USA_UFW=1
fi

# ---------- Pacotes do sistema ----------

passo "Instalando pacotes do sistema"
pacotes=(ca-certificates curl git gnupg openssl xz-utils build-essential python3)
if [[ $USA_UFW -eq 0 ]]; then
  echo 'iptables-persistent iptables-persistent/autosave_v4 boolean true' | debconf-set-selections
  echo 'iptables-persistent iptables-persistent/autosave_v6 boolean true' | debconf-set-selections
  pacotes+=(iptables netfilter-persistent iptables-persistent)
fi
apt-get update -q
apt-get install -y -q "${pacotes[@]}"

# Máquina com pouca memória (a AMD grátis tem 1 GB): swap para o build não travar.
mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
if ((mem_kb < 3000000)) && ! swapon --show | grep -q .; then
  passo "Criando 2 GB de swap (a máquina tem pouca memória)"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

# ---------- Node.js ----------

node_atual="$(node -v 2>/dev/null || true)"
if [[ "$node_atual" != v${NODE_MAJOR}.* ]]; then
  passo "Instalando o Node.js $NODE_MAJOR"
  tmp="$(mktemp -d)"
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  arquivo="$(grep -oE "node-v[0-9.]+-linux-${NODE_ARCH}\.tar\.xz" "$tmp/SHASUMS256.txt" | head -n1)"
  [[ -n "$arquivo" ]] || erro "não achei o Node.js para linux-$NODE_ARCH."
  curl -fsSL "$base/$arquivo" -o "$tmp/$arquivo"
  (cd "$tmp" && grep " $arquivo\$" SHASUMS256.txt | sha256sum -c --status) ||
    erro "o download do Node.js veio corrompido. Rode o script de novo."
  rm -rf /opt/node
  mkdir -p /opt/node
  tar -xJf "$tmp/$arquivo" -C /opt/node --strip-components=1
  ln -sf /opt/node/bin/node /usr/local/bin/node
  ln -sf /opt/node/bin/npm /usr/local/bin/npm
  ln -sf /opt/node/bin/npx /usr/local/bin/npx
  rm -rf "$tmp"
  hash -r
fi
NODE_BIN="$(command -v node)"
echo "Node.js $("$NODE_BIN" -v) em $NODE_BIN"

# ---------- LiveKit ----------

lk_atual="$(/usr/local/bin/livekit-server --version 2>/dev/null || true)"
if [[ "$lk_atual" != *"$LIVEKIT_VERSION"* ]]; then
  passo "Instalando o LiveKit $LIVEKIT_VERSION"
  tmp="$(mktemp -d)"
  arquivo="livekit_${LIVEKIT_VERSION}_linux_${LIVEKIT_ARCH}.tar.gz"
  base="https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}"
  curl -fsSL "$base/$arquivo" -o "$tmp/$arquivo"
  curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt"
  (cd "$tmp" && grep " $arquivo\$" checksums.txt | sha256sum -c --status) ||
    erro "o download do LiveKit veio corrompido. Rode o script de novo."
  tar -xzf "$tmp/$arquivo" -C "$tmp"
  binario="$(find "$tmp" -type f -name livekit-server | head -n1)"
  [[ -n "$binario" ]] || erro "o pacote do LiveKit não tem o livekit-server."
  install -m 755 "$binario" /usr/local/bin/livekit-server
  rm -rf "$tmp"
fi

# ---------- Caddy ----------

if ! command -v caddy >/dev/null 2>&1; then
  passo "Instalando o Caddy (HTTPS automático)"
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
    gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    -o /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

# ---------- Usuário, pastas e configuração ----------

passo "Preparando usuário e pastas"
id -u "$SERVICE_USER" >/dev/null 2>&1 ||
  useradd --system --user-group --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
install -d -m 750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
install -d -m 750 -o root -g "$SERVICE_USER" "$CONFIG_DIR"

lk_key=""
lk_secret=""
if [[ -f "$ENV_FILE" ]]; then
  lk_key="$(sed -n 's/^LIVEKIT_API_KEY=//p' "$ENV_FILE" | head -n1)"
  lk_secret="$(sed -n 's/^LIVEKIT_API_SECRET=//p' "$ENV_FILE" | head -n1)"
fi
if [[ -z "$lk_key" || -z "$lk_secret" ]]; then
  passo "Gerando chaves novas do LiveKit"
  lk_key="NV$(openssl rand -hex 6)"
  lk_secret="$(openssl rand -base64 36 | tr '+/' 'ab' | tr -d '=\n')"
fi

passo "Gravando a configuração em $CONFIG_DIR"
cat >"$ENV_FILE" <<EOF
# Gerado por scripts/servidor/instalar.sh. Não compartilhe: tem as chaves do LiveKit.
PORT=3001
HOST=127.0.0.1
TRUST_PROXY=loopback
CLIENT_ORIGIN=https://$DOMINIO
LIVEKIT_URL=wss://$DOMINIO/livekit
LIVEKIT_API_KEY=$lk_key
LIVEKIT_API_SECRET=$lk_secret
DB_PATH=$DATA_DIR/nexusvoice.db
UPLOADS_DIR=$DATA_DIR/uploads
EOF

cat >"$LIVEKIT_CONFIG" <<EOF
# Gerado por scripts/servidor/instalar.sh.
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882
  # Descobre o IP público da máquina (na Oracle a placa de rede só tem o IP interno).
  use_external_ip: true
keys:
  $lk_key: $lk_secret
logging:
  level: info
EOF

chown root:"$SERVICE_USER" "$ENV_FILE" "$LIVEKIT_CONFIG"
chmod 640 "$ENV_FILE" "$LIVEKIT_CONFIG"
echo "$DOMINIO" >"$CONFIG_DIR/dominio"

# Buffers de UDP maiores, como o LiveKit recomenda, para a voz não picotar.
cat >/etc/sysctl.d/90-nexusvoice.conf <<EOF
net.core.rmem_max=5000000
net.core.wmem_max=5000000
EOF
sysctl -q -p /etc/sysctl.d/90-nexusvoice.conf >/dev/null 2>&1 || aviso "não consegui aplicar os buffers de UDP."

# ---------- Projeto ----------

passo "Instalando as dependências do projeto (demora uns minutos)"
# Numa atualização, o servidor para enquanto as dependências são trocadas.
systemctl stop nexusvoice 2>/dev/null || true
cd "$APP_DIR"
npm ci --include=dev --no-audit --no-fund

passo "Gerando a versão web do app"
npm run build --workspace=@nexusvoice/client

# ---------- Serviços ----------

passo "Criando os serviços que sobem junto com a máquina"
cat >/etc/systemd/system/nexusvoice-livekit.service <<EOF
[Unit]
Description=NexusVoice - LiveKit (voz e video)
After=network-online.target
Wants=network-online.target

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
ExecStart=/usr/local/bin/livekit-server --config $LIVEKIT_CONFIG
Restart=always
RestartSec=3
LimitNOFILE=65536
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/nexusvoice.service <<EOF
[Unit]
Description=NexusVoice - servidor
After=network-online.target nexusvoice-livekit.service
Wants=network-online.target

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR/apps/server
EnvironmentFile=$ENV_FILE
Environment=PATH=$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE_BIN $APP_DIR/node_modules/tsx/dist/cli.mjs src/index.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nexusvoice-livekit nexusvoice >/dev/null 2>&1
systemctl restart nexusvoice-livekit nexusvoice

# ---------- Caddy (HTTPS) ----------

passo "Configurando o HTTPS para $DOMINIO"
if [[ -f /etc/caddy/Caddyfile ]] && ! grep -q 'NexusVoice' /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.antes-do-nexusvoice
fi
cat >/etc/caddy/Caddyfile <<EOF
# NexusVoice: gerado por scripts/servidor/instalar.sh
$DOMINIO {
	# Voz e vídeo: o app conecta em wss://$DOMINIO/livekit
	handle_path /livekit/* {
		reverse_proxy 127.0.0.1:7880
	}

	# API, Socket.IO e arquivos enviados
	@servidor path /api/* /socket.io/* /uploads/*
	handle @servidor {
		reverse_proxy 127.0.0.1:3001
	}

	# Versão web do app
	handle {
		root * $APP_DIR/apps/client/dist
		encode zstd gzip
		@assets path /assets/*
		header @assets Cache-Control "public, max-age=31536000, immutable"
		@pagina not path /assets/*
		header @pagina Cache-Control "no-cache"
		try_files {path} /index.html
		file_server
	}
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 ||
  erro "o Caddyfile ficou inválido. Rode: caddy validate --config /etc/caddy/Caddyfile"
systemctl enable caddy >/dev/null 2>&1
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# ---------- Firewall da máquina ----------

passo "Liberando as portas no firewall da máquina"
abrir_porta() {
  local proto="$1" porta="$2" linha
  if [[ $USA_UFW -eq 1 ]]; then
    ufw allow "$porta/$proto" >/dev/null
    return
  fi
  if iptables -C INPUT -p "$proto" --dport "$porta" -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null; then
    return
  fi
  # A imagem da Oracle termina a lista com um REJECT: a regra nova entra antes dele.
  linha="$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" {print $1; exit}')"
  if [[ -n "$linha" ]]; then
    iptables -I INPUT "$linha" -p "$proto" --dport "$porta" -m conntrack --ctstate NEW -j ACCEPT
  else
    iptables -A INPUT -p "$proto" --dport "$porta" -m conntrack --ctstate NEW -j ACCEPT
  fi
}
abrir_porta tcp 80
abrir_porta tcp 443
abrir_porta udp 443
abrir_porta tcp 7881
abrir_porta udp 7882
if [[ $USA_UFW -eq 0 ]]; then
  netfilter-persistent save >/dev/null 2>&1
fi

# ---------- Conferência final ----------

passo "Conferindo se está tudo de pé"
ok_local=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    ok_local=1
    break
  fi
  sleep 1
done
[[ $ok_local -eq 1 ]] || erro "o servidor não respondeu. Veja o log: journalctl -u nexusvoice -n 50"
systemctl is-active --quiet nexusvoice-livekit ||
  erro "o LiveKit não subiu. Veja o log: journalctl -u nexusvoice-livekit -n 50"
echo "Servidor e LiveKit rodando."

ok_https=0
for _ in $(seq 1 12); do
  if curl -fsS --max-time 10 "https://$DOMINIO/api/health" >/dev/null 2>&1; then
    ok_https=1
    break
  fi
  sleep 5
done
if [[ $ok_https -eq 1 ]]; then
  echo "HTTPS funcionando em https://$DOMINIO"
else
  aviso "O HTTPS ainda não respondeu em https://$DOMINIO. Confira:"
  aviso "  1. se o DuckDNS aponta para o IP público desta máquina;"
  aviso "  2. se as portas TCP 80 e 443 estão liberadas na Security List da Oracle;"
  aviso "  3. o log do Caddy: journalctl -u caddy -n 50"
  aviso "Depois de corrigir, rode este script de novo."
fi

cat <<EOF

==============================================================
  NexusVoice instalado
  Endereço para colocar no app:  $DOMINIO
  Pelo navegador:                https://$DOMINIO

  Log do servidor:  journalctl -u nexusvoice -f
  Log do LiveKit:   journalctl -u nexusvoice-livekit -f
  Atualizar:        sudo bash $APP_DIR/scripts/servidor/atualizar.sh
  Copiar os dados:  sudo bash $APP_DIR/scripts/servidor/copia.sh
==============================================================
EOF
