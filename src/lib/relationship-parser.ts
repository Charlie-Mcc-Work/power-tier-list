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

const OP_REGEX = /(>=|<=|>|<|=)/;

/**
 * Parse a relationship statement (supports chains).
 *
 *   "Luffy > Zoro"          → one strict pair
 *   "Luffy >= Zoro"         → one non-strict pair
 *   "Luffy = Zoro"          → bidirectional (two non-strict pairs)
 *   "A > B > C > D"         → three strict pairs
 *   "A >= B > C"            → one non-strict + one strict
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
    return { error: 'Use format: "A > B" or "A > B > C"' };
  }

  const pairs: ParsedPair[] = [];

  for (let i = 0; i < parts.length - 2; i += 2) {
    const left = parts[i].trim();
    const op = parts[i + 1];
    const right = parts[i + 2].trim();

    if (!left || !right) {
      return { error: `Missing character name around "${op}"` };
    }

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

  if (pairs.length === 0) {
    return { error: 'No valid relationships found' };
  }

  return { pairs };
}
