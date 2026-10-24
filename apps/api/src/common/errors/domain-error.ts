import { HttpStatus } from '@nestjs/common';

/**
 * Base class for expected business errors. Services throw these; the global
 * exception filter turns them into `{ error: { code, message, details? } }`.
 * Domain modules subclass it (e.g. `LeadNotFoundError`) as they need.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
