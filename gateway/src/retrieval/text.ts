export function normalize(s: string): string {
  // Lowercase
  let str = s.toLowerCase();
  // Normalize to NFD
  str = str.normalize('NFD');
  // Remove combining diacritics U+0300–ͯ
  str = str.replace(/[\u0300-\u036f]/g, '');
  // Replace đ with d
  str = str.replace(/đ/g, 'd');
  // Replace non-alphanumeric characters with space
  str = str.replace(/[^a-z0-9]+/g, ' ');
  // Trim
  str = str.trim();
  return str;
}

export const STOPWORDS: ReadonlySet<string> = new Set([
  'la', 'va', 'cua', 'co', 'cho', 'toi', 'ban', 'minh', 'the', 'nao', 'gi', 'khong', 'a', 'oi', 'nhe', 'voi', 'mot', 'nhung', 'cac', 'duoc', 'de', 'thi', 'o'
]);

export function tokenize(s: string): string[] {
  const normalized = normalize(s);
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/);
  return tokens.filter(t => t.length > 0 && !STOPWORDS.has(t));
}
