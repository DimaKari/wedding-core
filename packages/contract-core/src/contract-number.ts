/**
 * Formats the human-readable contract number. The underlying sequence value
 * itself is produced concurrency-safely by the `next_contract_number(brand_id,
 * year)` Postgres function in the db migration (a single atomic
 * INSERT ... ON CONFLICT DO UPDATE ... RETURNING) — this function only does
 * the formatting, kept separate so the format can change without touching
 * the concurrency-critical database logic.
 */
export function formatContractNumber(prefix: string, year: number, sequenceValue: number): string {
  return `${prefix}-${year}-${String(sequenceValue).padStart(3, "0")}`;
}
