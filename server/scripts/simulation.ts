// Test de bout en bout : un hôte et deux invités jouent 20 mains contre le serveur lancé.
// Usage : npm run start (dans un autre terminal), puis npx tsx server/scripts/simulation.ts
import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type { ClientState, ClientToServer, ServerToClient } from '@tapis/engine';

const URL = process.env.TAPIS_URL ?? 'http://localhost:3001';
type S = Socket<ServerToClient, ClientToServer>;

function bot(name: string) {
  const sock: S = io(URL, { transports: ['websocket'] });
  const me = { playerId: randomUUID(), token: randomUUID(), name };
  let state: ClientState | null = null;
  const call = <T>(ev: keyof ClientToServer, p: object) =>
    new Promise<T>((res, rej) =>
      (sock.emit as any)(ev, p, (r: any) => (r.ok ? res(r) : rej(new Error(`${name} ${ev}: ${r.error}`)))),
    );
  sock.on('state', (s) => {
    state = s;
    const legal = s.legal;
    if (legal && s.hand?.toAct === s.you.seat) {
      const r = Math.random();
      const action = r < 0.1 && legal.canFold ? { type: 'fold' }
        : r < 0.25 && legal.canRaise ? { type: 'raise', amount: legal.minRaiseTo }
        : { type: legal.canCheck ? 'check' : 'call' };
      setTimeout(() => call('act', action).catch(() => {}), 5);
    }
  });
  return { sock, me, call, get state() { return state; } };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const host = bot('Hôte');
const a = bot('Alice');
const b = bot('Bob');
const { gameId } = await host.call<{ gameId: string }>('create', { ...host.me, config: { smallBlind: 5, bigBlind: 10 } });
console.log('Table créée', gameId);
await a.call('join', { ...a.me, gameId });
await b.call('join', { ...b.me, gameId });
await host.call('requestSeat', { seat: 0, name: 'Hôte', stack: 1000 });
await a.call('requestSeat', { seat: 3, name: 'Alice', stack: 1000 });
await b.call('requestSeat', { seat: 6, name: 'Bob', stack: 1000 });
await wait(100);
const reqs = host.state!.requests;
console.log('Demandes en attente :', reqs.map((r) => r.name).join(', '));
for (const r of reqs) await host.call('approve', { requestId: r.id });
await host.call('updateConfig', { showdownTime: 1, decisionTime: 5 });
await host.call('start', {});

const deadline = Date.now() + 60_000;
while ((host.state?.hand?.number ?? 0) < 20 && Date.now() < deadline) await wait(200);

const s = host.state!;
const total = s.seats.reduce((t, x) => t + (x?.stack ?? 0), 0) + (s.hand && !s.hand.ended ? s.hand.totalPot : 0);
console.log('Mains jouées :', s.hand?.number, '· jetons en jeu :', total, '(attendu 3000)');
console.log('Ledger :', s.ledger.map((l) => `${l.name} ${l.net >= 0 ? '+' : ''}${l.net}`).join(' · '));
console.log('Extrait du journal :\n  ' + s.log.slice(-8).map((l) => l.text).join('\n  '));
const ok = (s.hand?.number ?? 0) >= 20 && total === 3000;
console.log(ok ? 'OK' : 'ÉCHEC');
for (const x of [host, a, b]) x.sock.close();
process.exit(ok ? 0 : 1);
