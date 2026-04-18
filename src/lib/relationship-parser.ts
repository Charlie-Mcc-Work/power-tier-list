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

export const OP_REGEX = /(>=|<=|>|<|=)/;

/**
 * Parse a relationship statement. Supports:
 *
 *   Chains:    "A > B > C > D"      → A>B, B>C, C>D
 *   Fan-out:   "X > A, B, C"        → X>A, X>B, X>C
 *   Combined:  "X > A, B > Z"       → X>A, X>B, A>Z, B>Z
 *   Equality:  "A = B"              → A>=B, B>=A
 *
 * Comma-separated names in any position create a cartesian product
 * with adjacent segments across the operator.
 *
 * Operators:
 *   >   strictly stronger (must be in a higher tier)
 *   >=  at least as strong (same tier OK)
 *   =   equal (same tier — creates two >= relationships)
 *   <=  at most as strong (reverse of >=)
 *   <   strictly weaker (reverse of >)
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

    for (const left of leftNames) {
      for (const right of rightNames) {
        switch (op) {
          case '>':
            pairs.push({ superiorName: left, inferiorName: right, strict: true });
            break;
          case '>=':
            pairs.push({ superiorName: left, inferiorName: right, strict: false });
            break;
          case '=':
            pairs.push({ superiorName: left, inferiorName: right, strict: false });
            pairs.push({ superiorName: right, inferiorName: left, strict: false });
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
