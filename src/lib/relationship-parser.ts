export interface ParsedPair {
  superiorName: string;
  inferiorName: string;
  strict: boolean;
}

export interface ParsedChain {
  pairs: ParsedPair[];
}

export interface ParseError {
  error: string;
}

export type ParseResult = ParsedChain | ParseError;

export function isParseError(result: ParseResult): result is ParseError {
  return 'error' in result;
}

// `=` is still recognized by the tokenizer so we can return a friendly error
// message — it's no longer a valid operator.
export const OP_REGEX = /(>=|<=|>|<|=)/;

/**
 * Parse a relationship statement. Supports:
 *
 *   Chains:    "A > B > C > D"      → A>B, B>C, C>D
 *   Fan-out:   "X > A, B, C"        → X>A, X>B, X>C
 *   Combined:  "X > A, B > Z"       → X>A, X>B, A>Z, B>Z
 *
 * Comma-separated names in any position create a cartesian product
 * with adjacent segments across the operator.
 *
 * Operators:
 *   >   strictly stronger (must be in a strictly higher tier)
 *   >=  same tier; A is positioned before B within that tier
 *   <=  reverse of >= (shorthand for B >= A)
 *   <   reverse of > (shorthand for B > A)
 */
export function parseChain(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { error: 'Empty input' };

  const parts = trimmed.split(OP_REGEX);

  if (parts.length < 3 || parts.length % 2 === 0) {
    return { error: 'Use format: "A > B" or "A > B, C, D"' };
  }

  const pairs: ParsedPair[] = [];

  for (let i = 0; i < parts.length - 2; i += 2) {
    const leftNames = parts[i].split(',').map((n) => n.trim()).filter(Boolean);
    const op = parts[i + 1];
    const rightNames = parts[i + 2].split(',').map((n) => n.trim()).filter(Boolean);

    if (leftNames.length === 0 || rightNames.length === 0) {
      return { error: `Missing character name around "${op}"` };
    }

    if (op === '=') {
      return {
        error:
          '"=" is no longer supported — use ">=" or "<=" (each puts the two characters in the same tier, with a defined within-tier order).',
      };
    }

    for (const left of leftNames) {
      for (const right of rightNames) {
        switch (op) {
          case '>':
            pairs.push({ superiorName: left, inferiorName: right, strict: true });
            break;
          case '>=':
            pairs.push({ superiorName: left, inferiorName: right, strict: false });
            break;
          case '<=':
            pairs.push({ superiorName: right, inferiorName: left, strict: false });
            break;
          case '<':
            pairs.push({ superiorName: right, inferiorName: left, strict: true });
            break;
        }
      }
    }
  }

  if (pairs.length === 0) {
    return { error: 'No valid relationships found' };
  }

  return { pairs };
}
