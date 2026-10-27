import { useState, type FormEvent } from 'react';
import { call, identity, navigate, rememberName } from './net';

const BLINDS = [
  [1, 2], [5, 10], [10, 20], [25, 50], [50, 100], [100, 200],
] as const;

export function Home() {
  const [name, setName] = useState(identity().name);
  const [blinds, setBlinds] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Choisissez un pseudo');
    setBusy(true);
    setError('');
    try {
      rememberName(name.trim());
      const [smallBlind, bigBlind] = BLINDS[blinds];
      const { gameId } = await call('create', { ...identity(), name: name.trim(), config: { smallBlind, bigBlind } });
      navigate(`/t/${gameId}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const m = link.trim().match(/([\w-]{8,})\/?$/);
    if (m) navigate(`/t/${m[1]}`);
    else setError('Lien ou code de table non reconnu');
  }

  return (
    <main className="home">
      <header className="home-head">
        <span className="brand">Tapis</span>
        <p className="tagline">Une table de poker privée entre amis. Un lien, et tout le monde s'assoit, sur téléphone ou ordinateur.</p>
      </header>

      <form className="panel" onSubmit={create}>
        <h1>Ouvrir une table</h1>
        <label className="field">
          <span>Votre pseudo</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={18} autoComplete="nickname" placeholder="Kenny" />
        </label>
        <fieldset className="field">
          <legend>Blindes (No Limit Hold'em)</legend>
          <div className="chips">
            {BLINDS.map(([s, b], i) => (
              <button type="button" key={i} className={'chip' + (i === blinds ? ' on' : '')}
                aria-pressed={i === blinds} onClick={() => setBlinds(i)}>
                {s}/{b}
              </button>
            ))}
          </div>
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary big" disabled={busy}>{busy ? 'Ouverture…' : 'Créer la table'}</button>
        <p className="hint">Vous serez propriétaire : vous validez qui s'assoit et avec combien.</p>
      </form>

      <form className="panel slim" onSubmit={join}>
        <label className="field">
          <span>Rejoindre avec un lien</span>
          <div className="row">
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Collez le lien reçu" inputMode="url" />
            <button className="btn">Rejoindre</button>
          </div>
        </label>
      </form>

      <footer className="home-foot">Jetons fictifs uniquement. Aucun argent réel n'est misé ni encaissé.</footer>
    </main>
  );
}
