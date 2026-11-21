/**
 * @ai-preneur/shared
 *
 * Runtime-agnostic code shared by the web app and the API:
 * API contracts (Zod schemas), shared types and constants.
 *
 * Rules: no business logic, no database access, no Node.js or browser APIs.
 * The only allowed dependency is `zod`.
 */
export * from './constants/index.js';
export * from './schemas/index.js';
export type * from './types/index.js';
