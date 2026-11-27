# Servidor grátis na nuvem (Oracle)

Com o servidor na nuvem, ninguém precisa deixar o PC ligado e ninguém precisa
do Radmin. A máquina grátis da Oracle roda o mesmo NexusVoice de sempre, com o
LiveKit, então não tem limite de minutos nem de pessoas por canal de voz.

De bônus, o servidor ganha HTTPS e uma versão web: dá para entrar pelo
navegador, com microfone e câmera, sem instalar nada.

Como fica:

- a máquina da Oracle roda Ubuntu com o servidor, o LiveKit e o Caddy (que
  cuida do HTTPS);
- o DuckDNS dá um endereço grátis, tipo `seugrupo.duckdns.org`;
- todo mundo continua no Windows, usando o app normalmente. Só quem cuida do
  servidor entra nele, e só para instalar e atualizar.

O caminho todo leva uns 40 minutos na primeira vez.

## 1. Criar a conta na Oracle

1. Entre em [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) e
   clique em "Start for free".
2. Na região (home region), escolha **Brazil East (São Paulo)** ou
   **Brazil Southeast (Vinhedo)**. Ela não muda depois, e a máquina grátis só
   pode ser criada nela.
3. O cadastro pede um cartão de crédito para verificação. Pode aparecer uma
   cobrança pequena que é devolvida. A conta grátis não cobra nada enquanto
   ficar dentro dos limites do Always Free.

## 2. Criar a máquina

No painel da Oracle: menu > **Compute** > **Instances** > **Create instance**.

- **Name:** `nexusvoice`.
- **Image:** clique em "Change image", escolha **Ubuntu** e a versão
  **Canonical Ubuntu 24.04** (a comum, não a "Minimal").
- **Shape:** clique em "Change shape" > **Ampere** > `VM.Standard.A1.Flex`.
  2 OCPUs e 12 GB de memória sobram para o grupo e cabem no grátis.
- **Networking:** deixe criar uma rede nova (VCN) com sub-rede pública e
  marque **Assign a public IPv4 address**.
- **Add SSH keys:** escolha "Generate a key pair for me" e clique em **Save
  private key**. Guarde esse arquivo num lugar seguro, por exemplo
  `D:\NexusVoice-servidor\chave.key`. Sem ele não dá para entrar na máquina.
- O resto pode ficar como está. Clique em **Create**.

Se aparecer "Out of capacity", a Oracle está sem máquina ARM livre naquela
hora. Tente outro "Availability domain", diminua para 1 OCPU e 6 GB, ou tente
de novo mais tarde. A máquina AMD grátis (`VM.Standard.E2.1.Micro`, 1 GB de
memória) também funciona para um grupo pequeno; o script cria uma área de
troca (swap) para compensar a pouca memória.

Quando a máquina ficar verde (Running), anote o **Public IP address**.

## 3. Abrir as portas na Oracle

A Oracle bloqueia tudo menos o SSH. Na página da máquina, clique na sub-rede
(Subnet), depois em **Security Lists** > **Default Security List** > **Add
Ingress Rules**. Crie uma regra para cada linha, sempre com **Source CIDR**
`0.0.0.0/0`:

| Protocolo | Porta (Destination Port Range) | Para quê |
|---|---|---|
| TCP | 80 | gerar o certificado do HTTPS |
| TCP | 443 | app, site e conexão da voz |
| UDP | 443 | HTTP/3, deixa o site um pouco mais rápido (opcional) |
| TCP | 7881 | voz para quem tem o UDP bloqueado |
| UDP | 7882 | voz, câmera e tela |

O firewall de dentro da máquina o script abre sozinho.

## 4. Pegar um endereço grátis no DuckDNS

