<#
  Hospeda o NexusVoice neste PC para os amigos entrarem pelo Radmin VPN.

  O que faz:
  1. Descobre o IP deste PC na rede do Radmin (ou usa o -Ip informado).
  2. Cria chaves fortes do LiveKit em .env.hospedagem (fica fora do git).
     As chaves "devkey/secret" do modo de desenvolvimento são públicas e
     não devem ficar expostas na rede.
  3. Abre o LiveKit numa janela própria, ouvindo na rede e anunciando o IP do Radmin.
  4. Roda o servidor do NexusVoice nesta janela.

  Uso:  npm run hospedar
        npm run hospedar -- -Ip 26.10.20.30
#>
param(
  [string]$Ip
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Write-Step($text) { Write-Host "`n> $text" -ForegroundColor Cyan }

# 1. IP do Radmin
if (-not $Ip) {
  $radmin = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -like '*Radmin*' } |
    Select-Object -First 1
  $Ip = $radmin.IPAddress
}
if (-not $Ip) {
  Write-Host 'Não achei o adaptador do Radmin VPN.' -ForegroundColor Red
  Write-Host 'Abra o Radmin VPN e entre na rede, ou rode: npm run hospedar -- -Ip SEU_IP'
  exit 1
}

# 2. Portas livres?
$busy = Get-NetTCPConnection -State Listen -LocalPort 3001, 7880 -ErrorAction SilentlyContinue
if ($busy) {
  $ports = ($busy | Select-Object -ExpandProperty LocalPort -Unique) -join ', '
  Write-Host "As portas $ports já estão em uso. Feche o 'npm run dev' e o 'npm run livekit' antes de hospedar." -ForegroundColor Red
  exit 1
}

$livekitExe = Join-Path $root 'tools\livekit\livekit-server.exe'
if (-not (Test-Path $livekitExe)) {
  Write-Host 'Não achei tools\livekit\livekit-server.exe. Baixe o LiveKit como está no README.' -ForegroundColor Red
  exit 1
}

# 3. Chaves fortes do LiveKit (geradas uma vez e reaproveitadas)
$keysFile = Join-Path $root '.env.hospedagem'
if (-not (Test-Path $keysFile)) {
  Write-Step 'Gerando chaves novas do LiveKit em .env.hospedagem'
  $bytes = New-Object byte[] 36
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes).Replace('+', 'a').Replace('/', 'b').TrimEnd('=')
  $keyBytes = New-Object byte[] 6
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($keyBytes)
  $key = 'NV' + (($keyBytes | ForEach-Object { $_.ToString('x2') }) -join '')
  @(
    '# Chaves do LiveKit usadas pelo "npm run hospedar". Não compartilhe este arquivo.',
    "LIVEKIT_API_KEY=$key",
    "LIVEKIT_API_SECRET=$secret"
  ) | Set-Content -Path $keysFile -Encoding ascii
}

$values = @{}
foreach ($line in Get-Content $keysFile) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.+)\s*$') { $values[$Matches[1]] = $Matches[2] }
}
$env:LIVEKIT_API_KEY = $values['LIVEKIT_API_KEY']
$env:LIVEKIT_API_SECRET = $values['LIVEKIT_API_SECRET']
$env:LIVEKIT_KEYS = "$($env:LIVEKIT_API_KEY): $($env:LIVEKIT_API_SECRET)"
# O servidor troca "localhost" pelo endereço que cada pessoa usou (IP do Radmin).
$env:LIVEKIT_URL = 'ws://localhost:7880'

# 4. LiveKit numa janela própria
Write-Step "Abrindo o LiveKit (voz e vídeo) anunciando o IP $Ip"
Start-Process -FilePath $livekitExe -WorkingDirectory $root -ArgumentList @(
  '--bind', '0.0.0.0',
  '--node-ip', $Ip,
  '--udp-port', '7882'
)

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host '  NexusVoice hospedado neste PC' -ForegroundColor Green
Write-Host "  Endereço para os amigos colocarem no app:  $Ip" -ForegroundColor Green
Write-Host '  Neste PC, use: localhost' -ForegroundColor Green
Write-Host '  Se ninguém conseguir entrar, rode uma vez: npm run firewall' -ForegroundColor Green
Write-Host '  Para parar: feche esta janela e a janela do LiveKit.' -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Green

# 5. Servidor do NexusVoice nesta janela
Write-Step 'Iniciando o servidor do NexusVoice'
& npm.cmd run start --workspace=@nexusvoice/server
