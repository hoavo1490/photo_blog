// SqlDriver is the thin abstraction over the two Postgres drivers we run:
//   - production: @neondatabase/serverless HTTP driver (in the Worker)
//   - tests:      @electric-sql/pglite in-process Postgres (Node)
//
// Repository functions take a SqlDriver argument so the exact same SQL is
// exercised in both environments. Tagged-template / raw HTTP transport
// differences stay confined to the driver implementations.

export interface SqlDriver {
  /** Execute a parameterized query, returning the rows. */
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;

  /** Execute a parameterized statement without expecting rows. */
  exec(text: string, params?: unknown[]): Promise<void>;
}

export type Row = Record<string, unknown>;
