import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

/**
 * Password hashing with argon2id (SPEC §4.8), using the library's defaults
 * (64 MiB memory, 3 passes): deliberately slow, so a stolen hash is costly to
 * crack.
 */
@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  /**
   * Checks a password against a stored hash. With no hash (unknown email) it
   * still runs one full argon2 verification against a dummy hash, so a login
   * for an unknown address takes as long as one with a wrong password and
   * response time does not reveal which emails have accounts.
   */
  async verify(storedHash: string | undefined, password: string): Promise<boolean> {
    if (storedHash === undefined) {
      this.dummyHash ??= this.hash('leadpilot-timing-equalizer');
      await argon2.verify(await this.dummyHash, password);
      return false;
    }
    try {
      return await argon2.verify(storedHash, password);
    } catch {
      // A malformed stored hash is a data problem, never a successful login.
      return false;
    }
  }
}
