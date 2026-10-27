# Tapis — l'application

Poker Texas Hold'em No Limit entre amis, en temps réel, sur téléphone et ordinateur. Jetons fictifs uniquement.

## Lancer en local

Prérequis : Node 20 ou plus.

```bash
npm install
npm run dev
```

- Interface : http://localhost:5173 (le serveur de jeu tourne sur le port 3001, Vite fait le relais).
- Depuis un téléphone sur le même Wi-Fi : http://<IP-du-PC>:5173 (l'adresse s'affiche au lancement).
- Si npm bloque le script d'installation d'esbuild : `npm install-scripts approve esbuild`.

## Tester seul

- `npm test` : moteur de jeu (classement des mains, pots annexes, 3 000 mains aléatoires).
- `npx tsx server/scripts/simulation.ts` : 3 bots jouent 20 mains contre le serveur lancé.
- `npx tsx server/scripts/bots.ts <code-table> 3` : 3 bots demandent une place à votre table (le code est la fin de l'URL `/t/<code>`).

## Jouer avec des amis depuis ce PC (tunnel)

Clic droit sur `en-ligne.ps1` → « Exécuter avec PowerShell », ou dans un terminal :

```powershell
powershell -ExecutionPolicy Bypass -File .\en-ligne.ps1
```

Le script construit l'application, lance le serveur et ouvre un tunnel Cloudflare (cloudflared, sans compte). Le lien `https://….trycloudflare.com` s'affiche dans l'encadré « Your quick Tunnel has been created » : c'est lui qu'on partage. Il change à chaque lancement et ne marche que tant que le PC est allumé, éveillé et la fenêtre ouverte. Ctrl+C arrête tout (les tables en cours sont perdues).

## Mettre en ligne sur un hébergeur

```bash
npm run build
PORT=8080 npm start
```

Un seul processus Node sert l'application et le jeu (WebSocket). Il faut un hébergeur qui garde un processus allumé (Render, Railway, Fly.io, un VPS) : pas Netlify ni Vercel, qui ne gardent pas de WebSocket ouvert. Les tables vivent en mémoire : un redémarrage les efface.

## Organisation

| Dossier | Rôle |
|---|---|
| `packages/engine` | Règles du jeu, sans réseau : paquet, évaluation des mains, enchères, pots annexes. Protocole partagé (`protocol.ts`). |
| `server` | Serveur Express + Socket.IO : tables, propriétaire, demandes de place, minuteur, journal, ledger. L'état envoyé à chaque joueur ne contient que ses propres cartes. |
| `web` | Application React (Vite), installable sur l'écran d'accueil (PWA). |

Le serveur fait autorité : le téléphone n'envoie que des intentions (« relancer à 150 »), le serveur vérifie et distribue. Les cartes sont mélangées avec `crypto.randomInt`.
