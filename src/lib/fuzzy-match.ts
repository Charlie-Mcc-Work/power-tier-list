import type { Character } from '../types';

/** Simple fuzzy match: case-insensitive substring or exact match. Returns best matches sorted by relevance. */
export function fuzzyMatchCharacter(query: string, characters: Character[]): Character[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const exact: Character[] = [];
  const startsWith: Character[] = [];
  const contains: Character[] = [];

  for (const char of characters) {
    const name = char.name.toLowerCase();
    if (name === q) {
      exact.push(char);
    } else if (name.startsWith(q)) {
      startsWith.push(char);
    } else if (name.includes(q)) {
      contains.push(char);
    }
  }

  return [...exact, ...startsWith, ...contains];
}

export type ResolveResult =
  | { kind: 'found'; character: Character }
  | { kind: 'ambiguous'; candidates: Character[] }
  | { kind: 'notFound' };

/**
 * Strict resolution used by the chain parser, where silently picking a
 * wrong match can create bogus relationships. Accepts only:
 *   1. A unique case-insensitive exact match, or
 *   2. A unique case-insensitive prefix match.
 * Otherwise returns ambiguous (≥2 equally good candidates) or notFound.
 * Crucially does NOT fall back to substring matches.
 */
export function resolveUnique(query: string, characters: Character[]): ResolveResult {
  const q = query.toLowerCase().trim();
  if (!q) return { kind: 'notFound' };

  const exact = characters.filter((c) => c.name.toLowerCase() === q);
  if (exact.length === 1) return { kind: 'found', character: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact };

  const prefix = characters.filter((c) => c.name.toLowerCase().startsWith(q));
  if (prefix.length === 1) return { kind: 'found', character: prefix[0] };
  if (prefix.length > 1) return { kind: 'ambiguous', candidates: prefix };

  return { kind: 'notFound' };
}

/**
 * Lenient best-match used by UI autocompletes. Returns the top fuzzy
 * match (including substring) or null. Do NOT use for chain parsing —
 * use resolveUnique instead.
 */
export function findBestMatch(query: string, characters: Character[]): Character | null {
  const matches = fuzzyMatchCharacter(query, characters);
  return matches.length > 0 ? matches[0] : null;
}
