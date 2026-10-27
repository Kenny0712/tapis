// Fait asseoir des joueurs automatiques à une table existante, pour tester l'interface seul.
// Usage : npx tsx server/scripts/bots.ts <code-de-table> [nombre=3]
import { io } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type { ClientState } from '@tapis/engine';

const URL = process.env.TAPIS_URL ?? 'http://localhost:3001';
const [gameId, count = '3'] = process.argv.slice(2);
if (!gameId) throw new Error('Indiquez le code de la table');
const NAMES = ['Aina', 'Bako', 'Fara', 'Haja', 'Lova', 'Mamy', 'Nirina', 'Rado'];

for (let b = 0; b < Number(count); b++) {
  const sock = io(URL, { transports: ['websocket'] });
  const me = { playerId: randomUUID(), token: randomUUID() };
  const emit = (ev: string, p: object) => new Promise<any>((res) => (sock.emit as any)(ev, p, res));
  let seated = false;
  sock.on('state', (s: ClientState) => {
    if (!seated && s.you.seat === null && !s.you.pendingRequest) {
      seated = true;
      // Un siège au hasard parmi les libres ; en cas de refus, on retente au prochain état.
      const free = s.seats.flatMap((x, i) => (!x && i !== 0 && !s.pendingSeats.includes(i) ? [i] : []));
      const seat = free[Math.floor(Math.random() * free.length)];
      if (seat !== undefined)
        emit('requestSeat', { seat, name: NAMES[b % NAMES.length], stack: s.config.bigBlind * 100 })
          .then((r) => { if (!r.ok) seated = false; });
    }
    if (s.legal && s.hand?.toAct === s.you.seat) {
      const r = Math.random();
      const a = r < 0.15 && s.legal.canFold ? { type: 'fold' }
        : r < 0.3 && s.legal.canRaise ? { type: 'raise', amount: s.legal.minRaiseTo }
        : { type: s.legal.canCheck ? 'check' : 'call' };
      setTimeout(() => emit('act', a), 700 + Math.random() * 900);
    }
  });
  await emit('join', { ...me, gameId });
}
console.log(`${count} bots à la table ${gameId}`);
