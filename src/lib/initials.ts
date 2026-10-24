/** Up to two initials for an avatar: "Olivia Owner" → "OO", "Plato" → "PL". Decorative only. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts.at(-1)![0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
