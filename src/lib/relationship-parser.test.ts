import { describe, it, expect } from 'vitest';
import { parseChain, isParseError, type ParsedChain, type ParseError } from './relationship-parser';

function pairs(result: ReturnType<typeof parseChain>): ParsedChain['pairs'] {
  if (isParseError(result)) throw new Error(`Expected success, got error: ${result.error}`);
  return result.pairs;
}

function err(result: ReturnType<typeof parseChain>): string {
  if (!isParseError(result)) throw new Error('Expected error, got success');
  return (result as ParseError).error;
}

describe('parseChain — basic operators', () => {
  it('parses a strict comparison', () => {
    expect(pairs(parseChain('Luffy > Zoro'))).toEqual([
      { superiorName: 'Luffy', inferiorName: 'Zoro', strict: true },
    ]);
  });

  it('parses a non-strict comparison', () => {
    expect(pairs(parseChain('Luffy >= Zoro'))).toEqual([
      { superiorName: 'Luffy', inferiorName: 'Zoro', strict: false },
    ]);
  });

  it('rejects `=` with a helpful message pointing at >= / <=', () => {
    const result = parseChain('Luffy = Zoro');
    expect(isParseError(result)).toBe(true);
    const msg = err(result);
    expect(msg).toMatch(/no longer supported/i);
    expect(msg).toMatch(/>=/);
  });

  it('rejects `=` even when embedded mid-chain', () => {
    expect(isParseError(parseChain('A > B = C'))).toBe(true);
  });

  it('parses < by reversing operands', () => {
    expect(pairs(parseChain('Zoro < Luffy'))).toEqual([
      { superiorName: 'Luffy', inferiorName: 'Zoro', strict: true },
    ]);
  });

  it('parses <= by reversing operands', () => {
    expect(pairs(parseChain('Zoro <= Luffy'))).toEqual([
      { superiorName: 'Luffy', inferiorName: 'Zoro', strict: false },
    ]);
  });
});

describe('parseChain — chains', () => {
  it('expands a 3-element chain into adjacent pairs', () => {
    expect(pairs(parseChain('A > B > C'))).toEqual([
      { superiorName: 'A', inferiorName: 'B', strict: true },
      { superiorName: 'B', inferiorName: 'C', strict: true },
    ]);
  });

  it('preserves per-segment operators in mixed chains', () => {
    expect(pairs(parseChain('A > B >= C'))).toEqual([
      { superiorName: 'A', inferiorName: 'B', strict: true },
      { superiorName: 'B', inferiorName: 'C', strict: false },
    ]);
  });

  it('handles a long chain', () => {
    const result = pairs(parseChain('A > B > C > D > E'));
    expect(result).toHaveLength(4);
    expect(result.map((p) => `${p.superiorName}>${p.inferiorName}`)).toEqual([
      'A>B', 'B>C', 'C>D', 'D>E',
    ]);
  });
});

describe('parseChain — fan-out (comma lists)', () => {
  it('expands fan-out on the right side', () => {
    expect(pairs(parseChain('X > A, B, C'))).toEqual([
      { superiorName: 'X', inferiorName: 'A', strict: true },
      { superiorName: 'X', inferiorName: 'B', strict: true },
      { superiorName: 'X', inferiorName: 'C', strict: true },
    ]);
  });

  it('expands fan-out on the left side', () => {
    expect(pairs(parseChain('A, B, C > X'))).toEqual([
      { superiorName: 'A', inferiorName: 'X', strict: true },
      { superiorName: 'B', inferiorName: 'X', strict: true },
      { superiorName: 'C', inferiorName: 'X', strict: true },
    ]);
  });

  it('cartesian-products lists across an operator', () => {
    const result = pairs(parseChain('A, B > C, D'));
    expect(result).toHaveLength(4);
    expect(result).toContainEqual({ superiorName: 'A', inferiorName: 'C', strict: true });
    expect(result).toContainEqual({ superiorName: 'A', inferiorName: 'D', strict: true });
    expect(result).toContainEqual({ superiorName: 'B', inferiorName: 'C', strict: true });
    expect(result).toContainEqual({ superiorName: 'B', inferiorName: 'D', strict: true });
  });

  it('combines fan-out and chains', () => {
    const result = pairs(parseChain('X > A, B > Z'));
    // X > {A, B} produces X>A, X>B
    // {A, B} > Z produces A>Z, B>Z
    expect(result).toHaveLength(4);
    expect(result).toContainEqual({ superiorName: 'X', inferiorName: 'A', strict: true });
    expect(result).toContainEqual({ superiorName: 'X', inferiorName: 'B', strict: true });
    expect(result).toContainEqual({ superiorName: 'A', inferiorName: 'Z', strict: true });
    expect(result).toContainEqual({ superiorName: 'B', inferiorName: 'Z', strict: true });
  });
});

describe('parseChain — whitespace handling', () => {
  it('trims surrounding whitespace', () => {
    expect(pairs(parseChain('  A > B  '))).toEqual([
      { superiorName: 'A', inferiorName: 'B', strict: true },
    ]);
  });

  it('handles names with internal spaces', () => {
    expect(pairs(parseChain('Monkey D Luffy > Roronoa Zoro'))).toEqual([
      { superiorName: 'Monkey D Luffy', inferiorName: 'Roronoa Zoro', strict: true },
    ]);
  });

  it('handles mixed whitespace around operators', () => {
    expect(pairs(parseChain('A>B'))).toEqual([
      { superiorName: 'A', inferiorName: 'B', strict: true },
    ]);
  });
});

describe('parseChain — error cases', () => {
  it('rejects empty input', () => {
    expect(err(parseChain(''))).toBe('Empty input');
    expect(err(parseChain('   '))).toBe('Empty input');
  });

  it('rejects input with no operator', () => {
    expect(isParseError(parseChain('Luffy'))).toBe(true);
    expect(isParseError(parseChain('A B C'))).toBe(true);
  });

  it('rejects missing operands', () => {
    expect(isParseError(parseChain('> B'))).toBe(true);
    expect(isParseError(parseChain('A >'))).toBe(true);
  });

  it('rejects empty list members between operators', () => {
    // "A > , > B" — middle is an empty list after splitting on commas
    expect(isParseError(parseChain('A > , > B'))).toBe(true);
  });
});
