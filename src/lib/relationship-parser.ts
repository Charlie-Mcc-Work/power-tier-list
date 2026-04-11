import type { Confidence } from '../types';

export interface ParsedRelationship {
  superiorName: string;
  inferiorName: string;
  confidence: Confidence;
}

export interface ParseError {
  error: string;
}

export type ParseResult = ParsedRelationship | ParseError;

export function isParseError(result: ParseResult): result is ParseError {
  return 'error' in result;
}

/**
 * Parse relationship statements:
 *   "Mihawk >> Shanks"  → certain (Mihawk stronger)
 *   "Mihawk > Shanks"   → likely
 *   "Mihawk >? Shanks"  → speculative
 *   "Shanks < Mihawk"   → likely (Mihawk stronger)
 *   "Shanks << Mihawk"  → certain (Mihawk stronger)
 *   "Shanks <? Mihawk"  → speculative (Mihawk stronger)
 */
export function parseRelationshipStatement(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { error: 'Empty input' };

  // Try >> (certain), >? (speculative), > (likely)
  const greaterPatterns: [RegExp, Confidence][] = [
    [/^(.+?)\s*>>\s*(.+)$/, 'certain'],
    [/^(.+?)\s*>\?\s*(.+)$/, 'speculative'],
    [/^(.+?)\s*>\s*(.+)$/, 'likely'],
  ];

  for (const [pattern, confidence] of greaterPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const superior = match[1].trim();
      const inferior = match[2].trim();
      if (!superior || !inferior) return { error: 'Missing character name' };
      return { superiorName: superior, inferiorName: inferior, confidence };
    }
  }

  // Try << (certain), <? (speculative), < (likely) — reversed direction
  const lesserPatterns: [RegExp, Confidence][] = [
    [/^(.+?)\s*<<\s*(.+)$/, 'certain'],
    [/^(.+?)\s*<\?\s*(.+)$/, 'speculative'],
    [/^(.+?)\s*<\s*(.+)$/, 'likely'],
  ];

  for (const [pattern, confidence] of lesserPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const inferior = match[1].trim();
      const superior = match[2].trim();
      if (!superior || !inferior) return { error: 'Missing character name' };
      return { superiorName: superior, inferiorName: inferior, confidence };
    }
  }

  return { error: 'Could not parse. Use format: "Character A > Character B"' };
}
