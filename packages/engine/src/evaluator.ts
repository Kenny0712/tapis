import { Card, rankValue } from './cards';

export const CATEGORY_NAMES = [
  'Hauteur',
  'Paire',
  'Double paire',
  'Brelan',
  'Quinte',
  'Couleur',
  'Full',
  'Carré',
  'Quinte flush',
] as const;

const RANK_NAMES: Record<number, string> = {
  2: 'deux', 3: 'trois', 4: 'quatre', 5: 'cinq', 6: 'six', 7: 'sept', 8: 'huit',
  9: 'neuf', 10: 'dix', 11: 'valet', 12: 'dame', 13: 'roi', 14: 'as',
};
const RANK_PLURAL: Record<number, string> = {
  2: 'deux', 3: 'trois', 4: 'quatre', 5: 'cinq', 6: 'six', 7: 'sept', 8: 'huit',
  9: 'neuf', 10: 'dix', 11: 'valets', 12: 'dames', 13: 'rois', 14: 'as',
};

/** « de rois », mais « d'as » (élision). */
const of = (r: number) => (r === 14 ? "d'as" : `de ${RANK_PLURAL[r]}`);

export interface HandValue {
  /** Catégorie puis départages : on compare deux scores dans l'ordre. */
  score: number[];
  name: string;
  cards: Card[];
}

function score5(cards: Card[]): number[] {
  const ranks = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  let straightHigh = 0;
  if (new Set(ranks).size === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5) straightHigh = 5; // roue A-2-3-4-5
  }
  if (straightHigh && flush) return [8, straightHigh];

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map(([r]) => r);

  if (groups[0][1] === 4) return [7, ...byGroup];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, ...byGroup];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, ...byGroup];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...byGroup];
  if (groups[0][1] === 2) return [1, ...byGroup];
  return [0, ...ranks];
}

export function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function describe(score: number[]): string {
  const [cat, a, b] = score;
  switch (cat) {
    case 0: return `Hauteur ${RANK_NAMES[a]}`;
    case 1: return `Paire ${of(a)}`;
    case 2: return `Double paire ${RANK_PLURAL[a]} et ${RANK_PLURAL[b]}`;
    case 3: return `Brelan ${of(a)}`;
    case 4: return `Quinte au ${RANK_NAMES[a]}`;
    case 5: return `Couleur hauteur ${RANK_NAMES[a]}`;
    case 6: return `Full aux ${RANK_PLURAL[a]} par les ${RANK_PLURAL[b]}`;
    case 7: return `Carré ${of(a)}`;
    case 8: return a === 14 ? 'Quinte flush royale' : `Quinte flush au ${RANK_NAMES[a]}`;
  }
  return CATEGORY_NAMES[cat];
}

/** Meilleure main de 5 cartes parmi 5 à 7 cartes. */
export function evaluate(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error('Il faut au moins 5 cartes');
  let best: { score: number[]; cards: Card[] } | null = null;
  const n = cards.length;
  const pick: Card[] = [];
  const walk = (start: number) => {
    if (pick.length === 5) {
      const s = score5(pick);
      if (!best || compareScores(s, best.score) > 0) best = { score: s, cards: pick.slice() };
      return;
    }
    for (let i = start; i <= n - (5 - pick.length); i++) {
      pick.push(cards[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  const b = best!;
  return { score: b.score, name: describe(b.score), cards: b.cards };
}

/** Nom de la main partielle (2 à 4 cartes), pour l'aide affichée au joueur avant la river. */
export function describePartial(cards: Card[]): string {
  if (cards.length >= 5) return evaluate(cards).name;
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(rankValue(c), (counts.get(rankValue(c)) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (groups[0][1] === 4) return `Carré ${of(groups[0][0])}`;
  if (groups[0][1] === 3) return `Brelan ${of(groups[0][0])}`;
  if (groups[0][1] === 2 && groups[1]?.[1] === 2)
    return `Double paire ${RANK_PLURAL[groups[0][0]]} et ${RANK_PLURAL[groups[1][0]]}`;
  if (groups[0][1] === 2) return `Paire ${of(groups[0][0])}`;
  return `Hauteur ${RANK_NAMES[groups[0][0]]}`;
}
