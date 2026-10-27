import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { BlindLevel, ClientState, GameConfig } from '@tapis/engine';
import { call } from './net';
import { Icon } from './icons';
import { SOURCE_URL } from './source';

export type Tab = 'journal' | 'ledger' | 'chat' | 'table';
const fmt = (n: number) => n.toLocaleString('fr-FR');
const time = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function Drawer({ state, tab, setTab, onClose, onError }: {
  state: ClientState; tab: Tab; setTab: (t: Tab) => void; onClose: () => void; onError: (m: string) => void;
}) {
  const run = (p: Promise<unknown>) => p.catch((e: Error) => onError(e.message));
  const tabs: [Tab, string][] = [['journal', 'Journal'], ['ledger', 'Ledger'], ['chat', 'Chat']];
  if (state.you.isOwner) tabs.push(['table', `Réglages${state.requests.length ? ` (${state.requests.length})` : ''}`]);

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
        {SOURCE_URL && tab !== 'chat' && (
          <p className="free-software">Tapis est un logiciel libre (AGPL-3.0) · <a href={SOURCE_URL} target="_blank" rel="noreferrer">code source</a></p>
        )}
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
  // On ne recopie la config du serveur que lorsqu'elle change vraiment, pour ne pas effacer une saisie en cours.
  const serverJson = JSON.stringify(state.config);
  const lastServer = useRef(serverJson);
  useEffect(() => {
    if (serverJson !== lastServer.current) {
      lastServer.current = serverJson;
      setCfg(state.config);
    }
  }, [serverJson, state.config]);
  const dirty = JSON.stringify(cfg) !== serverJson;
  const set = <K extends keyof GameConfig>(k: K, v: GameConfig[K]) => setCfg({ ...cfg, [k]: v });
  const num = (k: keyof GameConfig, min = 0, max?: number) => ({
    type: 'number', inputMode: 'numeric' as const, min, max,
    value: cfg[k] as number,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never),
  });
  const rising = cfg.blindLevels.length > 0;
  const occupiedMax = state.seats.reduce((m, s, i) => (s ? i + 1 : m), 2);

  const setLevel = (i: number, k: keyof BlindLevel, v: number) =>
    set('blindLevels', cfg.blindLevels.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLevel = () => {
    const last = cfg.blindLevels[cfg.blindLevels.length - 1];
    set('blindLevels', [...cfg.blindLevels, {
      smallBlind: last.smallBlind * 2, bigBlind: last.bigBlind * 2, ante: last.ante * 2, minutes: last.minutes,
    }]);
  };

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
        {state.level && state.level.next && (
          <button className="btn" onClick={() => run(call('nextLevel', {}))}>
            Passer au niveau {state.level.index + 2} ({state.level.next.smallBlind}/{state.level.next.bigBlind})
          </button>
        )}
      </section>

      <form className="settings" onSubmit={(e) => { e.preventDefault(); run(call('updateConfig', cfg)); }}>
        <h3>Blindes</h3>
        <div className="seg wide" role="group" aria-label="Type de blindes">
          <button type="button" className={!rising ? 'on' : ''} aria-pressed={!rising}
            onClick={() => set('blindLevels', [])}>Fixes</button>
          <button type="button" className={rising ? 'on' : ''} aria-pressed={rising}
            onClick={() => !rising && set('blindLevels', defaultLevels(cfg.smallBlind, cfg.bigBlind, cfg.ante))}>Qui montent</button>
        </div>
        {!rising ? (
          <div className="grid3">
            <label className="field"><span>Petite blinde</span><input {...num('smallBlind', 1)} /></label>
            <label className="field"><span>Grosse blinde</span><input {...num('bigBlind', 1)} /></label>
            <label className="field"><span>Ante</span><input {...num('ante', 0)} /></label>
          </div>
        ) : (
          <>
            <p className="hint">Chaque niveau dure le temps indiqué pendant la partie (la pause arrête l'horloge). Le dernier niveau reste jusqu'à la fin.</p>
            <table className="levels">
              <thead><tr><th>Niv.</th><th>PB</th><th>GB</th><th>Ante</th><th>Min</th><th /></tr></thead>
              <tbody>
                {cfg.blindLevels.map((l, i) => (
                  <tr key={i} className={state.level?.index === i ? 'current' : ''}>
                    <td>{i + 1}</td>
                    {(['smallBlind', 'bigBlind', 'ante', 'minutes'] as const).map((k) => (
                      <td key={k}>
                        <input type="number" inputMode="numeric" min={k === 'ante' ? 0 : 1} value={l[k]}
                          aria-label={`Niveau ${i + 1}, ${k === 'smallBlind' ? 'petite blinde' : k === 'bigBlind' ? 'grosse blinde' : k === 'ante' ? 'ante' : 'minutes'}`}
                          onChange={(e) => setLevel(i, k, Number(e.target.value))} />
                      </td>
                    ))}
                    <td>
                      <button type="button" className="btn ghost square" aria-label={`Supprimer le niveau ${i + 1}`}
                        onClick={() => set('blindLevels', cfg.blindLevels.filter((_, j) => j !== i))}>
                        <Icon name="close" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="btn" onClick={addLevel}>Ajouter un niveau</button>
          </>
        )}

        <h3>Table</h3>
        <Setting label="Nombre de sièges" hint={occupiedMax > 2 ? `Au moins ${occupiedMax} tant que le siège ${occupiedMax} est occupé` : undefined}>
          <select value={cfg.maxSeats} onChange={(e) => set('maxSeats', Number(e.target.value))}>
            {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n} disabled={n < occupiedMax}>{n}</option>
            ))}
          </select>
        </Setting>
        <Setting label="Recaves autorisées" hint="Les joueurs peuvent racheter des jetons entre deux mains, avec votre accord.">
          <YesNo value={cfg.allowRebuy} onChange={(v) => set('allowRebuy', v)} />
        </Setting>

        <h3>Temps</h3>
        <Setting label="Temps pour jouer" hint="En secondes. 0 = illimité.">
          <input className="amount" {...num('decisionTime', 0, 600)} />
        </Setting>
        <Setting label="Réserve de temps" hint="Secondes en plus quand le temps est écoulé. 0 = aucune.">
          <input className="amount" {...num('timeBank', 0, 600)} />
        </Setting>
        {cfg.timeBank > 0 && (
          <Setting label="Réserve remplie toutes les" hint="Nombre de mains jouées.">
            <input className="amount" {...num('timeBankHands', 1, 500)} />
          </Setting>
        )}
        <Setting label="Affichage de l'abattage" hint="Secondes avant la main suivante.">
          <div className="seg" role="group">
            {[[3, 'Rapide'], [6, 'Normal'], [9, 'Lent']].map(([v, l]) => (
              <button type="button" key={v} className={cfg.showdownTime === v ? 'on' : ''} aria-pressed={cfg.showdownTime === v}
                onClick={() => set('showdownTime', v as number)}>{l}</button>
            ))}
          </div>
        </Setting>
        <Setting label="Enchaîner les mains" hint="Sinon, vous distribuez chaque main à la main.">
          <YesNo value={cfg.autoStart} onChange={(v) => set('autoStart', v)} />
        </Setting>

        <h3>Règles</h3>
        <Setting label="Straddle UTG (2 GB)" hint="Le joueur après la grosse blinde peut miser 2 GB à l'aveugle et parle en dernier.">
          <YesNo value={cfg.allowStraddle} onChange={(v) => set('allowStraddle', v)} />
        </Setting>
        <Setting label="Rabbit hunting" hint="Montrer les cartes qui seraient sorties quand la main s'arrête avant la river.">
          <YesNo value={cfg.rabbitHunting} onChange={(v) => set('rabbitHunting', v)} />
        </Setting>
        <Setting label="Dévoiler les mains à tapis" hint="Quand plus personne ne peut miser, les cartes sont retournées.">
          <YesNo value={cfg.revealOnAllIn} onChange={(v) => set('revealOnAllIn', v)} />
        </Setting>

        <h3>Social</h3>
        <Setting label="Chat des spectateurs" hint="Les personnes non assises peuvent écrire.">
          <YesNo value={cfg.allowGuestChat} onChange={(v) => set('allowGuestChat', v)} />
        </Setting>

        <div className="save-bar">
          <span className="hint">{dirty ? 'Modifications non enregistrées · blindes appliquées à la main suivante' : 'Réglages à jour'}</span>
          <span className="row">
            {dirty && <button type="button" className="btn" onClick={() => setCfg(state.config)}>Annuler</button>}
            <button className="btn primary" disabled={!dirty}>Enregistrer</button>
          </span>
        </div>
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

/** Structure de départ quand on passe aux blindes qui montent : 8 niveaux de 15 minutes. */
function defaultLevels(sb: number, bb: number, ante: number): BlindLevel[] {
  return [1, 1.5, 2, 3, 4, 6, 8, 10].map((m) => ({
    smallBlind: Math.max(1, Math.round(sb * m)),
    bigBlind: Math.max(1, Math.round(bb * m)),
    ante: Math.round(ante * m),
    minutes: 15,
  }));
}

function Setting({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div>
        <div className="setting-label">{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="seg" role="group">
      <button type="button" className={value ? 'on' : ''} aria-pressed={value} onClick={() => onChange(true)}>Oui</button>
      <button type="button" className={!value ? 'on' : ''} aria-pressed={!value} onClick={() => onChange(false)}>Non</button>
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
