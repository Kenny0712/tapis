# Met Tapis en ligne depuis ce PC : construit l'application, lance le serveur, ouvre un tunnel Cloudflare.
# Le lien https s'affiche dans l'encadré « Your quick Tunnel has been created ». Ctrl+C pour tout arrêter.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

npm run build
if ($LASTEXITCODE -ne 0) { throw 'La construction a échoué' }

$env:PORT = '3001'
$server = Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -NoNewWindow -PassThru
try {
  Start-Sleep -Seconds 3
  # cloudflared : dans le PATH, sinon à l'emplacement d'installation de winget.
  $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
  if (-not $cloudflared) { $cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }
  if (-not (Test-Path $cloudflared)) { throw 'cloudflared introuvable : winget install Cloudflare.cloudflared' }
  & $cloudflared tunnel --no-autoupdate --url http://localhost:3001
}
finally {
  # npm lance node en sous-processus : on arrête tout l'arbre.
  taskkill /PID $server.Id /T /F | Out-Null
}
