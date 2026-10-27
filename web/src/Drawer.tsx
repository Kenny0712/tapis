import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ClientState, GameConfig } from '@tapis/engine';
import { call } from './net';
import { Icon } from './icons';

export type Tab = 'journal' | 'ledger' | 'chat' | 'table';
const fmt = (n: number) => n.toLocaleString('fr-FR');
const time = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function Drawer({ state, tab, setTab, onClose, onError }: {
  state: ClientState; tab: Tab; setTab: (t: Tab) => void; onClose: () => void; onError: (m: string) => void;
}) {
  const run = (p: Promise<unknown>) => p.catch((e: Error) => onError(e.message));
  const tabs: [Tab, string][] = [['journal', 'Journal'], ['ledger', 'Ledger'], ['chat', 'Chat']];
  if (state.you.isOwner) tabs.push(['table', `Table${state.requests.length ? ` (${state.requests.length})` : ''}`]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [onClose]);

  return (
    <aside className="drawer" aria-label="Panneau de la table">
      <div className="drawer-head">
        <div className="tabs" role="tablist">
          {tabs.map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={'tab' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
        <button className="btn ghost square" onClick={onClose} aria-label="Fermer le panneau"><Icon name="close" /></button>
      </div>
      <div className="drawer-body">
        {tab === 'journal' && <Journal state={state} />}
        {tab === 'ledger' && <Ledger state={state} />}
        {tab === 'chat' && <Chat state={state} run={run} />}
        {tab === 'table' && state.you.isOwner && <OwnerPanel state={state} run={run} />}
      </div>
    </aside>
  );
}

function Journal({ state }: { state: ClientState }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [state.log.length]);
  return (
    <ol className="log">
      {state.log.map((l, i) => (
        <li key={i} className={l.text.startsWith('—') ? 'sep' : ''}><time>{time(l.at)}</time>{l.text}</li>
      ))}
      <div ref={end} />
    </ol>
  );
}

function Ledger({ state }: { state: ClientState }) {
  if (!state.ledger.length) return <p className="empty">Personne ne s'est encore assis.</p>;
  return (
    <table className="ledger">
      <thead><tr><th>Joueur</th><th>Entrées</th><th>Sorties</th><th>Tapis</th><th>Net</th></tr></thead>
      <tbody>
        {state.ledger.map((l) => (
          <tr key={l.playerId}>
            <td>{l.name}</td><td>{fmt(l.buyIn)}</td><td>{fmt(l.buyOut)}</td><td>{fmt(l.stack)}</td>
            <td className={l.net > 0 ? 'pos' : l.net < 0 ? 'neg' : ''}>{l.net > 0 ? '+' : ''}{fmt(l.net)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Chat({ state, run }: { state: ClientState; run: (p: Promise<unknown>) => void }) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [state.chat.length]);
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    run(call('chat', { text }));
    setText('');
  };
  return (
    <div className="chat">
      <ol className="messages">
        {state.chat.length === 0 && <p className="empty">Pas encore de message.</p>}
        {state.chat.map((m, i) => (
          <li key={i} className={m.playerId === state.you.playerId ? 'mine' : ''}>
            <b>{m.name}</b> {m.text}
          </li>
        ))}
        <div ref={end} />
      </ol>
      <form className="row" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Message" aria-label="Message" />
        <button className="btn primary">Envoyer</button>
      </form>
    </div>
  );
}

function OwnerPanel({ state, run }: { state: ClientState; run: (p: Promise<unknown>) => void }) {
  const [cfg, setCfg] = useState<GameConfig>(state.config);
  useEffect(() => { setCfg(state.config); }, [state.config]);
  const num = (k: keyof GameConfig) => ({
    value: cfg[k] as number,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCfg({ ...cfg, [k]: Number(e.target.value) }),
  });

  return (
    <div className="owner">
      <section>
        <h3>Demandes</h3>
        {state.requests.length === 0 && <p className="empty">Aucune demande en attente.</p>}
        {state.requests.map((r) => (
          <div key={r.id} className="request">
            <span><b>{r.name}</b> {r.kind === 'place' ? `· siège ${r.seat + 1}` : '· recave'} · {fmt(r.stack)}</span>
            <span className="row">
              <button className="btn" onClick={() => run(call('deny', { requestId: r.id }))}>Refuser</button>
              <button className="btn primary" onClick={() => run(call('approve', { requestId: r.id }))}>Accepter</button>
            </span>
          </div>
        ))}
      </section>

      <section>
        <h3>Partie</h3>
        {state.status === 'en-jeu'
          ? <button className="btn" onClick={() => run(call('pause', {}))}><Icon name="pause" /> Pause après cette main</button>
          : <button className="btn primary" onClick={() => run(call('start', {}))}><Icon name="play" /> {state.status === 'pause' ? 'Reprendre' : 'Démarrer'}</button>}
        {state.status === 'en-jeu' && !state.config.autoStart && (!state.hand || state.hand.ended) && (
          <button className="btn primary" onClick={() => run(call('start', {}))}>Distribuer la main suivante</button>
        )}
      </section>

      <form onSubmit={(e) => { e.preventDefault(); run(call('updateConfig', cfg)); }}>
        <h3>Réglages</h3>
        <p className="hint">Les blindes changent à la main suivante.</p>
        <div className="grid2">
          <label className="field"><span>Petite blinde</span><input type="number" min={1} {...num('smallBlind')} /></label>
          <label className="field"><span>Grosse blinde</span><input type="number" min={1} {...num('bigBlind')} /></label>
          <label className="field"><span>Ante</span><input type="number" min={0} {...num('ante')} /></label>
          <label className="field"><span>Temps pour jouer (s, 0 = illimité)</span><input type="number" min={0} max={600} {...num('decisionTime')} /></label>
          <label className="field"><span>Durée de l'abattage (s)</span><input type="number" min={1} max={30} {...num('showdownTime')} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={cfg.autoStart} onChange={(e) => setCfg({ ...cfg, autoStart: e.target.checked })} /> Enchaîner les mains automatiquement</label>
        <label className="check"><input type="checkbox" checked={cfg.allowGuestChat} onChange={(e) => setCfg({ ...cfg, allowGuestChat: e.target.checked })} /> Les spectateurs peuvent écrire dans le chat</label>
        <button className="btn primary">Enregistrer</button>
      </form>

      <section>
        <h3>Joueurs</h3>
        {state.seats.map((s, i) => s && (
          <PlayerRow key={s.playerId} name={s.name} seat={i} stack={s.stack} isMe={s.playerId === state.you.playerId}
            onStack={(v) => run(call('setStack', { playerId: s.playerId, stack: v }))}
            onKick={() => { if (confirm(`Retirer ${s.name} de la table ?`)) run(call('kick', { playerId: s.playerId })); }} />
        ))}
      </section>
    </div>
  );
}

function PlayerRow({ name, seat, stack, isMe, onStack, onKick }: {
  name: string; seat: number; stack: number; isMe: boolean; onStack: (v: number) => void; onKick: () => void;
}) {
  const [v, setV] = useState(stack);
  useEffect(() => { setV(stack); }, [stack]);
  return (
    <div className="request">
      <span><b>{name}</b> · siège {seat + 1}</span>
      <span className="row">
        <input type="number" className="amount" value={v} min={0} onChange={(e) => setV(Number(e.target.value))} aria-label={`Tapis de ${name}`} />
        <button className="btn" disabled={v === stack} onClick={() => onStack(v)}>Ajuster</button>
        {!isMe && <button className="btn danger" onClick={onKick}>Retirer</button>}
      </span>
    </div>
  );
}
