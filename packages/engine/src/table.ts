import { Card, newDeck, shuffle } from './cards';
import { compareScores, evaluate } from './evaluator';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface PlayerAction {
  type: ActionType;
  /** Pour `raise` : montant total de la mise après relance (« relancer à »). */
  amount?: number;
}

export interface TableConfig {
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
}

export interface Seat {
  playerId: string;
  name: string;
  stack: number;
  sittingOut: boolean;
  // État de la main en cours
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Mise posée sur ce tour d'enchères. */
  bet: number;
  /** Total misé depuis le début de la main (antes compris). */
  committed: number;
  hole: Card[];
  hasActed: boolean;
  lastAction: string | null;
  /** Cartes dévoilées à l'abattage. */
  shown: boolean;
}

export interface Pot {
  amount: number;
  eligible: number[];
}

export interface Winner {
  seat: number;
  amount: number;
  hand: string | null;
  cards: Card[];
}

export interface Hand {
  number: number;
  dealer: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  straddleSeat: number | null;
  street: Street;
  board: Card[];
  deck: Card[];
  currentBet: number;
  minRaise: number;
  toAct: number | null;
  pots: Pot[];
  winners: Winner[];
  ended: boolean;
  /** Plus personne ne peut miser : on déroule le tableau cartes visibles. */
  runout: boolean;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export type EngineEvent =
  | { type: 'handStart'; hand: number; dealer: number }
  | { type: 'blind'; seat: number; amount: number; kind: 'petite' | 'grosse' | 'ante' | 'straddle' }
  | { type: 'action'; seat: number; action: ActionType; amount: number; allIn: boolean; opening?: boolean }
  | { type: 'street'; street: Street; board: Card[] }
  | { type: 'refund'; seat: number; amount: number }
  | { type: 'show'; seat: number; cards: Card[]; hand: string }
  | { type: 'win'; seat: number; amount: number; hand: string | null }
  | { type: 'handEnd'; hand: number };

export class PokerTable {
  seats: (Seat | null)[];
  hand: Hand | null = null;
  handCount = 0;
  dealer = -1;
  private events: EngineEvent[] = [];

  constructor(
    public config: TableConfig,
    private randomInt: (n: number) => number,
  ) {
    this.seats = Array.from({ length: config.maxSeats }, () => null);
  }

  // ---------- Places ----------

  sit(index: number, playerId: string, name: string, stack: number): void {
    if (index < 0 || index >= this.seats.length) throw new Error('Siège inexistant');
    if (this.seats[index]) throw new Error('Siège occupé');
    if (this.seatOf(playerId) !== -1) throw new Error('Déjà assis');
    this.seats[index] = {
      playerId, name, stack, sittingOut: false,
      inHand: false, folded: false, allIn: false, bet: 0, committed: 0,
      hole: [], hasActed: false, lastAction: null, shown: false,
    };
  }

  /** Retire un joueur. Pendant une main, il se couche d'abord ; le siège se libère quand la main est finie. */
  stand(index: number): boolean {
    const s = this.seats[index];
    if (!s) return false;
    if (this.hand && !this.hand.ended && s.inHand) {
      if (!s.folded) this.forceFold(index);
      return false;
    }
    this.seats[index] = null;
    return true;
  }

  /** Change le nombre de sièges ; seuls des sièges vides peuvent disparaître. */
  setMaxSeats(n: number): void {
    if (n < 2 || n > 10) throw new Error('Entre 2 et 10 sièges');
    if (this.seats.slice(n).some(Boolean)) throw new Error(`Libérez d'abord les sièges au-delà du n°${n}`);
    if (n < this.seats.length) this.seats.length = n;
    while (this.seats.length < n) this.seats.push(null);
    this.config.maxSeats = n;
  }

