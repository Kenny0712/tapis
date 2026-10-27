// Messages échangés entre le serveur et l'application (Socket.IO).
import type { Card } from './cards';
import type { ActionType, LegalActions, Street } from './table';

export interface GameConfig {
  smallBlind: number;
  bigBlind: number;
  ante: number;
  maxSeats: number;
  /** Secondes pour jouer ; 0 = pas de limite. */
  decisionTime: number;
  autoStart: boolean;
  /** Secondes d'affichage de l'abattage avant la main suivante. */
  showdownTime: number;
  allowGuestChat: boolean;
}

export const DEFAULT_CONFIG: GameConfig = {
  smallBlind: 10,
  bigBlind: 20,
  ante: 0,
  maxSeats: 9,
  decisionTime: 30,
  autoStart: true,
  showdownTime: 5,
  allowGuestChat: true,
};

export interface PublicSeat {
  playerId: string;
  name: string;
  stack: number;
  bet: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  away: boolean;
  connected: boolean;
  leaving: boolean;
  lastAction: string | null;
  /** `null` = carte face cachée. */
  cards: (Card | null)[];
  handName: string | null;
  won: number;
}

export interface PublicHand {
  number: number;
  street: Street;
  board: Card[];
  dealer: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  /** Jetons déjà ramassés au centre. */
  pot: number;
  /** Pot + mises devant les joueurs. */
  totalPot: number;
  currentBet: number;
  toAct: number | null;
  ended: boolean;
  runout: boolean;
  winningCards: Card[];
}

export interface SeatRequest {
  id: string;
  playerId: string;
  name: string;
  seat: number;
  stack: number;
  kind: 'place' | 'recave';
}

export interface LedgerRow {
  playerId: string;
  name: string;
  buyIn: number;
  buyOut: number;
  stack: number;
  net: number;
}

export interface LogEntry {
  at: number;
  text: string;
  hand: number | null;
}

export interface ChatMessage {
  at: number;
  playerId: string;
  name: string;
  text: string;
}

export type GameStatus = 'attente' | 'en-jeu' | 'pause';

export interface ClientState {
  gameId: string;
  ownerName: string;
  you: {
    playerId: string;
    isOwner: boolean;
    seat: number | null;
    pendingRequest: SeatRequest | null;
  };
  config: GameConfig;
  status: GameStatus;
  seats: (PublicSeat | null)[];
  hand: PublicHand | null;
  legal: LegalActions | null;
  myHandName: string | null;
  turnDeadline: number | null;
  nextHandAt: number | null;
  requests: SeatRequest[];
  /** Sièges libres mais déjà demandés : réservés jusqu'à la décision du propriétaire. */
  pendingSeats: number[];
  ledger: LedgerRow[];
  log: LogEntry[];
  chat: ChatMessage[];
  spectators: number;
  serverTime: number;
}

export interface Identity {
  playerId: string;
  token: string;
}

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServer {
  create: (p: Identity & { name: string; config: Partial<GameConfig> }, ack: Ack<{ gameId: string }>) => void;
  join: (p: Identity & { gameId: string }, ack: Ack) => void;
  requestSeat: (p: { seat: number; name: string; stack: number; away?: boolean }, ack: Ack) => void;
  cancelRequest: (p: object, ack: Ack) => void;
  leaveSeat: (p: object, ack: Ack) => void;
  setAway: (p: { away: boolean }, ack: Ack) => void;
  rebuy: (p: { amount: number }, ack: Ack) => void;
  act: (p: { type: ActionType; amount?: number }, ack: Ack) => void;
  showCards: (p: object, ack: Ack) => void;
  chat: (p: { text: string }, ack: Ack) => void;
  // Réservé au propriétaire
  approve: (p: { requestId: string }, ack: Ack) => void;
  deny: (p: { requestId: string }, ack: Ack) => void;
  start: (p: object, ack: Ack) => void;
  pause: (p: object, ack: Ack) => void;
  kick: (p: { playerId: string }, ack: Ack) => void;
  setStack: (p: { playerId: string; stack: number }, ack: Ack) => void;
  updateConfig: (p: Partial<GameConfig>, ack: Ack) => void;
}

export interface ServerToClient {
  state: (s: ClientState) => void;
  kicked: () => void;
}
