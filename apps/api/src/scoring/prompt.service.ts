import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PROMPT_NAME, PROMPT_V1 } from './prompt';

export interface ActivePrompt {
  id: string;
  version: number;
  template: string;
}

/**
 * The active scoring prompt. Prompts are global and versioned (PromptVersion),
 * so a score can say which wording produced it. The table is not per workspace,
 * so it is read through the raw client (allowlisted in eslint.config.mjs for
 * this file). Version 1 is created on first use.
 */
@Injectable()
export class PromptService {
  private cached?: { prompt: ActivePrompt; until: number };

  constructor(private readonly prisma: PrismaService) {}

  async active(now: number = Date.now()): Promise<ActivePrompt> {
    if (this.cached && this.cached.until > now) return this.cached.prompt;
    let row = await this.prisma.promptVersion.findFirst({
      where: { name: PROMPT_NAME, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!row) {
      try {
        row = await this.prisma.promptVersion.create({
          data: { name: PROMPT_NAME, version: 1, template: PROMPT_V1, isActive: true },
        });
      } catch (error) {
        // Two workers made version 1 at once: the unique (name, version) refused the second.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        row = await this.prisma.promptVersion.findFirstOrThrow({
          where: { name: PROMPT_NAME, version: 1 },
        });
      }
    }
    const prompt = { id: row.id, version: row.version, template: row.template };
    this.cached = { prompt, until: now + 60_000 };
    return prompt;
  }
}
