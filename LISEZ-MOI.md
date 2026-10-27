# Tapis — l'application (dossier de production Pragma)

Tout ce qu'il faut pour lancer, tester et mettre en ligne est dans [README.md](README.md). Ce fichier ne garde que ce qui est propre au poste de Kenny.

## Jouer avec des amis depuis ce PC (tunnel)

Clic droit sur `en-ligne.ps1` → « Exécuter avec PowerShell », ou dans un terminal :

```powershell
powershell -ExecutionPolicy Bypass -File .\en-ligne.ps1
```

Le script construit l'application, lance le serveur et ouvre un tunnel Cloudflare (cloudflared, installé avec winget, sans compte). Le lien `https://….trycloudflare.com` s'affiche dans l'encadré « Your quick Tunnel has been created » : c'est lui qu'on partage. Il change à chaque lancement et ne marche que tant que le PC est allumé, éveillé et la fenêtre ouverte. Ctrl+C arrête tout (les tables en cours sont perdues).

## Dépôt git

Ce dossier est un dépôt git (branche `main`), publié en open source sous licence AGPL-3.0.
