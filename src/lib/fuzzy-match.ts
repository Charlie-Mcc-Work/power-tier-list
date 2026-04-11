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

/** Find a single best match, or null if no good match */
export function findBestMatch(query: string, characters: Character[]): Character | null {
  const matches = fuzzyMatchCharacter(query, characters);
  return matches.length > 0 ? matches[0] : null;
}
