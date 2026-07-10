# Déploiement Railway — gère la charting library TradingView.
#
# Problème : `railway up` respecte TOUTES les sources d'ignore de git
# (.gitignore, .git/info/exclude) et refuse donc d'uploader la librairie,
# qui doit rester ignorée par git (licence TradingView : jamais sur un repo
# public). Solution : on retire l'exclusion le temps de l'upload, puis on la
# remet immédiatement.
#
# Usage : npm run deploy   (ou powershell -File scripts/deploy.ps1)

$ErrorActionPreference = 'Stop'
$exclude = ".git\info\exclude"
$rule = "public/charting_library/"

Write-Host "1/3 Levée temporaire de l'exclusion git de la charting library..."
$content = @()
if (Test-Path $exclude) { $content = Get-Content $exclude | Where-Object { $_ -ne $rule } }
$content | Set-Content $exclude -Encoding ascii

try {
    Write-Host "2/3 railway up (upload + build)..."
    railway up --detach
} finally {
    Write-Host "3/3 Restauration de l'exclusion git..."
    Add-Content -Path $exclude -Value $rule -Encoding ascii
    $check = git check-ignore public/charting_library/charting_library.standalone.js 2>$null
    if ($check) { Write-Host "OK: charting library de nouveau ignorée par git" }
    else { Write-Warning "ATTENTION: la charting library n'est plus ignorée par git !" }
}

Write-Host "Suivi du build : railway logs --build | Statut : railway deployment list"