  /** Cartes qui seraient sorties si la main était allée jusqu'à la river (« rabbit hunting »). */
  rabbitCards(): Card[] {
    const h = this.hand;
    if (!h || !h.ended || h.board.length >= 5) return [];
    const deck = h.deck.slice();
    const out: Card[] = [];
    let shown = h.board.length;
    while (shown < 5) {
      deck.pop(); // brûlée
      const n = shown === 0 ? 3 : 1;
      for (let k = 0; k < n; k++) out.push(deck.pop()!);
      shown += n;
    }
    return out;
  }

  seatOf(playerId: string): number {
    return this.seats.findIndex((s) => s?.playerId === playerId);
  }

  get inProgress(): boolean {
    return !!this.hand && !this.hand.ended;
  }

  /** Joueurs qui recevront des cartes à la prochaine main. */
  readySeats(): number[] {
    return this.seats.flatMap((s, i) => (s && !s.sittingOut && s.stack > 0 ? [i] : []));
  }

  drainEvents(): EngineEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- Déroulement d'une main ----------

  /** `straddle(playerId)` : ce joueur, s'il est juste après la grosse blinde, poste un straddle de 2 grosses blindes. */
  startHand(options: { straddle?: (playerId: string) => boolean } = {}): void {
    if (this.inProgress) throw new Error('Une main est déjà en cours');
    const ready = this.readySeats();
    if (ready.length < 2) throw new Error('Il faut au moins deux joueurs');

    for (const s of this.seats) {
      if (!s) continue;
      Object.assign(s, {
        inHand: false, folded: false, allIn: false, bet: 0, committed: 0,
        hole: [], hasActed: false, lastAction: null, shown: false,
      });
    }
    for (const i of ready) this.seats[i]!.inHand = true;

    this.dealer = this.nextSeat(this.dealer, (s) => s.inHand);
    const headsUp = ready.length === 2;
    const sb = headsUp ? this.dealer : this.nextSeat(this.dealer, (s) => s.inHand);
    const bb = this.nextSeat(sb, (s) => s.inHand);
    const { smallBlind, bigBlind, ante } = this.config;

    this.handCount++;
    this.hand = {
      number: this.handCount,
      dealer: this.dealer,
      smallBlindSeat: sb,
      bigBlindSeat: bb,
      straddleSeat: null,
      street: 'preflop',
      board: [],
      deck: shuffle(newDeck(), this.randomInt),
      currentBet: bigBlind,
      minRaise: bigBlind,
      toAct: null,
      pots: [],
      winners: [],
      ended: false,
      runout: false,
    };
    this.events.push({ type: 'handStart', hand: this.handCount, dealer: this.dealer });

    if (ante > 0) {
      for (const i of ready) {
        const s = this.seats[i]!;
        const a = Math.min(ante, s.stack);
        s.stack -= a;
        s.committed += a;
        if (s.stack === 0) s.allIn = true;
        this.events.push({ type: 'blind', seat: i, amount: a, kind: 'ante' });
      }
    }
    this.postBlind(sb, smallBlind, 'petite');
    this.postBlind(bb, bigBlind, 'grosse');

    // Straddle UTG : une « troisième blinde » à 2 GB, possible à partir de 3 joueurs. Il parle en dernier préflop.
    let lastBlind = bb;
    if (ready.length >= 3 && options.straddle) {
      const utg = this.nextSeat(bb, (s) => s.inHand);
      const u = this.seats[utg]!;
      if (!u.allIn && options.straddle(u.playerId)) {
        this.postBlind(utg, bigBlind * 2, 'straddle');
        this.hand.straddleSeat = utg;
        this.hand.currentBet = Math.max(bigBlind, u.bet);
        this.hand.minRaise = bigBlind * 2;
        lastBlind = utg;
      }
    }

    // Deux cartes chacun, en commençant à gauche du bouton.
    for (let round = 0; round < 2; round++) {
      let i = this.dealer;
      for (let k = 0; k < ready.length; k++) {
        i = this.nextSeat(i, (s) => s.inHand);
        this.seats[i]!.hole.push(this.hand.deck.pop()!);
      }
    }

    this.hand.toAct = this.nextToAct(lastBlind);
    if (this.hand.toAct === null || this.bettingComplete()) this.endStreet();
  }

