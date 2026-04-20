import { describe, it, expect } from 'vitest';
import { fuzzyMatchCharacter, findBestMatch, resolveUnique } from './fuzzy-match';
import type { Character } from '../types';

function ch(name: string): Character {
  return { id: name.toLowerCase(), tierListId: 't', name, createdAt: 0, updatedAt: 0 };
}

describe('fuzzyMatchCharacter', () => {
  const chars = [ch('Luffy'), ch('Zoro'), ch('Sanji'), ch('Sabo')];

  it('returns empty array for empty query', () => {
    expect(fuzzyMatchCharacter('', chars)).toEqual([]);
    expect(fuzzyMatchCharacter('   ', chars)).toEqual([]);
  });

  it('matches by exact name (case-insensitive)', () => {
    expect(fuzzyMatchCharacter('luffy', chars)[0].name).toBe('Luffy');
    expect(fuzzyMatchCharacter('LUFFY', chars)[0].name).toBe('Luffy');
  });

  it('ranks exact match before startsWith', () => {
    const localChars = [ch('Sa'), ch('Sabo'), ch('Sanji')];
    const result = fuzzyMatchCharacter('sa', localChars);
    expect(result[0].name).toBe('Sa');
  });

  it('ranks startsWith before contains', () => {
    const localChars = [ch('Mihawk'), ch('Hawk Eye')];
    const result = fuzzyMatchCharacter('hawk', localChars);
    // Hawk Eye starts with hawk; Mihawk only contains it.
    expect(result[0].name).toBe('Hawk Eye');
    expect(result[1].name).toBe('Mihawk');
  });

  it('returns no matches when query does not appear', () => {
    expect(fuzzyMatchCharacter('xyz', chars)).toEqual([]);
  });
});

describe('findBestMatch', () => {
  const chars = [ch('Luffy'), ch('Zoro')];

  it('returns the top match', () => {
    expect(findBestMatch('luf', chars)?.name).toBe('Luffy');
  });

  it('returns null when no match', () => {
    expect(findBestMatch('xyz', chars)).toBeNull();
  });

  it('returns null for empty query', () => {
    expect(findBestMatch('', chars)).toBeNull();
  });

  // Documents a known soft-match issue: short prefixes can latch onto unintended characters.
  // The chain parser should use resolveUnique instead, which is strict about ambiguity.
  it('latches onto first prefix match for very short queries (potential source of mistakes)', () => {
    const localChars = [ch('Roronoa Zoro'), ch('Roger')];
    expect(findBestMatch('ro', localChars)?.name).toBe('Roronoa Zoro');
  });
});

describe('resolveUnique', () => {
  const chars = [ch('Luffy'), ch('Zoro'), ch('Sanji'), ch('Sabo'), ch('Sa')];

  it('returns notFound for empty query', () => {
    expect(resolveUnique('', chars)).toEqual({ kind: 'notFound' });
    expect(resolveUnique('   ', chars)).toEqual({ kind: 'notFound' });
  });

  it('returns notFound when no character matches', () => {
    expect(resolveUnique('xyz', chars)).toEqual({ kind: 'notFound' });
  });

  it('returns unique exact match over prefix candidates', () => {
    // "sa" is an exact match for ch('Sa'), even though Sanji/Sabo start with "sa".
    const result = resolveUnique('sa', chars);
    expect(result.kind).toBe('found');
    if (result.kind === 'found') expect(result.character.name).toBe('Sa');
  });

  it('is case-insensitive for exact match', () => {
    const result = resolveUnique('LUFFY', chars);
    expect(result.kind).toBe('found');
    if (result.kind === 'found') expect(result.character.name).toBe('Luffy');
  });

  it('returns a unique prefix match', () => {
    const result = resolveUnique('luf', chars);
    expect(result.kind).toBe('found');
    if (result.kind === 'found') expect(result.character.name).toBe('Luffy');
  });

  it('returns ambiguous when multiple characters share a prefix', () => {
    // "san" matches only "Sanji" → found
    expect(resolveUnique('san', chars).kind).toBe('found');
    // But a prefix that matches 2+ → ambiguous
    const result = resolveUnique('s', chars);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.candidates.map((c) => c.name).sort()).toEqual(['Sa', 'Sabo', 'Sanji']);
    }
  });

  it('does NOT fall through to substring matches (the silent-typo bug)', () => {
    // "uffy" is a substring of "Luffy" but NOT a prefix. Must return notFound,
    // not silently match Luffy like findBestMatch does.
    expect(resolveUnique('uffy', chars)).toEqual({ kind: 'notFound' });
  });

  it('returns ambiguous when multiple exact matches exist (duplicate names)', () => {
    const dups = [ch('Duplicate'), { ...ch('Duplicate'), id: 'dup-2' }];
    const result = resolveUnique('duplicate', dups);
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') expect(result.candidates).toHaveLength(2);
  });
});
