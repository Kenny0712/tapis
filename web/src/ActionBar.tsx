import { useEffect, useState } from 'react';
import type { ClientState } from '@tapis/engine';
import { call } from './net';
import { Icon } from './icons';

const fmt = (n: number) => n.toLocaleString('fr-FR');

export function ActionBar({ state, onError }: { state: ClientState; onError: (m: string) => void }) {
  const run = (p: Promise<unknown>) => p.catch((e: Error) => onError(e.message));
  const { you, legal, hand } = state;
  const seat = you.seat === null ? null : state.seats[you.seat];

  if (!seat) {
    return (
      <div className="actionbar idle-bar">
        {you.pendingRequest ? (
          <>
            <p>Demande envoyée : {state.ownerName} doit valider votre place.</p>
            <button className="btn" onClick={() => run(call('cancelRequest', {}))}>Annuler</button>
          </>
        ) : (
          <p>Vous regardez la partie. Touchez un siège libre pour vous asseoir.</p>
        )}
      </div>
    );
  }

  if (legal && hand && hand.toAct === you.seat) return <TurnControls state={state} run={run} />;

  return <SeatedControls state={state} run={run} />;
}

function TurnControls({ state, run }: { state: ClientState; run: (p: Promise<unknown>) => void }) {
  const legal = state.legal!;
  const hand = state.hand!;
  const me = state.seats[state.you.seat!]!;
  const [raising, setRaising] = useState(false);
  const [amount, setAmount] = useState(legal.minRaiseTo);

  useEffect(() => { setRaising(false); setAmount(legal.minRaiseTo); }, [legal.minRaiseTo, hand.number, hand.street]);

  const act = (type: 'fold' | 'check' | 'call' | 'raise' | 'allin', to?: number) =>
    run(call('act', { type, amount: to }));

  const clamp = (v: number) => Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(v)));
  const potAfterCall = hand.totalPot + (hand.currentBet - me.bet);
  const sized = (f: number) => clamp(hand.currentBet + f * potAfterCall);
  const raiseWord = hand.currentBet === 0 ? 'Miser' : 'Relancer';

  // Raccourcis clavier sur ordinateur : F se coucher, C checker/suivre, R relancer.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'f' && legal.canFold) act('fold');
      else if (k === 'c') act(legal.canCheck ? 'check' : 'call');
      else if (k === 'r' && legal.canRaise) setRaising(true);
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });

  if (raising) {
    const presets: [string, number][] = [
      ['Min', legal.minRaiseTo], ['½ pot', sized(0.5)], ['¾ pot', sized(0.75)], ['Pot', sized(1)], ['Tapis', legal.maxRaiseTo],
    ];
    return (
      <div className="actionbar turn raising">
        <div className="presets">
          {presets.map(([label, v]) => (
            <button key={label} className={'chip' + (v === amount ? ' on' : '')} onClick={() => setAmount(v)}>{label}</button>
          ))}
        </div>
        <div className="slider-row">
          <input type="range" min={legal.minRaiseTo} max={legal.maxRaiseTo} step={1} value={amount}
            onChange={(e) => setAmount(Number(e.target.value))} aria-label="Montant" />
          <input type="number" inputMode="numeric" className="amount" value={amount} min={legal.minRaiseTo} max={legal.maxRaiseTo}
            onChange={(e) => setAmount(Number(e.target.value))} onBlur={() => setAmount(clamp(amount))} aria-label="Montant exact" />
        </div>
        <div className="buttons">
          <button className="btn" onClick={() => setRaising(false)}>Retour</button>
          <button className="btn primary" onClick={() => act('raise', clamp(amount))}>
            {clamp(amount) === legal.maxRaiseTo ? `Tapis ${fmt(legal.maxRaiseTo)}` : `${raiseWord} à ${fmt(clamp(amount))}`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="actionbar turn">
      <div className="your-turn">
        À vous{state.myHandName && <> · <span>{state.myHandName}</span></>}
      </div>
      <div className="buttons three">
        <button className="btn danger" disabled={!legal.canFold} onClick={() => act('fold')}>Se coucher</button>
        {legal.canCheck ? (
          <button className="btn" onClick={() => act('check')}>Checker</button>
        ) : (
          <button className="btn" onClick={() => act('call')}>
            {legal.callAmount >= me.stack ? `Tapis ${fmt(legal.callAmount)}` : `Suivre ${fmt(legal.callAmount)}`}
          </button>
        )}
        <button className="btn primary" disabled={!legal.canRaise} onClick={() => setRaising(true)}>{raiseWord}</button>
      </div>
    </div>
  );
}

function SeatedControls({ state, run }: { state: ClientState; run: (p: Promise<unknown>) => void }) {
  const seat = state.seats[state.you.seat!]!;
  const h = state.hand;
  const [rebuy, setRebuy] = useState<number | null>(null);
  const inHandNow = !!h && !h.ended && seat.inHand;
  const canShow = !!h?.ended && seat.inHand && seat.cards.length > 0 && !h.winningCards.some((c) => seat.cards.includes(c));

  if (rebuy !== null) {
    return (
      <form className="actionbar idle-bar" onSubmit={(e) => { e.preventDefault(); run(call('rebuy', { amount: rebuy })); setRebuy(null); }}>
        <label className="inline-field">
          <span>Recave</span>
          <input type="number" inputMode="numeric" min={1} value={rebuy} onChange={(e) => setRebuy(Number(e.target.value))} />
        </label>
        <button type="button" className="btn" onClick={() => setRebuy(null)}>Annuler</button>
        <button className="btn primary">Demander</button>
      </form>
    );
  }

  return (
    <div className="actionbar idle-bar">
      <p className="myhand">{inHandNow && !seat.folded ? state.myHandName : seat.stack === 0 ? 'Plus de jetons' : ''}</p>
      <div className="buttons">
        {canShow && <button className="btn" onClick={() => run(call('showCards', {}))}>Montrer</button>}
        {state.config.allowStraddle && (
          <button className={'btn' + (state.you.wantsStraddle ? ' primary' : '')} aria-pressed={state.you.wantsStraddle}
            title="Miser 2 grosses blindes à l'aveugle quand vous êtes juste après la grosse blinde"
            onClick={() => run(call('setStraddle', { on: !state.you.wantsStraddle }))}>
            Straddle
          </button>
        )}
        {!inHandNow && (state.config.allowRebuy || state.you.isOwner) && (
          <button className="btn" onClick={() => setRebuy(state.config.bigBlind * 100)}>Recave</button>
        )}
        <button className="btn icon-btn" onClick={() => run(call('setAway', { away: !seat.away }))}
          aria-pressed={seat.away}>
          <Icon name={seat.away ? 'play' : 'away'} />{seat.away ? 'Je reviens' : 'Absent'}
        </button>
        <button className="btn icon-btn" onClick={() => { if (confirm('Quitter la table ? Vos jetons sont comptés dans le ledger.')) run(call('leaveSeat', {})); }}>
          <Icon name="exit" />Quitter
        </button>
      </div>
    </div>
  );
}
