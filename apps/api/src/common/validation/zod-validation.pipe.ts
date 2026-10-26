import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { ErrorCode, toValidationIssues } from '@leadpilot/shared';
import type { z } from 'zod';
import { DomainError } from '../errors/domain-error';

/**
 * Validates and normalizes input with a shared zod schema (the same one the
 * web app uses). On failure it throws VALIDATION_FAILED with one
 * `ValidationIssue` per problem in `details`: codes and paths, no English
 * text, so the web app can show its own translated messages.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        'Validation failed',
        HttpStatus.BAD_REQUEST,
        toValidationIssues(result.error.issues),
      );
    }
    return result.data;
  }
}
