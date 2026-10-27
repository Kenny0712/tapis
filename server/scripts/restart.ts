// Test de bout en bout : le serveur est tué brutalement en pleine main puis relancé.
// La table doit reprendre (même code, mêmes tapis), les joueurs se reconnecter seuls, et les pré-actions jouer.
// Usage : npx tsx server/scripts/restart.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { ClientState, ClientToServer, ServerToClient } from '@tapis/engine';

const PORT = 3400 + Math.floor(Math.random() * 500);
const URL = `http://localhost:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'tapis-reprise-'));
const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function startServer(): Promise<ChildProcess> {
  const child = spawn(process.execPath, [tsxCli, 'server/src/index.ts', '--port', String(PORT)], {
    env: { ...process.env, TAPIS_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr!.on('data', (d) => process.stderr.write(`[serveur] ${d}`));
  return new Promise((resolve) => {
    child.stdout!.on('data', (d) => {
      const text = String(d);
      if (text.includes('reprise')) console.log('  ' + text.trim());
      if (text.includes('serveur sur')) resolve(child);
    });
  });
}

type S = Socket<ServerToClient, ClientToServer>;

function bot(name: string, usesPreActions = false) {
  const sock: S = io(URL, { transports: ['websocket'], reconnectionDelay: 300 });
  const me = { playerId: randomUUID(), token: randomUUID() };
  let gameId = '';
  let state: ClientState | null = null;
  let manualActs = 0;
  const emit = (ev: keyof ClientToServer, p: object) =>
    new Promise<any>((res) => (sock.emit as any)(ev, p, res));
  // Comme l'application : à chaque reconnexion, on rejoint la table.
  sock.on('connect', () => { if (gameId) emit('join', { ...me, gameId }); });
  sock.on('state', (s) => {
    state = s;
    const mine = s.you.seat !== null ? s.seats[s.you.seat] : null;
    const myTurn = !!s.legal && s.hand?.toAct === s.you.seat;
    if (usesPreActions && !myTurn && mine?.inHand && !mine.folded && !mine.allIn && s.hand && !s.hand.ended && !s.you.preAction) {
      emit('setPreAction', { type: Math.random() < 0.8 ? 'callany' : 'checkfold' });
    }
    if (myTurn) {
      const hand = s.hand!.number, street = s.hand!.street, key = `${hand}-${street}-${s.hand!.currentBet}`;
      // Alice ne joue à la main que si sa pré-action n'a pas suffi (nouveau tour d'enchères).
      setTimeout(() => {
        if (!state?.legal || state.hand?.toAct !== state.you.seat) return;
        if (`${state.hand!.number}-${state.hand!.street}-${state.hand!.currentBet}` !== key) return;
        manualActs++;
        const r = Math.random();
        const a = r < 0.1 && state.legal.canFold ? { type: 'fold' }
          : r < 0.25 && state.legal.canRaise ? { type: 'raise', amount: state.legal.minRaiseTo }
          : { type: state.legal.canCheck ? 'check' : 'call' };
        emit('act', a);
      }, usesPreActions ? 1200 : 30);
    }
  });
  return {
    sock, me, emit, name,
    get state() { return state; },
    get manualActs() { return manualActs; },
    setGame(id: string) { gameId = id; },
  };
}

const total = (s: ClientState) =>
  s.seats.reduce((t, x) => t + (x?.stack ?? 0), 0) + (s.hand && !s.hand.ended ? s.hand.totalPot : 0);

let server = await startServer();
const host = bot('Hôte');
const alice = bot('Alice', true);
const bob = bot('Bob');
await wait(300);
const { gameId } = await host.emit('create', { ...host.me, name: 'Hôte', config: { smallBlind: 5, bigBlind: 10 } });
for (const b of [host, alice, bob]) b.setGame(gameId);
await alice.emit('join', { ...alice.me, gameId });
await bob.emit('join', { ...bob.me, gameId });
await host.emit('requestSeat', { seat: 0, name: 'Hôte', stack: 1000 });
await alice.emit('requestSeat', { seat: 3, name: 'Alice', stack: 1000 });
await bob.emit('requestSeat', { seat: 6, name: 'Bob', stack: 1000 });
await wait(150);
for (const r of host.state!.requests) await host.emit('approve', { requestId: r.id });
await host.emit('updateConfig', { showdownTime: 1, decisionTime: 8, timeBank: 0 });
await host.emit('start', {});
console.log(`Table ${gameId} lancée sur le port ${PORT}`);

const until = async (cond: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await wait(100);
  return cond();
};

// 1. Quelques mains, puis on attend le milieu d'une main (après le flop) pour couper.
await until(() => (host.state?.hand?.number ?? 0) >= 4, 60_000);
const midBetting = () => {
  const h = host.state?.hand;
  return !!h && !h.ended && ['flop', 'turn', 'river'].includes(h.street) && h.toAct !== null;
};
let before = host.state!;
for (let tries = 0; tries < 50; tries++) {
  await until(midBetting, 30_000);
  const hand = host.state!.hand!.number;
  await wait(450); // la sauvegarde regroupe les changements toutes les 0,4 s
  if (midBetting() && host.state!.hand!.number === hand) { before = host.state!; break; }
}
console.log(`Coupure brutale pendant la main n°${before.hand!.number} (${before.hand!.street}), jetons en jeu : ${total(before)}`);
server.kill('SIGKILL');
await wait(1000);

// 2. Relance : même dossier de sauvegarde.
server = await startServer();
const reconnected = await until(() => [host, alice, bob].every((b) => b.sock.connected), 15_000);
await until(() => (host.state?.log ?? []).some((l) => l.text.includes('Serveur redémarré')), 10_000);
const after = host.state!;
console.log(`Après relance : main n°${after.hand?.number} (${after.hand?.street}), jetons en jeu : ${total(after)}, joueurs reconnectés : ${reconnected}`);

// 3. La partie continue.
const target = before.hand!.number + 6;
await until(() => (host.state?.hand?.number ?? 0) >= target, 90_000);
const end = host.state!;
const aliceActs = new Set(
  [alice, host, bob].flatMap((b) => (b.state?.log ?? []))
    .filter((l) => /^Alice (suit|checke|se couche|relance|mise|fait tapis)/.test(l.text))
    .map((l) => l.at + l.text),
).size;
const aliceTimedOut = end.log.some((l) => l.text.startsWith("Alice n'a pas joué à temps"));
console.log(`Mains jouées : ${end.hand?.number} · jetons : ${total(end)} (attendu 3000)`);
console.log(`Alice : ${aliceActs} actions dans le journal récent, dont ${alice.manualActs} à la main ; jamais absente : ${!aliceTimedOut}`);

const ok = end.gameId === gameId
  && total(before) === 3000 && total(after) === 3000 && total(end) === 3000
  && reconnected && (end.hand?.number ?? 0) >= target
  && aliceActs > alice.manualActs && !aliceTimedOut;
console.log(ok ? 'OK' : 'ÉCHEC');

for (const b of [host, alice, bob]) b.sock.close();
server.kill('SIGKILL');
await wait(300);
rmSync(dataDir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