1. Entre em [duckdns.org](https://www.duckdns.org/) com uma conta do GitHub,
   Google ou outra das opções.
2. Crie um subdomínio, por exemplo `seugrupo`. O endereço fica
   `seugrupo.duckdns.org`.
3. No campo "current ip" desse subdomínio, coloque o IP público da Oracle e
   clique em "update ip".

Para conferir, no PowerShell:

```powershell
Resolve-DnsName seugrupo.duckdns.org
```

Tem que aparecer o IP da Oracle.

## 5. Entrar na máquina pelo PowerShell

O Windows recusa a chave se outras contas do PC puderem ler o arquivo. Rode
uma vez:

```powershell
icacls D:\NexusVoice-servidor\chave.key /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

Depois, para entrar (troque pelo IP da sua máquina):

```powershell
ssh -i D:\NexusVoice-servidor\chave.key ubuntu@IP_DA_ORACLE
```

Na primeira vez ele pergunta se confia na máquina: digite `yes`.

## 6. Instalar o NexusVoice

Já dentro da máquina, rode os dois comandos, trocando o domínio pelo seu:

```bash
sudo git clone https://github.com/MaikOFC/NexusVoice.git /opt/nexusvoice
sudo bash /opt/nexusvoice/scripts/servidor/instalar.sh seugrupo.duckdns.org
```

Leva de 5 a 10 minutos. O script:

- instala o Node.js, o LiveKit e o Caddy (os downloads são conferidos pelo
  checksum oficial);
- cria chaves fortes do LiveKit em `/etc/nexusvoice`;
- instala as dependências e gera a versão web do app;
- cria os serviços `nexusvoice` e `nexusvoice-livekit`, que sobem sozinhos
  quando a máquina liga e reiniciam se caírem;
- configura o HTTPS para o seu domínio;
- libera as portas no firewall da máquina;
- confere se tudo respondeu, inclusive o HTTPS pelo domínio.

O banco e os arquivos enviados ficam em `/var/lib/nexusvoice`.

## 7. Entrar no servidor

- **No app:** na tela de login, clique em **Trocar** ao lado de "Servidor" e
  digite `seugrupo.duckdns.org`. No app 0.2.0, digite com `https://` na
  frente: `https://seugrupo.duckdns.org`.
- **No navegador:** abra `https://seugrupo.duckdns.org`.

As contas são de cada servidor. No servidor novo, cada um cria a conta de
novo, a não ser que vocês tragam os dados do PC (veja abaixo).

## Para a Oracle não apagar a máquina

Numa conta só Always Free, a Oracle pode recuperar a máquina se, durante 7
dias, o uso de processador, de rede e de memória ficar abaixo de 20%. Um
servidor de chat de amigos fica quase sempre abaixo disso.

O jeito garantido é converter a conta para **Pay As You Go** (no painel:
Billing & Cost Management > Upgrade and Manage Payment). Os recursos Always
Free continuam grátis, mas o que passar deles passa a ser cobrado no cartão.
Por isso, crie também um alerta de orçamento (Billing > **Budgets**) de
US$ 1: se alguma coisa começar a cobrar, chega um e-mail.

Se preferir não converter, faça cópias dos dados de vez em quando (próxima
seção). Assim, se a máquina sumir, basta criar outra e restaurar.

## Atualizar

Quando sair versão nova no GitHub, entre na máquina e rode:

```bash
sudo bash /opt/nexusvoice/scripts/servidor/atualizar.sh
```

Ele baixa o código novo e roda o instalador de novo, mantendo banco, arquivos
e chaves. O servidor fica fora do ar por um ou dois minutos.

## Cópia dos dados

O servidor já faz uma cópia do banco a cada 6 horas em
`/var/lib/nexusvoice/backups`, mas ela fica na mesma máquina. Para ter uma
cópia no seu PC:

```bash
sudo bash /opt/nexusvoice/scripts/servidor/copia.sh
```

Ele gera um `nexusvoice-dados-DATA.tar.gz` com o banco e os arquivos enviados
na pasta do usuário `ubuntu`. Para baixar, no PowerShell do PC:

```powershell
scp -i D:\NexusVoice-servidor\chave.key ubuntu@IP_DA_ORACLE:nexusvoice-dados-*.tar.gz D:\NexusVoice-servidor\
```

### Restaurar uma cópia

Mande o `.tar.gz` para a máquina com o `scp` (o mesmo comando, invertendo
origem e destino) e, dentro dela:

```bash
sudo systemctl stop nexusvoice
sudo rm -f /var/lib/nexusvoice/nexusvoice.db*
sudo tar -xzf nexusvoice-dados-DATA.tar.gz -C /var/lib/nexusvoice
sudo chown -R nexusvoice:nexusvoice /var/lib/nexusvoice
sudo systemctl start nexusvoice
```

### Trazer os dados do servidor do Radmin

Para não perder as contas e o histórico de quem hospedava pelo Radmin:

1. Feche o servidor no PC (a janela do `npm run hospedar`).
2. Mande a pasta `apps/server/data` do projeto para a máquina:

   ```powershell
   scp -i D:\NexusVoice-servidor\chave.key -r CAMINHO\DO\PROJETO\apps\server\data ubuntu@IP_DA_ORACLE:dados-do-pc
   ```

3. Dentro da máquina:

   ```bash
   sudo systemctl stop nexusvoice
   sudo rm -f /var/lib/nexusvoice/nexusvoice.db*
   sudo cp dados-do-pc/nexusvoice.db* /var/lib/nexusvoice/
   sudo cp -r dados-do-pc/uploads/. /var/lib/nexusvoice/uploads/
   sudo chown -R nexusvoice:nexusvoice /var/lib/nexusvoice
   sudo systemctl start nexusvoice
   ```

## Quanto de internet isso usa

A máquina grátis tem uns 10 TB de saída por mês. Voz quase não conta. O que
pesa é tela e câmera: uma tela em 1080p60 vista por 4 pessoas gasta uns
32 Mbps, o que dá perto de 1,7 TB num mês com 4 horas de tela por dia. Ainda
sobra bastante.

## Problemas comuns

- **O script avisou que o HTTPS não respondeu:** confira se o DuckDNS aponta
  para o IP da Oracle e se as portas TCP 80 e 443 estão na Security List.
  O log do Caddy mostra o motivo: `journalctl -u caddy -n 50`. Depois de
  corrigir, rode o `instalar.sh` de novo.
- **Entra no canal de voz mas ninguém se ouve:** falta a porta UDP 7882 (ou a
  TCP 7881) na Security List.
- **Ver se está tudo rodando:**
  `systemctl status nexusvoice nexusvoice-livekit caddy`.
- **Ver o log do servidor ao vivo:** `journalctl -u nexusvoice -f`.
- **"Permission denied (publickey)" no ssh:** o usuário da imagem Ubuntu é
  `ubuntu`, e o caminho da chave precisa estar certo.
- **"UNPROTECTED PRIVATE KEY FILE" no ssh:** rode o comando `icacls` do passo 5.
- **O IP da máquina mudou:** atualize o IP no DuckDNS. Para o IP nunca mudar,
  dá para reservar um IP público fixo na Oracle (Networking > IP Management >
  Reserved Public IPs).
