import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, compareScores, PokerTable, Card } from '../src/index';

const ev = (s: string) => evaluate(s.split(' '));

test('classement des mains', () => {
  const order = [
    'As Kd 9h 7c 3s 2d 4h', // hauteur
    'As Ad 9h 7c 3s 2d Jh', // paire
    'As Ad 9h 9c 3s 2d Jh', // double paire
    'As Ad Ah 9c 3s 2d Jh', // brelan
    'As 2d 3h 4c 5s 9d Jh', // roue
    '6s 2d 3h 4c 5s 9d Jh', // quinte au six
    'As 9s 3s 4s 7s 9d Jh', // couleur
    'As Ad Ah 9c 9s 2d Jh', // full
    'As Ad Ah Ac 9s 2d Jh', // carré
    'Ts Js Qs Ks As 2d 3h', // quinte flush royale
  ].map(ev);
  for (let i = 1; i < order.length; i++) {
    assert.ok(compareScores(order[i].score, order[i - 1].score) > 0, `${order[i].name} > ${order[i - 1].name}`);
  }
  assert.equal(order[4].name, 'Quinte au cinq');
  assert.equal(order[9].name, 'Quinte flush royale');
  assert.equal(order[7].name, 'Full aux as par les neuf');
});

test('kicker départage, égalité exacte', () => {
  assert.ok(compareScores(ev('As Ad Kh 7c 3s').score, ev('Ac Ah Qh 7d 3c').score) > 0);
  assert.equal(compareScores(ev('As Ad Kh 7c 3s').score, ev('Ac Ah Kd 7d 3c').score), 0);
});

/** Table dont le paquet est fixé : `cards` sont distribuées dans l'ordre (pop depuis la fin). */
function rigged(stacks: number[], cards: Card[], cfg = { smallBlind: 10, bigBlind: 20, ante: 0 }) {
  const t = new PokerTable({ maxSeats: 6, ...cfg }, () => 0);
  stacks.forEach((st, i) => t.sit(i, 'p' + i, 'P' + i, st));
  t.startHand();
  // On remplace les cartes distribuées et le paquet par un ordre connu.
  const h = t.hand!;
  const deck = cards.slice().reverse();
  const order: number[] = [];
  let i = h.dealer;
  const n = t.readySeats().length;
  for (let k = 0; k < n; k++) {
    do i = (i + 1) % t.seats.length; while (!t.seats[i]?.inHand);
    order.push(i);
  }
  for (const s of t.seats) if (s) s.hole = [];
  for (let r = 0; r < 2; r++) for (const j of order) t.seats[j]!.hole.push(deck.pop()!);
  h.deck = deck;
  return t;
}

test('main complète à 3 : blindes, relance, gagnant', () => {
  // dealer = siège 0, PB = 1, GB = 2. Ordre de distribution : 1, 2, 0.
  const t = rigged([1000, 1000, 1000], [
    'Ah', '2c', 'Kd', // 1re carte de 1, 2, 0
    'As', '7d', 'Kc', // 2e carte
    'x1', 'Ad', '9s', '3h', // brûlée + flop
    'x2', '4c', // brûlée + turn
    'x3', 'Jd', // brûlée + river
  ]);
  assert.equal(t.hand!.dealer, 0);
  assert.equal(t.hand!.toAct, 0); // UTG = bouton à 3
  t.act('p0', { type: 'raise', amount: 60 });
  t.act('p1', { type: 'call' });
  t.act('p2', { type: 'fold' });
  assert.equal(t.hand!.street, 'flop');
  assert.equal(t.hand!.toAct, 1);
  t.act('p1', { type: 'check' });
  t.act('p0', { type: 'raise', amount: 100 });
  t.act('p1', { type: 'call' });
  t.act('p1', { type: 'check' });
  t.act('p0', { type: 'check' });
  t.act('p1', { type: 'check' });
  t.act('p0', { type: 'check' });
  assert.ok(t.hand!.ended);
  assert.equal(t.hand!.winners[0].seat, 1);
  assert.equal(t.hand!.winners[0].amount, 60 + 60 + 20 + 100 + 100);
  assert.equal(t.seats[1]!.stack, 1000 + 160 + 20);
  const total = t.seats.reduce((a, s) => a + (s?.stack ?? 0), 0);
  assert.equal(total, 3000);
});

test('pots annexes avec un tapis court', () => {
  // 0 bouton, 1 PB (100 jetons), 2 GB. Le siège 1 a la meilleure main mais ne gagne que le pot principal.
  const t = rigged([1000, 100, 1000], [
    'Ah', '2c', 'Kd',
    'As', '7d', 'Kc',
    'x', 'Qd', '9s', '3h', 'x', '4c', 'x', '2d',
  ]);
  t.act('p0', { type: 'raise', amount: 300 });
  t.act('p1', { type: 'allin' });
  t.act('p2', { type: 'call' });
  // Flop : 0 et 2 peuvent encore miser.
  assert.equal(t.hand!.street, 'flop');
  t.act('p2', { type: 'check' });
  t.act('p0', { type: 'raise', amount: 200 });
  t.act('p2', { type: 'fold' });
  assert.ok(t.hand!.ended);
  const pots = t.hand!.pots;
  assert.equal(pots[0].amount, 300); // 100 x 3
  assert.deepEqual(pots[0].eligible.sort(), [0, 1]);
  assert.equal(t.seats[1]!.stack, 300);
  assert.equal(t.seats[0]!.stack, 1000 - 300 + 400);
  assert.equal(t.seats[2]!.stack, 700);
});

