import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { apiKeyMatches, apiKeyPrefix, hashApiKey } from '../sources/api-key';

export interface AuthenticatedSource {
  sourceId: string;
  workspaceId: string;
  /** Encrypted signing secret; null when signing is off. */
  hmacSecretEnc: string | null;
  defaultCountry: string | null;
}

/** Compared against when the key is unknown, so a missing source takes as long as a wrong key. */
const DUMMY_HASH = hashApiKey('lp_00000000.dummy-key-for-constant-time-compare');

/**
 * Finds the source a presented API key belongs to. This is the one lookup that
 * cannot be scoped by workspace: we do not know the workspace until the key
 * has identified its source, so it uses the raw client (allowlisted in
 * eslint.config.mjs for this file only). After this, everything runs through
 * `TenantPrisma.for(workspaceId)`.
 */
@Injectable()
export class IngestAuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** The source when the key is valid for exactly this source and the source is on; else null, whatever the reason. */
  async authenticate(sourceId: string, presentedKey: string): Promise<AuthenticatedSource | null> {
    const prefix = apiKeyPrefix(presentedKey);
    const row = prefix
      ? await this.prisma.source.findUnique({
          where: { apiKeyPrefix: prefix },
          include: { workspace: { select: { defaultCountry: true } } },
        })
      : null;
    // Always hash and compare, found or not.
    const keyOk = apiKeyMatches(presentedKey, row?.apiKeyHash ?? DUMMY_HASH);
    if (!row || !keyOk || row.id !== sourceId || !row.enabled) return null;
    return {
      sourceId: row.id,
      workspaceId: row.workspaceId,
      hmacSecretEnc: row.hmacSecretEnc,
      defaultCountry: row.workspace.defaultCountry,
    };
  }
}