  private postBlind(i: number, amount: number, kind: 'petite' | 'grosse' | 'straddle') {
    const s = this.seats[i]!;
    const a = Math.min(amount, s.stack);
    s.stack -= a;
    s.bet += a;
    s.committed += a;
    if (s.stack === 0) s.allIn = true;
    this.events.push({ type: 'blind', seat: i, amount: a, kind });
  }

  legalActions(i: number): LegalActions | null {
    const h = this.hand;
    const s = this.seats[i];
    if (!h || h.ended || h.toAct !== i || !s) return null;
    const toCall = Math.max(0, h.currentBet - s.bet);
    const maxRaiseTo = s.bet + s.stack;
    const othersCanAct = this.seats.some(
      (o, j) => j !== i && o && o.inHand && !o.folded && !o.allIn,
    );
    const minRaiseTo = Math.min(
      h.currentBet === 0 ? this.config.bigBlind : h.currentBet + h.minRaise,
      maxRaiseTo,
    );
    return {
      canFold: toCall > 0,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount: Math.min(toCall, s.stack),
      canRaise: !s.hasActed && othersCanAct && maxRaiseTo > h.currentBet,
      minRaiseTo,
      maxRaiseTo,
    };
  }

  act(playerId: string, action: PlayerAction): void {
    const h = this.hand;
    if (!h || h.ended) throw new Error('Aucune main en cours');
    const i = this.seatOf(playerId);
    if (i === -1 || h.toAct !== i) throw new Error("Ce n'est pas votre tour");
    const s = this.seats[i]!;
    const legal = this.legalActions(i)!;
    let type = action.type;

    if (type === 'allin') type = legal.canRaise ? 'raise' : 'call';
    if (type === 'call' && !legal.canCall) type = 'check';

    switch (type) {
      case 'fold':
        s.folded = true;
        s.lastAction = 'Parole couchée';
        this.events.push({ type: 'action', seat: i, action: 'fold', amount: 0, allIn: false });
        break;
      case 'check':
        if (!legal.canCheck) throw new Error('Impossible de checker, il faut suivre ou se coucher');
        s.lastAction = 'Check';
        this.events.push({ type: 'action', seat: i, action: 'check', amount: 0, allIn: false });
        break;
      case 'call': {
        const a = legal.callAmount;
        this.putIn(s, a);
        s.lastAction = s.allIn ? 'Tapis' : 'Suit';
        this.events.push({ type: 'action', seat: i, action: 'call', amount: s.bet, allIn: s.allIn });
        break;
      }
      case 'raise': {
        if (!legal.canRaise) throw new Error('Relance impossible');
        let to = action.type === 'allin' ? legal.maxRaiseTo : Math.floor(action.amount ?? 0);
        if (to >= legal.maxRaiseTo) to = legal.maxRaiseTo;
        else if (to < legal.minRaiseTo) throw new Error(`Relance minimum : ${legal.minRaiseTo}`);
        const raiseSize = to - h.currentBet;
        const wasBet = h.currentBet === 0;
        this.putIn(s, to - s.bet);
        if (raiseSize >= h.minRaise) {
          // Relance complète : tout le monde doit reparler.
          h.minRaise = raiseSize;
          for (const o of this.seats) if (o && o !== s) o.hasActed = false;
        }
        h.currentBet = Math.max(h.currentBet, to);
        s.lastAction = s.allIn ? 'Tapis' : wasBet ? 'Mise' : 'Relance';
        this.events.push({ type: 'action', seat: i, action: 'raise', amount: to, allIn: s.allIn, opening: wasBet });
        break;
      }
    }
    s.hasActed = true;
    this.afterAction(i);
  }

