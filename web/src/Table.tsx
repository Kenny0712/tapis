import { useState } from 'react';
import type { Card, ClientState, PublicSeat } from '@tapis/engine';

const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_NAME: Record<string, string> = { s: 'pique', h: 'cœur', d: 'carreau', c: 'trèfle' };
const RANK_NAME: Record<string, string> = { T: '10', J: 'valet', Q: 'dame', K: 'roi', A: 'as' };

export function CardView({ card, size = 'md', highlight, dim }: {
  card: Card | null; size?: 'sm' | 'md' | 'lg'; highlight?: boolean; dim?: boolean;
}) {
  if (!card) return <div className={`card back ${size}`} aria-label="Carte cachée" />;
  const r = card[0], s = card[1];
  return (
    <div className={`card ${size} suit-${s}${highlight ? ' hl' : ''}${dim ? ' dim' : ''}`}
      aria-label={`${RANK_NAME[r] ?? r} de ${SUIT_NAME[s]}`}>
      <span className="index"><span className="rank">{r}</span><span className="suit">{SUIT_SYMBOL[s]}</span></span>
      <span className="pip" aria-hidden="true">{SUIT_SYMBOL[s]}</span>
    </div>
  );
}

/** Position d'un siège autour de la table, en % du conteneur. `k` = 0 pour le joueur, en bas. */
function seatPos(k: number, n: number, rx: number, ry: number, keepInside = false) {
  const a = Math.PI / 2 + (k * 2 * Math.PI) / n;
  const x = `${50 + rx * Math.cos(a)}%`, y = `${50 + ry * Math.sin(a)}%`;
  // Sur téléphone, les sièges des côtés sortiraient de l'écran : on les retient au bord.
  return keepInside
    ? { left: `clamp(var(--seat-half), ${x}, calc(100% - var(--seat-half)))`, top: `clamp(var(--seat-halfh), ${y}, calc(100% - var(--seat-halfh)))` }
    : { left: x, top: y };
}

const fmt = (n: number) => n.toLocaleString('fr-FR');

export function Table({ state, now, onSit }: {
  state: ClientState; now: number; onSit: (seat: number) => void;
}) {
  const n = state.config.maxSeats;
  const base = state.you.seat ?? state.you.pendingRequest?.seat ?? 0;
  const h = state.hand;
  const canSit = state.you.seat === null && !state.you.pendingRequest;
  const winning = new Set(h?.winningCards ?? []);

  return (
    <div className="table-wrap">
      <div className="felt">
        <div className="felt-inner">
          {h && (h.totalPot > 0 || h.ended) && (
            <div className="pot" aria-live="polite">
              {h.ended ? 'Pot remporté' : 'Pot'} <strong>{fmt(h.ended ? h.totalPot : h.pot || h.totalPot)}</strong>
            </div>
          )}
          <div className="board" aria-label="Cartes communes">
            {[0, 1, 2, 3, 4].map((i) =>
              h?.board[i] ? (
                <CardView key={h.number + '-' + i} card={h.board[i]} size="md"
                  highlight={h.ended && winning.has(h.board[i])} dim={h.ended && winning.size > 0 && !winning.has(h.board[i])} />
              ) : h?.rabbit[i - h.board.length] ? (
                <div key={'r' + h.number + '-' + i} className="rabbit" title="Rabbit hunting : carte qui serait sortie">
                  <CardView card={h.rabbit[i - h.board.length]} size="md" />
                </div>
              ) : (
                <div key={i} className="card slot md" aria-hidden="true" />
              ),
            )}
          </div>
          <CenterMessage state={state} now={now} />
        </div>
      </div>

      {Array.from({ length: n }, (_, i) => {
        const k = (i - base + n) % n;
        const seat = state.seats[i];
        const pos = seatPos(k, n, 46, 44, true);
        const betPos = seatPos(k, n, 29, 26);
        const isYou = i === state.you.seat;
        return (
          <div key={i}>
            <div className={'seat-slot' + (k === 0 ? ' hero' : '')} style={pos}>
              {seat ? (
                <SeatView seat={seat} index={i} state={state} isYou={isYou} now={now} winning={winning} />
              ) : (
                <button className="seat-empty" disabled={!canSit || state.pendingSeats.includes(i)} onClick={() => onSit(i)}
                  aria-label={`S'asseoir au siège ${i + 1}`}>
                  {state.you.pendingRequest?.seat === i ? 'En attente…'
                    : state.pendingSeats.includes(i) ? 'Réservé'
                    : canSit ? "S'asseoir" : ''}
                </button>
              )}
            </div>
            {seat && seat.bet > 0 && (
              <div className="bet" style={betPos}><span className="chip-dot" aria-hidden="true" />{fmt(seat.bet)}</div>
            )}
            {h && h.dealer === i && <div className="dealer" style={seatPos(k + 0.42, n, 33, 31)} aria-label="Bouton donneur">D</div>}
          </div>
        );
      })}
    </div>
  );
}

