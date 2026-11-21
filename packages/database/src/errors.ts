/**
 * PostgreSQL error helpers. Drizzle wraps driver errors (`DrizzleQueryError`)
 * and keeps the pg error as `cause`, so the SQLSTATE is searched along the chain.
 */
function sqlState(error: unknown, depth = 0): string | undefined {
  if (depth > 5 || typeof error !== 'object' || error === null) return undefined;
  if ('code' in error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)) {
    return error.code;
  }
  return 'cause' in error ? sqlState(error.cause, depth + 1) : undefined;
}

/** 23505 — unique_violation */
export const isUniqueViolation = (error: unknown): boolean => sqlState(error) === '23505';

/** 23503 — foreign_key_violation */
export const isForeignKeyViolation = (error: unknown): boolean => sqlState(error) === '23503';
