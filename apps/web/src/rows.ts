export function replaceRow<T>(rows: readonly T[], matches: (row: T) => boolean, next: T): T[] {
  return rows.map((row) => (matches(row) ? next : row));
}