test("tapis de tous les joueurs : le tableau se déroule seul", () => {
  const t = rigged([500, 500], ['Ah', 'Kd', 'As', 'Kc', 'x', '2d', '7s', '9h', 'x', '3c', 'x', '4d']);
  // A deux, le bouton est petite blinde et parle en premier.
  assert.equal(t.hand!.toAct, t.hand!.dealer);
  t.act('p' + t.hand!.dealer, { type: 'allin' });
  t.act('p' + t.hand!.bigBlindSeat, { type: 'call' });
  assert.ok(t.hand!.ended);
  assert.ok(t.hand!.runout);
  assert.equal(t.hand!.board.length, 5);
  assert.equal(t.hand!.winners[0].amount, 1000);
});

test('relance minimum et mise non suivie rendue', () => {
  const t = rigged([1000, 1000, 1000], ['Ah', '2c', 'Kd', 'As', '7d', 'Kc', 'x', 'Qd', '9s', '3h']);
  assert.throws(() => t.act('p0', { type: 'raise', amount: 30 }), /minimum/);
  t.act('p0', { type: 'raise', amount: 500 });
  t.act('p1', { type: 'fold' });
  t.act('p2', { type: 'fold' });
  assert.equal(t.seats[0]!.stack, 1030);
});

test('partage du pot', () => {
  // Le tableau joue pour tout le monde : quinte flush royale sur la table.
  const t = rigged([1000, 1000, 1000], ['2h', '3c', '4d', '2s', '3d', '4c', 'x', 'Ts', 'Js', 'Qs', 'x', 'Ks', 'x', 'As'], {
    smallBlind: 5, bigBlind: 10, ante: 1,
  });
  t.act('p0', { type: 'call' });
  t.act('p1', { type: 'raise', amount: 20 });
  t.act('p2', { type: 'call' });
  t.act('p0', { type: 'call' });
  for (let k = 0; k < 9; k++) t.act('p' + t.hand!.toAct, { type: 'check' });
  assert.ok(t.hand!.ended);
  assert.equal(t.hand!.winners.length, 3);
  const total = t.seats.reduce((a, s) => a + (s?.stack ?? 0), 0);
  assert.equal(total, 3000);
});

test('le bouton tourne et un joueur qui part se couche', () => {
  const t = new PokerTable({ maxSeats: 6, smallBlind: 10, bigBlind: 20, ante: 0 }, (n) => Math.floor(Math.random() * n));
  t.sit(0, 'a', 'A', 1000);
  t.sit(2, 'b', 'B', 1000);
  t.sit(4, 'c', 'C', 1000);
  t.startHand();
  const d1 = t.hand!.dealer;
  t.stand(t.hand!.toAct!);
  t.forceFold(t.hand!.toAct!);
  assert.ok(t.hand!.ended);
  t.startHand();
  assert.notEqual(t.hand!.dealer, d1);
});

test('straddle UTG : 2 GB, parle en dernier préflop', () => {
  const t = new PokerTable({ maxSeats: 6, smallBlind: 10, bigBlind: 20, ante: 0 }, () => 0);
  ['a', 'b', 'c', 'd'].forEach((id, i) => t.sit(i, id, id, 1000));
  t.startHand({ straddle: (id) => id === 'd' });
  // bouton 0, PB 1, GB 2, straddle 3 : le bouton parle en premier.
  assert.equal(t.hand!.straddleSeat, 3);
  assert.equal(t.hand!.currentBet, 40);
  assert.equal(t.hand!.toAct, 0);
  assert.equal(t.legalActions(0)!.minRaiseTo, 80);
  t.act('a', { type: 'call' });
  t.act('b', { type: 'call' });
  t.act('c', { type: 'call' });
  assert.equal(t.hand!.toAct, 3); // l'option revient au straddle
  assert.ok(t.legalActions(3)!.canCheck);
  t.act('d', { type: 'check' });
  assert.equal(t.hand!.street, 'flop');
});

test('rabbit hunting et nombre de sièges', () => {
  const t = new PokerTable({ maxSeats: 9, smallBlind: 10, bigBlind: 20, ante: 0 }, () => 0);
  t.sit(0, 'a', 'A', 1000);
  t.sit(1, 'b', 'B', 1000);
  assert.throws(() => t.setMaxSeats(1));
  t.setMaxSeats(4);
  assert.equal(t.seats.length, 4);
  t.sit(3, 'c', 'C', 1000);
  assert.throws(() => t.setMaxSeats(3), /Libérez/);
  t.startHand();
  t.act(t.seats[t.hand!.toAct!]!.playerId, { type: 'fold' });
  t.act(t.seats[t.hand!.toAct!]!.playerId, { type: 'fold' });
  assert.ok(t.hand!.ended);
  const rabbit = t.rabbitCards();
  assert.equal(rabbit.length, 5);
  assert.equal(new Set(rabbit).size, 5);
});
