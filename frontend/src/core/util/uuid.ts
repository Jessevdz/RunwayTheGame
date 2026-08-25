/** Generates a v4 UUID string with fallbacks for non-secure HTTP contexts. */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c: string) => {
      const n = Number(c);
      return (n ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (n / 4)))).toString(16);
    });
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}
