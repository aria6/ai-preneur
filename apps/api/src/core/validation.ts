import { ERROR_CODES, type ValidationIssue } from '@ai-preneur/shared';
import type { z } from 'zod';

import { AppError } from './errors.js';

export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Validates untrusted input (req.body, req.query, req.params) against a Zod schema.
 * Returns the parsed, typed value or throws a 400 VALIDATION_ERROR.
 *
 * Usage inside a controller:
 *   const input = parseInput(createUserSchema, req.body);
 */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError({
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Request validation failed',
      details: toValidationIssues(result.error),
    });
  }
  return result.data;
}
