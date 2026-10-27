// Une carte s'écrit rang + couleur : "As" (as de pique), "Td" (dix de carreau), "2c".
export type Card = string;

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

export function rankValue(card: Card): number {
  return RANKS.indexOf(card[0]) + 2;
}

export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

/** Fisher-Yates. `randomInt(n)` doit renvoyer un entier uniforme dans [0, n). */
export function shuffle(deck: Card[], randomInt: (n: number) => number): Card[] {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
