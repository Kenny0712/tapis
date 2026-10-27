import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientState } from '@tapis/engine';
import { call, identity, navigate, socket } from './net';
import { Table } from './Table';
import { ActionBar } from './ActionBar';
import { Drawer, type Tab } from './Drawer';
import { SeatDialog } from './SeatDialog';
import { Icon } from './icons';

export function Game({ gameId }: { gameId: string }) {
  const [state, setState] = useState<ClientState | null>(null);
  const [fatal, setFatal] = useState('');
  const [toast, setToast] = useState('');
  const [offline, setOffline] = useState(!socket.connected);
  const [drawer, setDrawer] = useState<Tab | null>(null);
  const [seatDialog, setSeatDialog] = useState<number | null>(null);
  const [sound, setSound] = useState(true);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  const seenChat = useRef(0);

  const notify = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? '' : t)), 3500);
  }, []);

  useEffect(() => {
    const join = () => {
      setOffline(false);
      call('join', { ...identity(), gameId }).catch((e: Error) => setFatal(e.message));
    };
    const onState = (s: ClientState) => {
      offset.current = s.serverTime - Date.now();
      setState(s);
    };
    const onDown = () => setOffline(true);
    const onKicked = () => notify('Le propriétaire vous a retiré de la table');
    socket.on('state', onState);
    socket.on('connect', join);
    socket.on('disconnect', onDown);
    socket.on('kicked', onKicked);
    if (socket.connected) join();
    return () => {
      socket.off('state', onState);
      socket.off('connect', join);
      socket.off('disconnect', onDown);
      socket.off('kicked', onKicked);
    };
  }, [gameId, notify]);

  // Horloge alignée sur le serveur, seulement quand un compte à rebours est affiché.
  const ticking = !!(state?.turnDeadline || state?.nextHandAt || state?.level?.endsAt);
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => clearInterval(t);
  }, [ticking]);

  // Petit signal sonore quand c'est à vous.
  const myTurn = !!state?.legal && state.hand?.toAct === state.you.seat;
  useEffect(() => {
    if (myTurn && sound) ping();
    if (myTurn && document.hidden) document.title = '● À vous — Tapis';
    else document.title = 'Tapis';
  }, [myTurn, sound]);

  if (fatal) {
    return (
      <main className="home">
        <div className="panel">
          <h1>Table indisponible</h1>
          <p>{fatal}</p>
          <button className="btn primary" onClick={() => navigate('/')}>Ouvrir une nouvelle table</button>
        </div>
      </main>
    );
  }
  if (!state) return <main className="loading">Connexion à la table…</main>;

  const unread = drawer === 'chat' ? 0 : state.chat.length - seenChat.current;
  if (drawer === 'chat') seenChat.current = state.chat.length;

  const share = async () => {
    const url = `${location.origin}/t/${gameId}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Tapis', text: 'Viens jouer au poker', url });
      else {
        await navigator.clipboard.writeText(url);
        notify('Lien copié');
      }
    } catch {
      prompt('Copiez ce lien :', url);
    }
  };

  return (
    <div className={'game' + (drawer ? ' with-drawer' : '')}>
      <header className="topbar">
        <button className="btn ghost square badge-host" onClick={() => setDrawer(drawer ? null : 'journal')} aria-label="Ouvrir le panneau">
          <Icon name="menu" />
          {state.you.isOwner && state.requests.length > 0 && <span className="badge">{state.requests.length}</span>}
        </button>
        <div className="title">
          <span className="brand sm">Tapis</span>
          <span className="blinds">
            NLH · {state.config.smallBlind}/{state.config.bigBlind}{state.config.ante ? ` · ante ${state.config.ante}` : ''}
            {state.level && <> · niv. {state.level.index + 1}/{state.level.total}{state.level.endsAt && <> · {clock(state.level.endsAt - now)}</>}</>}
          </span>
        </div>
        <div className="top-actions">
          {state.spectators > 0 && <span className="spect" title="Spectateurs"><Icon name="user" size={16} />{state.spectators}</span>}
          <button className="btn ghost square badge-host" onClick={() => setDrawer(drawer === 'chat' ? null : 'chat')} aria-label="Chat">
            <Icon name="chat" />{unread > 0 && <span className="badge">{unread}</span>}
          </button>
          <button className="btn ghost square" onClick={() => setSound(!sound)} aria-label={sound ? 'Couper le son' : 'Activer le son'}>
            <Icon name={sound ? 'sound' : 'mute'} />
          </button>
          <button className="btn ghost square" onClick={share} aria-label="Partager le lien"><Icon name="share" /></button>
          {state.you.isOwner && (
            <button className="btn ghost settings-btn" onClick={() => setDrawer(drawer === 'table' ? null : 'table')} aria-label="Réglages de la table">
              <Icon name="sliders" /><span>Réglages</span>
            </button>
          )}
        </div>
      </header>

      {offline && <div className="offline" role="status">Connexion perdue, reconnexion…</div>}

      {state.you.isOwner && state.requests.length > 0 && drawer !== 'table' && (
        <button className="request-banner" onClick={() => setDrawer('table')}>
          {state.requests.length === 1
            ? `${state.requests[0].name} demande ${state.requests[0].kind === 'place' ? 'une place' : 'une recave'}`
            : `${state.requests.length} demandes en attente`} · Voir
        </button>
      )}

      <main className="stage">
        <Table state={state} now={now} onSit={setSeatDialog} />
        {state.you.isOwner && state.status !== 'en-jeu' && (
          <button className="btn primary start-btn" onClick={() => call('start', {}).catch((e: Error) => notify(e.message))}
            disabled={state.seats.filter((s) => s && s.stack > 0).length < 2}>
            {state.status === 'pause' ? 'Reprendre la partie' : 'Démarrer la partie'}
          </button>
        )}
      </main>

      <ActionBar state={state} onError={notify} />

      {drawer && <Drawer state={state} tab={drawer} setTab={setDrawer} onClose={() => setDrawer(null)} onError={notify} />}
      {seatDialog !== null && <SeatDialog state={state} seat={seatDialog} onClose={() => setSeatDialog(null)} onError={notify} />}
      {toast && <div className="toast" role="alert">{toast}</div>}
    </div>
  );
}

/** « 12:05 » : temps restant avant le prochain niveau. */
function clock(ms: number) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

let audio: AudioContext | null = null;
function ping() {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.25);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.3);
  } catch { /* son indisponible */ }
}
