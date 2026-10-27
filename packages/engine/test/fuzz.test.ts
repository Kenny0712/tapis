import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PokerTable } from '../src/index';

// Graine fixe pour rejouer une erreur à l'identique.
function rng(seed: number) {
  return (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
}

test('3 000 mains jouées au hasard : aucun jeton ne se crée ni ne se perd', () => {
  for (let game = 0; game < 30; game++) {
    const r = rng(game + 1);
    const players = 2 + r(5);
    const t = new PokerTable({ maxSeats: 12, smallBlind: 5, bigBlind: 10, ante: r(2) }, r);
    let total = 0;
    for (let p = 0; p < players; p++) {
      const stack = 20 + r(500);
      total += stack;
      t.sit(p * 2, 'p' + p, 'P' + p, stack); // sièges espacés : 0, 2, 4…
    }
    for (let h = 0; h < 100 && t.readySeats().length >= 2; h++) {
      t.startHand();
      let guard = 0;
      while (!t.hand!.ended) {
        assert.ok(guard++ < 200, 'boucle infinie');
        const i = t.hand!.toAct!;
        assert.notEqual(i, null);
        const legal = t.legalActions(i)!;
        const id = t.seats[i]!.playerId;
        const roll = r(10);
        if (roll === 0 && legal.canFold) t.act(id, { type: 'fold' });
        else if (roll < 3 && legal.canRaise) {
          const to = legal.minRaiseTo + r(Math.max(1, legal.maxRaiseTo - legal.minRaiseTo + 1));
          t.act(id, { type: 'raise', amount: to });
        } else if (roll === 3) t.act(id, { type: 'allin' });
        else t.act(id, { type: legal.canCheck ? 'check' : 'call' });
        const inPlay = t.seats.reduce((a, s) => a + (s ? s.stack + (t.hand!.ended ? 0 : s.committed) : 0), 0);
        if (!t.hand!.ended) assert.equal(inPlay, total);
      }
      const after = t.seats.reduce((a, s) => a + (s?.stack ?? 0), 0);
      assert.equal(after, total, `partie ${game}, main ${h}`);
      for (const s of t.seats) assert.ok(!s || s.stack >= 0);
    }
  }
});
