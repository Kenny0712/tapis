import { randomInt, randomUUID } from 'node:crypto';
import {
  PokerTable, evaluate, describePartial,
  type Card, type ActionType, type ClientState, type ChatMessage, type GameConfig,
  type GameStatus, type LedgerRow, type LogEntry, type PublicSeat, type SeatRequest,
  type EngineEvent,
} from '@tapis/engine';

interface Player {
  name: string;
  token: string;
  connections: number;
}

const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const pretty = (c: Card) => (c[0] === 'T' ? '10' : c[0]) + SUIT[c[1]];
const prettyAll = (cs: Card[]) => cs.map(pretty).join(' ');

const MAX_LOG = 300;
const MAX_CHAT = 100;

export class Game {
  readonly table: PokerTable;
  status: GameStatus = 'attente';
  players = new Map<string, Player>();
  requests: SeatRequest[] = [];
  ledger = new Map<string, { name: string; buyIn: number; buyOut: number }>();
  log: LogEntry[] = [];
  chat: ChatMessage[] = [];
  /** Joueurs qui quittent la table à la fin de la main. */
  leaving = new Set<string>();
  turnDeadline: number | null = null;
  nextHandAt: number | null = null;
  lastActivity = Date.now();

  private turnTimer: NodeJS.Timeout | null = null;
  private turnKey = '';
  private actionSeq = 0;
  private nextTimer: NodeJS.Timeout | null = null;
  private closedHand = 0;

  constructor(
    readonly id: string,
    readonly ownerId: string,
    public config: GameConfig,
    private onChange: (g: Game) => void,
  ) {
    this.table = new PokerTable(
      { maxSeats: config.maxSeats, smallBlind: config.smallBlind, bigBlind: config.bigBlind, ante: config.ante },
      (n) => randomInt(n),
    );
  }

  // ---------- Identité ----------

  connect(playerId: string, token: string): void {
    const p = this.players.get(playerId);
    if (p && p.token !== token) throw new Error('Identité refusée');
    if (!p && this.players.size >= 200) throw new Error('Cette table a atteint le nombre maximum de visiteurs');
    if (p) p.connections++;
    else this.players.set(playerId, { name: '', token, connections: 1 });
    this.changed();
  }

  disconnect(playerId: string): void {
    const p = this.players.get(playerId);
    if (p) p.connections = Math.max(0, p.connections - 1);
    this.changed();
  }

  private nameOf(playerId: string) {
    return this.players.get(playerId)?.name || this.ledger.get(playerId)?.name || 'Invité';
  }

  private seatName(i: number) {
    return this.table.seats[i]?.name ?? '?';
  }

  isOwner(playerId: string) {
    return playerId === this.ownerId;
  }

  private requireOwner(playerId: string) {
    if (!this.isOwner(playerId)) throw new Error('Réservé au propriétaire de la table');
  }

  // ---------- Places ----------

