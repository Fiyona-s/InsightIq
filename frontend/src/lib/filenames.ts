/** Display only: never replace filenames, dataset identities or provenance. */
export function middleEllipsis(name: string, max = 32): string {
  const chars = Array.from(name);
  const limit = Math.max(12, max);
  if (chars.length <= limit) return name;
  const extension = name.lastIndexOf('.') > 0 ? Array.from(name.slice(name.lastIndexOf('.'))).length : 0;
  const tail = Math.min(limit - 4, Math.max(extension + 8, Math.floor((limit - 1) * 0.45)));
  return chars.slice(0, limit - tail - 1).join('') + '…' + chars.slice(-tail).join('');
}
