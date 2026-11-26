<#
  Libera no Firewall do Windows as portas que o NexusVoice usa, só para quem
  vem pela rede do Radmin VPN (endereços 26.x.x.x). A internet e a rede local
  continuam bloqueadas.

  Precisa de administrador: o Windows vai pedir confirmação.

  Uso:  npm run firewall            (libera)
        npm run firewall -- -Remover (tira as regras)
#>
param(
  [switch]$Remover
)

$ErrorActionPreference = 'Stop'
$prefix = 'NexusVoice'
$radminRange = '26.0.0.0/8'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  if ($Remover) { $argsList += '-Remover' }
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argsList
  Write-Host 'Abri uma janela de administrador para mexer no firewall.'
  exit 0
}

Get-NetFirewallRule -DisplayName "$prefix *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule

if ($Remover) {
  Write-Host 'Regras do NexusVoice removidas do firewall.' -ForegroundColor Yellow
} else {
  $rules = @(
    @{ Name = "$prefix servidor (TCP 3001)"; Protocol = 'TCP'; Port = '3001' },
    @{ Name = "$prefix LiveKit sinalizacao (TCP 7880)"; Protocol = 'TCP'; Port = '7880' },
    @{ Name = "$prefix LiveKit midia (TCP 7881)"; Protocol = 'TCP'; Port = '7881' },
    @{ Name = "$prefix LiveKit midia (UDP 7882)"; Protocol = 'UDP'; Port = '7882' }
  )
  foreach ($rule in $rules) {
    New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Action Allow `
      -Protocol $rule.Protocol -LocalPort $rule.Port -RemoteAddress $radminRange -Profile Any | Out-Null
    Write-Host "Liberado: $($rule.Name)" -ForegroundColor Green
  }
  Write-Host "`nPronto. Só endereços do Radmin ($radminRange) conseguem entrar nessas portas."
}

Write-Host "`nPode fechar esta janela."
Read-Host 'Aperte Enter para sair' | Out-Null
