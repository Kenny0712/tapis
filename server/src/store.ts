// Sauvegarde des tables sur disque : une table = un fichier JSON dans server/data/ (ou TAPIS_DATA_DIR).
// Un redémarrage du serveur relit ces fichiers et la partie reprend là où elle était.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Game, GameSnapshot } from './game';

const DIR = process.env.TAPIS_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '../data');
const DELAY_MS = 400;
const pending = new Map<string, { game: Game; timer: NodeJS.Timeout }>();

mkdirSync(DIR, { recursive: true });

const fileOf = (id: string) => join(DIR, `${id}.json`);

function write(game: Game) {
  const file = fileOf(game.id);
  // Écriture dans un fichier temporaire puis renommage : un arrêt brutal ne laisse jamais un fichier à moitié écrit.
  writeFileSync(file + '.tmp', JSON.stringify(game.snapshot()));
  renameSync(file + '.tmp', file);
}

/** Enregistre la table un peu plus tard, en regroupant les changements rapprochés. */
export function scheduleSave(game: Game) {
  if (pending.has(game.id)) return;
  const timer = setTimeout(() => {
    pending.delete(game.id);
    try { write(game); } catch (e) { console.error(`Sauvegarde de ${game.id} impossible :`, (e as Error).message); }
  }, DELAY_MS);
  pending.set(game.id, { game, timer });
}

/** Écrit tout de suite ce qui attend (arrêt du serveur). */
export function flushAll() {
  for (const { game, timer } of pending.values()) {
    clearTimeout(timer);
    try { write(game); } catch { /* on tente les autres */ }
  }
  pending.clear();
}

export function removeSaved(id: string) {
  const p = pending.get(id);
  if (p) clearTimeout(p.timer);
  pending.delete(id);
  rmSync(fileOf(id), { force: true });
}

/** Tables sauvegardées, en écartant celles inactives depuis plus de `maxAgeMs` (supprimées). */
export function loadSaved(maxAgeMs: number): GameSnapshot[] {
  const out: GameSnapshot[] = [];
  for (const name of readdirSync(DIR)) {
    if (!name.endsWith('.json')) continue;
    const file = join(DIR, name);
    try {
      const snap = JSON.parse(readFileSync(file, 'utf8')) as GameSnapshot;
      if (snap.version !== 1 || Date.now() - snap.lastActivity > maxAgeMs) rmSync(file, { force: true });
      else out.push(snap);
    } catch (e) {
      console.error(`Table illisible ignorée (${name}) :`, (e as Error).message);
    }
  }
  return out;
}

export const dataDir = DIR;
