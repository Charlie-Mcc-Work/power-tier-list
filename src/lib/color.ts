/**
 * Pick dark or light text for readability on an arbitrary hex background.
 * Tier colors are user-picked — hardcoding dark text makes tier names
 * unreadable on dark colors.
 */
export function readableTextOn(hex: string): '#141414' | '#f5f5f5' {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#141414';
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Perceived luminance (ITU-R BT.601 weights)
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 140 ? '#141414' : '#f5f5f5';
}