  /** Couche un joueur hors de son tour (déconnexion, départ, exclusion). */
  forceFold(i: number): void {
    const h = this.hand;
    const s = this.seats[i];
    if (!h || h.ended || !s || !s.inHand || s.folded) return;
    if (h.toAct === i) {
      this.act(s.playerId, { type: 'fold' });
      return;
    }
    s.folded = true;
    s.lastAction = 'Parole couchée';
    this.events.push({ type: 'action', seat: i, action: 'fold', amount: 0, allIn: false });
    if (this.contenders().length === 1) this.finishUncontested();
    else if (this.bettingComplete()) this.endStreet();
  }

  private putIn(s: Seat, amount: number) {
    const a = Math.min(amount, s.stack);
    s.stack -= a;
    s.bet += a;
    s.committed += a;
    if (s.stack === 0) s.allIn = true;
  }

  private afterAction(i: number): void {
    const h = this.hand!;
    if (this.contenders().length === 1) return this.finishUncontested();
    if (this.bettingComplete()) return this.endStreet();
    h.toAct = this.nextToAct(i);
  }

  private contenders(): number[] {
    return this.seats.flatMap((s, i) => (s && s.inHand && !s.folded ? [i] : []));
  }

  private needsAction(s: Seat): boolean {
    return s.inHand && !s.folded && !s.allIn && (!s.hasActed || s.bet < this.hand!.currentBet);
  }

  private bettingComplete(): boolean {
    const active = this.contenders().map((i) => this.seats[i]!);
    if (active.length <= 1) return true;
    const canAct = active.filter((s) => !s.allIn);
    if (canAct.length === 0) return true;
    const maxBet = Math.max(...active.map((s) => s.bet));
    if (canAct.length === 1 && canAct[0].bet >= maxBet) return true;
    return !active.some((s) => this.needsAction(s));
  }

  private nextToAct(from: number): number | null {
    const n = this.seats.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      const s = this.seats[i];
      if (s && this.needsAction(s)) return i;
    }
    return null;
  }