  requestSeat(playerId: string, seat: number, rawName: string, stack: number, away = false): void {
    const name = cleanName(rawName);
    stack = cleanAmount(stack);
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.config.maxSeats) throw new Error('Siège inexistant');
    if (this.table.seats[seat]) throw new Error('Ce siège est déjà pris');
    if (this.table.seatOf(playerId) !== -1) throw new Error('Vous êtes déjà assis');
    if (this.requests.some((r) => r.kind === 'place' && r.seat === seat && r.playerId !== playerId))
      throw new Error('Ce siège est déjà demandé, choisissez-en un autre');
    this.requests = this.requests.filter((r) => r.playerId !== playerId);
    const req: SeatRequest = { id: randomUUID(), playerId, name, seat, stack, kind: 'place' };
    this.players.get(playerId)!.name = name;
    if (this.isOwner(playerId)) {
      this.seatPlayer(req, away);
    } else {
      this.requests.push(req);
      this.addLog(`${name} demande le siège ${seat + 1} avec ${stack}`);
    }
    this.pendingAway.set(playerId, away);
    this.changed();
  }

  private pendingAway = new Map<string, boolean>();

  cancelRequest(playerId: string): void {
    this.requests = this.requests.filter((r) => r.playerId !== playerId);
    this.changed();
  }

  approve(ownerId: string, requestId: string): void {
    this.requireOwner(ownerId);
    const req = this.requests.find((r) => r.id === requestId);
    if (!req) throw new Error('Demande introuvable');
    // La demande ne disparaît qu'une fois appliquée : en cas d'échec le propriétaire la voit encore.
    if (req.kind === 'place') this.seatPlayer(req, this.pendingAway.get(req.playerId) ?? false);
    else this.applyRebuy(req.playerId, req.stack);
    this.requests = this.requests.filter((r) => r !== req);
    this.changed();
  }

  deny(ownerId: string, requestId: string): void {
    this.requireOwner(ownerId);
    const req = this.requests.find((r) => r.id === requestId);
    this.requests = this.requests.filter((r) => r.id !== requestId);
    if (req) this.addLog(`Demande de ${req.name} refusée`);
    this.changed();
  }

  private seatPlayer(req: SeatRequest, away: boolean) {
    if (this.table.seats[req.seat]) throw new Error('Ce siège vient d’être pris');
    if (this.table.seatOf(req.playerId) !== -1) throw new Error('Déjà assis');
    this.table.sit(req.seat, req.playerId, req.name, req.stack);
    this.table.seats[req.seat]!.sittingOut = away;
    const l = this.ledger.get(req.playerId) ?? { name: req.name, buyIn: 0, buyOut: 0 };
    l.name = req.name;
    l.buyIn += req.stack;
    this.ledger.set(req.playerId, l);
    this.addLog(`${req.name} s'assoit au siège ${req.seat + 1} avec ${req.stack}`);
    this.leaving.delete(req.playerId);
  }

  leaveSeat(playerId: string): void {
    const i = this.table.seatOf(playerId);
    if (i === -1) throw new Error("Vous n'êtes pas assis");
    this.removeFromSeat(i, 'quitte la table');
    this.changed();
  }

  kick(ownerId: string, playerId: string): void {
    this.requireOwner(ownerId);
    if (playerId === ownerId) throw new Error('Vous ne pouvez pas vous exclure');
    this.requests = this.requests.filter((r) => r.playerId !== playerId);
    const i = this.table.seatOf(playerId);
    if (i !== -1) this.removeFromSeat(i, 'est retiré de la table');
    this.changed();
  }

  private removeFromSeat(i: number, why: string) {
    const s = this.table.seats[i]!;
    const freed = this.table.stand(i);
    this.consumeEvents();
    if (freed) {
      this.cashOut(s.playerId, s.stack);
      this.addLog(`${s.name} ${why} avec ${s.stack}`);
    } else {
      this.leaving.add(s.playerId);
      this.addLog(`${s.name} ${why} à la fin de la main`);
    }
  }

  private cashOut(playerId: string, stack: number) {
    const l = this.ledger.get(playerId);
    if (l) l.buyOut += stack;
  }

  setAway(playerId: string, away: boolean): void {
    const i = this.table.seatOf(playerId);
    if (i === -1) throw new Error("Vous n'êtes pas assis");
    const s = this.table.seats[i]!;
    s.sittingOut = away;
    this.addLog(away ? `${s.name} s'absente` : `${s.name} est de retour`);
    // S'absenter pendant son tour : on joue à sa place (check ou parole couchée).
    if (away && this.table.hand?.toAct === i) this.autoPlay(i);
    this.changed();
  }

  rebuy(playerId: string, amount: number): void {
    amount = cleanAmount(amount);
    const i = this.table.seatOf(playerId);
    if (i === -1) throw new Error("Vous n'êtes pas assis");
    const req: SeatRequest = { id: randomUUID(), playerId, name: this.seatName(i), seat: i, stack: amount, kind: 'recave' };
    if (this.isOwner(playerId)) this.applyRebuy(playerId, amount);
    else {
      this.requests = this.requests.filter((r) => !(r.playerId === playerId && r.kind === 'recave'));
      this.requests.push(req);
      this.addLog(`${req.name} demande une recave de ${amount}`);
    }
    this.changed();
  }

  private applyRebuy(playerId: string, amount: number) {
    const i = this.table.seatOf(playerId);
    if (i === -1) return;
    const s = this.table.seats[i]!;
    if (this.table.inProgress && s.inHand) throw new Error('Recave possible entre deux mains seulement');
    s.stack += amount;
    this.ledger.get(playerId)!.buyIn += amount;
    this.addLog(`${s.name} recave de ${amount}`);
  }

  setStack(ownerId: string, playerId: string, stack: number): void {
    this.requireOwner(ownerId);
    stack = Math.max(0, Math.floor(Number(stack) || 0));
    const i = this.table.seatOf(playerId);
    if (i === -1) throw new Error("Ce joueur n'est pas assis");
    const s = this.table.seats[i]!;
    if (this.table.inProgress && s.inHand) throw new Error('Modifiable entre deux mains seulement');
    this.ledger.get(playerId)!.buyIn += stack - s.stack;
    this.addLog(`Le tapis de ${s.name} passe de ${s.stack} à ${stack}`);
    s.stack = stack;
    this.changed();
  }

  // ---------- Partie ----------

  start(ownerId: string): void {
    this.requireOwner(ownerId);
    if (this.status !== 'en-jeu') this.addLog('La partie commence');
    this.status = 'en-jeu';
    this.dealIfPossible();
    this.changed();
  }

  pause(ownerId: string): void {
    this.requireOwner(ownerId);
    this.status = 'pause';
    this.clearNext();
    this.addLog('Partie en pause après cette main');
    this.changed();
  }

  updateConfig(ownerId: string, patch: Partial<GameConfig>): void {
    this.requireOwner(ownerId);
    const c = { ...this.config };
    const int = (v: unknown, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number(v))));
    if (patch.smallBlind !== undefined) c.smallBlind = int(patch.smallBlind, 1, 1e9);
    if (patch.bigBlind !== undefined) c.bigBlind = int(patch.bigBlind, 1, 1e9);
    if (patch.ante !== undefined) c.ante = int(patch.ante, 0, 1e9);
    if (patch.decisionTime !== undefined) c.decisionTime = int(patch.decisionTime, 0, 600);
    if (patch.showdownTime !== undefined) c.showdownTime = int(patch.showdownTime, 1, 30);
    if (patch.autoStart !== undefined) c.autoStart = !!patch.autoStart;
    if (patch.allowGuestChat !== undefined) c.allowGuestChat = !!patch.allowGuestChat;
    if (c.bigBlind < c.smallBlind) throw new Error('La grosse blinde doit être ≥ la petite');
    this.config = c;
    // Les blindes changent à partir de la main suivante.
    Object.assign(this.table.config, { smallBlind: c.smallBlind, bigBlind: c.bigBlind, ante: c.ante });
    this.addLog(`Réglages : blindes ${c.smallBlind}/${c.bigBlind}${c.ante ? `, ante ${c.ante}` : ''}`);
    this.changed();
  }

  act(playerId: string, type: ActionType, amount?: number): void {
    this.table.act(playerId, { type, amount });
    this.actionSeq++;
    this.changed();
  }

  showCards(playerId: string): void {
    const h = this.table.hand;
    const i = this.table.seatOf(playerId);
    if (!h || !h.ended || i === -1 || !this.table.seats[i]!.inHand) throw new Error('Rien à montrer');
    const s = this.table.seats[i]!;
    s.shown = true;
    this.addLog(`${s.name} montre ${prettyAll(s.hole)}`);
    this.changed();
  }

  sendChat(playerId: string, text: string): void {
    text = String(text ?? '').trim().slice(0, 300);
    if (!text) return;
    const seated = this.table.seatOf(playerId) !== -1;
    if (!seated && !this.isOwner(playerId) && !this.config.allowGuestChat) throw new Error('Chat réservé aux joueurs assis');
    this.chat.push({ at: Date.now(), playerId, name: this.nameOf(playerId), text });
    if (this.chat.length > MAX_CHAT) this.chat.shift();
    this.changed();
  }

  // ---------- Cycle de jeu ----------

  private dealIfPossible() {
    if (this.status !== 'en-jeu' || this.table.inProgress || this.nextTimer) return;
    if (this.table.readySeats().length < 2) return;
    this.table.startHand();
    this.actionSeq++;
  }

  private clearNext() {
    if (this.nextTimer) clearTimeout(this.nextTimer);
    this.nextTimer = null;
    this.nextHandAt = null;
  }

  private onHandEnd() {
    const h = this.table.hand!;
    this.closedHand = h.number;
    for (const playerId of this.leaving) {
      const i = this.table.seatOf(playerId);
      if (i === -1) continue;
      this.cashOut(playerId, this.table.seats[i]!.stack);
      this.table.seats[i] = null;
    }
    this.leaving.clear();
    if (this.status === 'en-jeu' && this.config.autoStart) {
      const delay = h.winners.some((w) => w.hand) ? this.config.showdownTime * 1000 : 2000;
      this.clearNext();
      this.nextHandAt = Date.now() + delay;
      this.nextTimer = setTimeout(() => {
        this.nextTimer = null;
        this.nextHandAt = null;
        this.dealIfPossible();
        this.changed();
      }, delay);
    }
  }

  private scheduleTurn() {
    const h = this.table.hand;
    const toAct = h && !h.ended ? h.toAct : null;
    const key = toAct === null ? '' : `${h!.number}-${this.actionSeq}-${toAct}`;
    if (key === this.turnKey) return;
    this.turnKey = key;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnDeadline = null;
    if (toAct === null) return;
    const s = this.table.seats[toAct]!;
    if (s.sittingOut) {
      // Joueur absent mais encore dans la main : on joue pour lui sans attendre.
      setTimeout(() => this.timeout(key, toAct), 600);
      return;
    }
    if (this.config.decisionTime > 0) {
      this.turnDeadline = Date.now() + this.config.decisionTime * 1000;
      this.turnTimer = setTimeout(() => this.timeout(key, toAct), this.config.decisionTime * 1000);
    }
  }

  private timeout(key: string, seat: number) {
    if (key !== this.turnKey) return;
    const s = this.table.seats[seat];
    if (!s) return;
    if (!s.sittingOut) {
      s.sittingOut = true;
      this.addLog(`${s.name} n'a pas joué à temps et passe absent`);
    }
    this.autoPlay(seat);
    this.changed();
  }

  private autoPlay(seat: number) {
    const legal = this.table.legalActions(seat);
    if (!legal) return;
    const id = this.table.seats[seat]!.playerId;
    this.table.act(id, { type: legal.canCheck ? 'check' : 'fold' });
    this.actionSeq++;
  }

  /** À appeler après chaque changement : journal, fin de main, minuteurs, diffusion. */
  private changed() {
    this.consumeEvents();
    const h = this.table.hand;
    if (h?.ended && h.number !== this.closedHand) this.onHandEnd();
    this.dealIfPossible();
    this.consumeEvents();
    this.scheduleTurn();
    this.lastActivity = Date.now();
    this.onChange(this);
  }

  private consumeEvents() {
    for (const e of this.table.drainEvents()) {
      const t = this.describe(e);
      if (t) this.addLog(t);
    }
  }

  private describe(e: EngineEvent): string | null {
    const n = (i: number) => this.seatName(i);
    switch (e.type) {
      case 'handStart': return `— Main n°${e.hand} · bouton : ${n(e.dealer)} —`;
      case 'blind':
        return e.kind === 'ante' ? null : `${n(e.seat)} paie la ${e.kind} blinde (${e.amount})`;
      case 'action':
        switch (e.action) {
          case 'fold': return `${n(e.seat)} se couche`;
          case 'check': return `${n(e.seat)} checke`;
          case 'call': return e.allIn ? `${n(e.seat)} suit et fait tapis (${e.amount})` : `${n(e.seat)} suit ${e.amount}`;
          default:
            if (e.allIn) return `${n(e.seat)} fait tapis à ${e.amount}`;
            return e.opening ? `${n(e.seat)} mise ${e.amount}` : `${n(e.seat)} relance à ${e.amount}`;
        }
      case 'street': {
        const label = { flop: 'Flop', turn: 'Turn', river: 'River' }[e.street as 'flop'] ?? e.street;
        return `${label} : ${prettyAll(e.board)}`;
      }
      case 'refund': return `${e.amount} rendus à ${n(e.seat)} (mise non suivie)`;
      case 'show': return `${n(e.seat)} montre ${prettyAll(e.cards)} · ${e.hand}`;
      case 'win': return `${n(e.seat)} remporte ${e.amount}${e.hand ? ` avec ${e.hand}` : ''}`;
      case 'handEnd': return null;
    }
  }

  private addLog(text: string) {
    this.log.push({ at: Date.now(), text, hand: this.table.hand?.number ?? null });
    if (this.log.length > MAX_LOG) this.log.shift();
  }

  // ---------- Vue d'un joueur ----------

  stateFor(playerId: string): ClientState {
    const t = this.table;
    const h = t.hand;
    const mySeat = t.seatOf(playerId);
    const won = new Map(h?.ended ? h.winners.map((w) => [w.seat, w.amount]) : []);

    const seats = t.seats.map((s, i): PublicSeat | null => {
      if (!s) return null;
      const visible = s.playerId === playerId || s.shown || (!!h?.runout && s.inHand && !s.folded);
      const cards = !s.inHand || s.hole.length === 0 || (s.folded && s.playerId !== playerId)
        ? []
        : s.hole.map((c) => (visible ? c : null));
      let handName: string | null = null;
      if (visible && s.inHand && !s.folded && h && s.hole.length && s.playerId !== playerId) {
        handName = h.board.length >= 3 ? evaluate([...s.hole, ...h.board]).name : describePartial(s.hole);
      }
      const p = this.players.get(s.playerId);
      return {
        playerId: s.playerId,
        name: s.name,
        stack: s.stack,
        bet: s.bet,
        inHand: s.inHand,
        folded: s.folded,
        allIn: s.allIn,
        away: s.sittingOut,
        connected: (p?.connections ?? 0) > 0,
        leaving: this.leaving.has(s.playerId),
        lastAction: s.lastAction,
        cards,
        handName,
        won: won.get(i) ?? 0,
      };
    });

    let myHandName: string | null = null;
    const me = mySeat === -1 ? null : t.seats[mySeat]!;
    if (me && h && me.inHand && me.hole.length) {
      myHandName = h.board.length >= 3 ? evaluate([...me.hole, ...h.board]).name : describePartial(me.hole);
    }

    const bets = t.seats.reduce((a, s) => a + (s?.bet ?? 0), 0);
    const ledger: LedgerRow[] = [...this.ledger].map(([id, l]) => {
      const i = t.seatOf(id);
      const stack = i === -1 ? 0 : t.seats[i]!.stack;
      return { playerId: id, name: l.name, buyIn: l.buyIn, buyOut: l.buyOut, stack, net: stack + l.buyOut - l.buyIn };
    });

    const spectators = [...this.players].filter(([id, p]) => p.connections > 0 && t.seatOf(id) === -1).length;

    return {
      gameId: this.id,
      ownerName: this.nameOf(this.ownerId),
      you: {
        playerId,
        isOwner: this.isOwner(playerId),
        seat: mySeat === -1 ? null : mySeat,
        pendingRequest: this.requests.find((r) => r.playerId === playerId) ?? null,
      },
      config: this.config,
      status: this.status,
      seats,
      hand: h && {
        number: h.number,
        street: h.street,
        board: h.board,
        dealer: h.dealer,
        smallBlindSeat: h.smallBlindSeat,
        bigBlindSeat: h.bigBlindSeat,
        pot: h.ended ? 0 : t.potTotal() - bets,
        totalPot: h.ended ? h.winners.reduce((a, w) => a + w.amount, 0) : t.potTotal(),
        currentBet: h.currentBet,
        toAct: h.toAct,
        ended: h.ended,
        runout: h.runout,
        winningCards: h.ended ? h.winners.flatMap((w) => w.cards) : [],
      },
      legal: mySeat === -1 ? null : t.legalActions(mySeat),
      myHandName,
      turnDeadline: this.turnDeadline,
      nextHandAt: this.nextHandAt,
      requests: this.isOwner(playerId) ? this.requests : [],
      pendingSeats: this.requests.filter((r) => r.kind === 'place').map((r) => r.seat),
      ledger,
      log: this.log.slice(-150),
      chat: this.chat,
      spectators,
      serverTime: Date.now(),
    };
  }

  connectedCount() {
    return [...this.players.values()].reduce((a, p) => a + p.connections, 0);
  }

  dispose() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.clearNext();
  }
}

function cleanName(name: string) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 18);
  if (!n) throw new Error('Choisissez un pseudo');
  return n;
}

function cleanAmount(v: number) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) throw new Error('Montant invalide');
  return n;
}
