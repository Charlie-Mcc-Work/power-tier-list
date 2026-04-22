// crypto.randomUUID() is only defined in secure contexts (HTTPS or localhost).
// When the app is served over plain HTTP on a non-localhost IP (e.g., a Tailscale
// IP or LAN address) randomUUID is undefined and every id-generating call —
// createTierList, addCharacter, addRelationship, import, etc. — throws silently,
// which looks to the user like "the Create button doesn't work".
//
// crypto.getRandomValues IS available in insecure contexts on all evergreen
// browsers, so we build a v4 UUID from it (RFC 4122 §4.4).
if (typeof crypto.randomUUID !== 'function') {
  const polyfill = (): `${string}-${string}-${string}-${string}-${string}` => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xxxxxx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}` as const;
  };
  try {
    (crypto as Crypto & { randomUUID: typeof polyfill }).randomUUID = polyfill;
  } catch {
    Object.defineProperty(crypto, 'randomUUID', { value: polyfill, configurable: true });
  }
}
