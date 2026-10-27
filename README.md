# Tapis

**Une table de poker privée entre amis, sur téléphone et ordinateur.** Un lien suffit : on crée une table, on partage le lien, tout le monde s'assoit. Jetons fictifs uniquement, aucun argent réel.

> *English: Tapis is a free, open-source app to play No-Limit Texas Hold'em with friends in real time, on phones and desktops. Play money only. Create a table, share the link, play. Interface in French. Licensed under AGPL-3.0.*

## Fonctionnalités

- **Texas Hold'em No Limit**, de 2 à 10 joueurs : blindes, ante, straddle UTG, pots annexes, partage du pot, tableau déroulé automatiquement quand tout le monde est à tapis.
- **Table privée par lien** : le créateur est propriétaire, il valide les places et les recaves, règle la partie, peut mettre en pause, ajuster un tapis ou retirer un joueur.
- **Réglages** : blindes fixes ou par niveaux qui montent, nombre de sièges, temps pour jouer et réserve de temps, durée de l'abattage, rabbit hunting, mains dévoilées à tapis, recaves, chat des spectateurs.
- **Pendant la partie** : pré-actions (Check / Fold, Check ou Suivre, Suivre tout) jouées automatiquement à votre tour, journal des mains, ledger (entrées, sorties, net), chat, absence, signal sonore quand c'est à vous.
- **Reprise après redémarrage** : chaque table est sauvegardée sur disque ; si le serveur redémarre, même en pleine main, la partie reprend où elle était et les joueurs se reconnectent seuls.
- **Mobile d'abord** : table debout et grands boutons sur téléphone, table ovale et raccourcis clavier sur ordinateur (F se coucher, C checker/suivre, R relancer). Installable sur l'écran d'accueil (PWA).

## Lancer en local

Prérequis : Node 20 ou plus.

```bash
npm install
npm run dev
```

- Application : http://localhost:5173 (le serveur de jeu tourne sur le port 3001, Vite fait le relais).
- Depuis un téléphone sur le même Wi-Fi : `http://<IP-de-l-ordinateur>:5173`.
- Si npm bloque le script d'installation d'esbuild : `npm install-scripts approve esbuild`.

## Tests

```bash
npm test
```

Le moteur est testé à part : classement des mains, pots annexes, straddle, rabbit hunting, et 3 000 mains jouées au hasard sans qu'un seul jeton ne se crée ni ne se perde.

Deux scripts pour tester le serveur lancé :

- `npx tsx server/scripts/simulation.ts` : trois bots jouent 20 mains.
- `npx tsx server/scripts/bots.ts <code-table> 3` : trois bots demandent une place à votre table (le code est la fin de l'URL `/t/<code>`).
- `npx tsx server/scripts/restart.ts` : lance son propre serveur, le coupe brutalement en pleine main, le relance et vérifie que la partie reprend sans perte de jetons (pré-actions comprises).

## Mettre en ligne

```bash
npm run build
PORT=8080 npm start
```

Un seul processus Node sert l'application et le jeu (WebSocket). Il faut un hébergeur qui garde un processus allumé : Render (un `render.yaml` est fourni), Railway, Fly.io ou un VPS. Netlify et Vercel ne conviennent pas.

Les tables sont sauvegardées dans `server/data/` (ou le dossier indiqué par `TAPIS_DATA_DIR`) et reprises au démarrage ; une table inactive depuis 12 h est supprimée. Le disque doit survivre aux redémarrages : c'est le cas sur un VPS ou avec un disque persistant, pas sur l'offre gratuite de Render, dont le disque est effacé à chaque mise en veille ou mise à jour.

Pour jouer depuis son propre ordinateur sans hébergeur, `en-ligne.ps1` (Windows) ouvre un tunnel Cloudflare et affiche un lien https temporaire.

Si vous publiez une version modifiée, renseignez l'adresse de son code source dans la variable `VITE_SOURCE_URL` au moment du `npm run build` : l'application affiche ce lien à ses joueurs, comme le demande la licence AGPL.

## Organisation du code

| Dossier | Rôle |
|---|---|
| `packages/engine` | Règles du jeu sans réseau : paquet, évaluation des mains, enchères, pots annexes. Protocole partagé avec l'application (`protocol.ts`). |
| `server` | Express + Socket.IO : tables, propriétaire, demandes de place, minuteurs, niveaux de blindes, journal, ledger. Chaque joueur ne reçoit que ses propres cartes. |
| `web` | Application React (Vite). |

Le serveur fait autorité : l'application n'envoie que des intentions (« relancer à 150 »), le serveur vérifie et distribue. Les cartes sont mélangées avec `crypto.randomInt`.

## Contribuer

Les signalements de bugs et les propositions sont bienvenus dans les *issues*. Pour une modification du moteur de jeu, ajoutez un test dans `packages/engine/test` et vérifiez que `npm test` passe.

## Licence

Copyright © 2026 Tiavina Kenny.

Tapis est un logiciel libre : vous pouvez le redistribuer et le modifier selon les termes de la **GNU Affero General Public License** publiée par la Free Software Foundation, version 3 ou (à votre choix) toute version ultérieure. Voir [LICENSE](LICENSE).

En clair : vous pouvez utiliser, modifier et héberger Tapis, y compris pour d'autres. Si vous proposez une version modifiée à des joueurs sur un réseau, vous devez leur donner accès à son code source sous la même licence.

Polices Inter et Fraunces (SIL Open Font License), chargées depuis Google Fonts. Certaines icônes reprennent le tracé des icônes [Lucide](https://lucide.dev) (licence ISC).
