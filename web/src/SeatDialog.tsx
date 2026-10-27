import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ClientState } from '@tapis/engine';
import { call, identity, rememberName } from './net';

export function SeatDialog({ state, seat, onClose, onError }: {
  state: ClientState; seat: number; onClose: () => void; onError: (m: string) => void;
}) {
  const [name, setName] = useState(identity().name);
  const [stack, setStack] = useState(state.config.bigBlind * 100);
  const [away, setAway] = useState(false);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      rememberName(name.trim());
      await call('requestSeat', { seat, name, stack, away });
      onClose();
    } catch (err) {
      onError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="sheet" role="dialog" aria-modal="true" aria-labelledby="seat-title" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <h2 id="seat-title">Siège {seat + 1}</h2>
        <label className="field">
          <span>Pseudo</span>
          <input ref={first} value={name} onChange={(e) => setName(e.target.value)} maxLength={18} autoComplete="nickname" required />
        </label>
        <label className="field">
          <span>Tapis de départ</span>
          <input type="number" inputMode="numeric" min={1} value={stack} onChange={(e) => setStack(Number(e.target.value))} required />
          <small>{Math.round(stack / state.config.bigBlind)} grosses blindes</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={away} onChange={(e) => setAway(e.target.checked)} /> M'asseoir en absent
        </label>
        <div className="buttons">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" disabled={busy}>{state.you.isOwner ? "M'asseoir" : 'Demander la place'}</button>
        </div>
        {!state.you.isOwner && <p className="hint">{state.ownerName} valide les places et les montants.</p>}
      </form>
    </div>
  );
}
