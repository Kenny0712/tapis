import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { DEFAULT_CONFIG, type ClientToServer, type ServerToClient, type Ack } from '@tapis/engine';
import { Game } from './game';

// `--port` (dev) passe avant PORT, que certains outils fixent pour l'interface et non pour ce serveur.
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg !== -1 ? process.argv[portArg + 1] : process.env.PORT) || 3001;
const here = dirname(fileURLToPath(import.meta.url));
const webDist = join(here, '../../web/dist');

const app = express();
const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, { cors: { origin: true }, maxHttpBufferSize: 64_000 });

// Garde-fous pour un serveur ouvert à tous : nombre de tables, créations par adresse, débit par connexion.
const MAX_GAMES = 500;
const CREATIONS_PER_HOUR = 10;
const MAX_EVENTS_PER_5S = 40;
const creations = new Map<string, number[]>();

function clientIp(socket: Socket) {
  const fwd = socket.handshake.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim() || socket.handshake.address;
}

function allowCreation(ip: string) {
  const now = Date.now();
  const recent = (creations.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= CREATIONS_PER_HOUR) return false;
  recent.push(now);
  creations.set(ip, recent);
  return true;
}

type Sock = Socket<ClientToServer, ServerToClient, object, { gameId?: string; playerId?: string }>;

const games = new Map<string, Game>();
const sockets = new Map<string, Set<Sock>>();

function broadcast(game: Game) {
  for (const s of sockets.get(game.id) ?? []) s.emit('state', game.stateFor(s.data.playerId!));
}

function newGameId() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (const b of randomBytes(10)) id += alphabet[b % alphabet.length];
  return id;
}

const validId = (v: unknown) => typeof v === 'string' && /^[\w-]{8,64}$/.test(v);

io.on('connection', (socket: Sock) => {
  let windowStart = Date.now();
  let count = 0;
  socket.use((_packet, next) => {
    if (Date.now() - windowStart > 5000) { windowStart = Date.now(); count = 0; }
    if (++count > MAX_EVENTS_PER_5S) return next(new Error('Trop de messages, ralentissez'));
    next();
  });

  const attach = (game: Game, playerId: string, token: string) => {
    const { gameId: prevGame, playerId: prevPlayer } = socket.data;
    if (prevGame === game.id && prevPlayer === playerId) return broadcast(game);
    if (prevGame && prevPlayer) {
      sockets.get(prevGame)?.delete(socket);
      games.get(prevGame)?.disconnect(prevPlayer);
    }
    game.connect(playerId, token);
    socket.data.gameId = game.id;
    socket.data.playerId = playerId;
    if (!sockets.has(game.id)) sockets.set(game.id, new Set());
    sockets.get(game.id)!.add(socket);
    broadcast(game);
  };

  /** Exécute une commande sur la partie du joueur et répond à l'application. */
  const on = <K extends keyof ClientToServer>(
    event: K,
    run: (game: Game, playerId: string, payload: Parameters<ClientToServer[K]>[0]) => void,
  ) => {
    socket.on(event, ((payload: Parameters<ClientToServer[K]>[0], ack?: Ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const game = socket.data.gameId ? games.get(socket.data.gameId) : undefined;
        if (!game) throw new Error('Table introuvable');
        run(game, socket.data.playerId!, payload ?? ({} as never));
        reply({ ok: true });
      } catch (e) {
        reply({ ok: false, error: (e as Error).message });
      }
    }) as never);
  };

  socket.on('create', (p, ack) => {
    try {
      if (!validId(p?.playerId) || !validId(p?.token)) throw new Error('Identité invalide');
      if (games.size >= MAX_GAMES) throw new Error('Trop de tables ouvertes, réessayez plus tard');
      if (!allowCreation(clientIp(socket))) throw new Error('Trop de tables créées depuis cette connexion, réessayez dans une heure');
      const c = { ...DEFAULT_CONFIG };
      const sb = Math.floor(Number(p.config?.smallBlind)), bb = Math.floor(Number(p.config?.bigBlind));
      if (sb > 0 && bb >= sb) Object.assign(c, { smallBlind: sb, bigBlind: bb });
      const id = newGameId();
      const game = new Game(id, p.playerId, c, broadcast);
      games.set(id, game);
      attach(game, p.playerId, p.token);
      game.players.get(p.playerId)!.name = String(p.name ?? '').trim().slice(0, 18) || 'Hôte';
      ack({ ok: true, gameId: id });
    } catch (e) {
      ack({ ok: false, error: (e as Error).message });
    }
  });

  socket.on('join', (p, ack) => {
    try {
      if (!validId(p?.playerId) || !validId(p?.token)) throw new Error('Identité invalide');
      const game = games.get(String(p.gameId));
      if (!game) throw new Error("Cette table n'existe pas ou a expiré");
      attach(game, p.playerId, p.token);
      ack({ ok: true });
    } catch (e) {
      ack({ ok: false, error: (e as Error).message });
    }
  });

  on('requestSeat', (g, me, p) => g.requestSeat(me, Number(p.seat), p.name, Number(p.stack), !!p.away));
  on('cancelRequest', (g, me) => g.cancelRequest(me));
  on('leaveSeat', (g, me) => g.leaveSeat(me));
  on('setAway', (g, me, p) => g.setAway(me, !!p.away));
  on('rebuy', (g, me, p) => g.rebuy(me, Number(p.amount)));
  on('act', (g, me, p) => g.act(me, p.type, p.amount === undefined ? undefined : Number(p.amount)));
  on('showCards', (g, me) => g.showCards(me));
  on('chat', (g, me, p) => g.sendChat(me, p.text));
  on('approve', (g, me, p) => g.approve(me, p.requestId));
  on('deny', (g, me, p) => g.deny(me, p.requestId));
  on('start', (g, me) => g.start(me));
  on('pause', (g, me) => g.pause(me));
  on('kick', (g, me, p) => {
    g.kick(me, p.playerId);
    for (const s of sockets.get(g.id) ?? []) if (s.data.playerId === p.playerId) s.emit('kicked');
  });
  on('setStack', (g, me, p) => g.setStack(me, p.playerId, Number(p.stack)));
  on('updateConfig', (g, me, p) => g.updateConfig(me, p));

  socket.on('disconnect', () => {
    const { gameId, playerId } = socket.data;
    if (!gameId || !playerId) return;
    sockets.get(gameId)?.delete(socket);
    games.get(gameId)?.disconnect(playerId);
  });
});

// Une table sans personne depuis 12 h est supprimée.
setInterval(() => {
  const limit = Date.now() - 12 * 3600_000;
  for (const [id, g] of games) {
    if (g.connectedCount() === 0 && g.lastActivity < limit) {
      g.dispose();
      games.delete(id);
      sockets.delete(id);
    }
  }
}, 10 * 60_000).unref();

app.get('/api/health', (_req, res) => res.json({ ok: true, games: games.size }));

if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
}

http.listen(PORT, () => console.log(`Tapis : serveur sur http://localhost:${PORT}`));