  private nextSeat(from: number, pred: (s: Seat) => boolean): number {
    const n = this.seats.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + k) % n) + n) % n;
      const s = this.seats[i];
      if (s && pred(s)) return i;
    }
    throw new Error('Aucun siège trouvé');
  }

  /** Rend la part d'une mise que personne n'a pu suivre. */
  private refundUncalled() {
    const inHand = this.seats.flatMap((s, i) => (s && s.inHand ? [i] : []));
    const sorted = inHand.slice().sort((a, b) => this.seats[b]!.bet - this.seats[a]!.bet);
    if (sorted.length < 2) return;
    const top = this.seats[sorted[0]]!;
    const second = this.seats[sorted[1]]!;
    const extra = top.bet - second.bet;
    if (extra > 0) {
      top.bet -= extra;
      top.committed -= extra;
      top.stack += extra;
      if (top.stack > 0) top.allIn = false;
      this.events.push({ type: 'refund', seat: sorted[0], amount: extra });
    }
  }

  private endStreet(): void {
    const h = this.hand!;
    this.refundUncalled();
    if (this.contenders().length === 1) return this.finishUncontested();

    for (const s of this.seats) {
      if (!s) continue;
      s.bet = 0;
      s.hasActed = false;
    }
    h.currentBet = 0;
    h.minRaise = this.config.bigBlind;
    h.toAct = null;

    const next: Record<string, { street: Street; cards: number }> = {
      preflop: { street: 'flop', cards: 3 },
      flop: { street: 'turn', cards: 1 },
      turn: { street: 'river', cards: 1 },
    };
    const step = next[h.street];
    if (!step) return this.showdown();

    h.deck.pop(); // brûlée
    for (let k = 0; k < step.cards; k++) h.board.push(h.deck.pop()!);
    h.street = step.street;
    this.events.push({ type: 'street', street: h.street, board: h.board.slice() });

    if (this.bettingComplete()) {
      h.runout = true;
      return this.endStreet();
    }
    h.toAct = this.nextToAct(h.dealer);
  }

  private finishUncontested(): void {
    const h = this.hand!;
    this.refundUncalled();
    const [winner] = this.contenders();
    const total = this.potTotal();
    this.seats[winner]!.stack += total;
    h.pots = [{ amount: total, eligible: [winner] }];
    h.winners = [{ seat: winner, amount: total, hand: null, cards: [] }];
    this.events.push({ type: 'win', seat: winner, amount: total, hand: null });
    this.closeHand();
  }

  potTotal(): number {
    return this.seats.reduce((sum, s) => sum + (s?.committed ?? 0), 0);
  }

  /** Pot central + pots annexes, d'après ce que chacun a misé. */
  computePots(): Pot[] {
    const contributors = this.seats.flatMap((s, i) => (s && s.committed > 0 ? [i] : []));
    const levels = [...new Set(contributors.map((i) => this.seats[i]!.committed))].sort((a, b) => a - b);
    const pots: Pot[] = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const i of contributors) {
        const c = this.seats[i]!.committed;
        amount += Math.max(0, Math.min(c, level) - prev);
      }
      const eligible = contributors.filter((i) => {
        const s = this.seats[i]!;
        return !s.folded && s.committed >= level;
      });
      if (eligible.length === 0 && pots.length) pots[pots.length - 1].amount += amount;
      else if (pots.length && sameSet(pots[pots.length - 1].eligible, eligible))
        pots[pots.length - 1].amount += amount;
      else pots.push({ amount, eligible });
      prev = level;
    }
    return pots.filter((p) => p.amount > 0);
  }

  private showdown(): void {
    const h = this.hand!;
    h.street = 'showdown';
    h.toAct = null;
    const values = new Map<number, ReturnType<typeof evaluate>>();
    for (const i of this.contenders()) {
      const s = this.seats[i]!;
      const v = evaluate([...s.hole, ...h.board]);
      values.set(i, v);
      s.shown = true;
      this.events.push({ type: 'show', seat: i, cards: s.hole.slice(), hand: v.name });
    }

    h.pots = this.computePots();
    const won = new Map<number, number>();
    for (const pot of h.pots) {
      let best: number[] | null = null;
      let winners: number[] = [];
      for (const i of pot.eligible) {
        const sc = values.get(i)!.score;
        const cmp = best ? compareScores(sc, best) : 1;
        if (cmp > 0) { best = sc; winners = [i]; }
        else if (cmp === 0) winners.push(i);
      }
      // Jetons indivisibles : au premier gagnant à gauche du bouton.
      winners.sort((a, b) => this.distFromDealer(a) - this.distFromDealer(b));
      const share = Math.floor(pot.amount / winners.length);
      let rest = pot.amount - share * winners.length;
      for (const w of winners) {
        const amt = share + (rest > 0 ? 1 : 0);
        if (rest > 0) rest--;
        won.set(w, (won.get(w) ?? 0) + amt);
      }
    }
    h.winners = [...won].map(([seat, amount]) => {
      const v = values.get(seat)!;
      this.seats[seat]!.stack += amount;
      this.events.push({ type: 'win', seat, amount, hand: v.name });
      return { seat, amount, hand: v.name, cards: v.cards };
    });
    this.closeHand();
  }

  private distFromDealer(i: number): number {
    const n = this.seats.length;
    return (((i - this.hand!.dealer - 1) % n) + n) % n;
  }

  private closeHand() {
    const h = this.hand!;
    h.ended = true;
    h.toAct = null;
    for (const s of this.seats) if (s) s.bet = 0;
    this.events.push({ type: 'handEnd', hand: h.number });
  }
}

function sameSet(a: number[], b: number[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