function SeatView({ seat, index, state, isYou, now, winning }: {
  seat: PublicSeat; index: number; state: ClientState; isYou: boolean; now: number; winning: Set<Card>;
}) {
  const h = state.hand;
  const acting = h && !h.ended && h.toAct === index;
  const deadline = acting && state.turnDeadline ? state.turnDeadline : null;
  const total = state.turnDuration;
  const left = deadline ? Math.max(0, deadline - now) : 0;
  const status = seat.won > 0 ? `+${fmt(seat.won)}`
    : seat.leaving ? 'Part'
    : seat.away ? 'Absent'
    : !seat.connected ? 'Déconnecté'
    : acting && state.inTimeBank ? `Réserve ${Math.ceil(left / 1000)} s`
    : seat.allIn ? 'Tapis'
    : seat.folded ? 'Couché'
    : seat.lastAction ?? (seat.straddle ? 'Straddle' : null);

  return (
    <div className={['seat', isYou && 'you', acting && 'acting', seat.folded && 'folded', seat.won > 0 && 'winner', (seat.away || !seat.connected) && 'idle']
      .filter(Boolean).join(' ')}>
      {seat.cards.length > 0 && (
        <div className="hole">
          {seat.cards.map((c, j) => (
            <CardView key={j} card={c} size={isYou ? 'lg' : 'sm'}
              highlight={!!c && !!h?.ended && winning.has(c)} />
          ))}
        </div>
      )}
      <div className="plate">
        <div className="name">{seat.name}</div>
        <div className="stack">{fmt(seat.stack)}</div>
        {status && <div className={'tag' + (seat.won > 0 ? ' win' : '')}>{status}</div>}
        {seat.handName && !isYou && <div className="handname">{seat.handName}</div>}
        {deadline && total > 0 && <TurnTimer key={deadline} left={left} total={total} bank={state.inTimeBank} />}
      </div>
    </div>
  );
}

/** Barre de temps : figée au montage puis animée en CSS, pour ne pas sauter à chaque rendu. */
function TurnTimer({ left, total, bank }: { left: number; total: number; bank: boolean }) {
  const [start] = useState({ left, total });
  return (
    <div className={'timer' + (bank ? ' bank' : '')} aria-hidden="true">
      <i style={{ animationDuration: `${start.left}ms`, width: `${(start.left / start.total) * 100}%` }} />
    </div>
  );
}

function CenterMessage({ state, now }: { state: ClientState; now: number }) {
  const ready = state.seats.filter((s) => s && !s.away && s.stack > 0).length;
  const h = state.hand;
  let text = '';
  if (state.status === 'attente') {
    text = state.you.isOwner
      ? ready < 2 ? 'Partagez le lien : il faut deux joueurs assis.' : 'Tout est prêt. Lancez la partie.'
      : `En attente du lancement par ${state.ownerName}`;
  } else if (state.status === 'pause' && (!h || h.ended)) text = 'Partie en pause';
  else if ((!h || h.ended) && ready < 2) text = 'En attente de joueurs…';
  else if (h?.ended && state.nextHandAt) text = `Main suivante dans ${Math.max(0, Math.ceil((state.nextHandAt - now) / 1000))} s`;
  return text ? <p className="center-msg">{text}</p> : null;
}
