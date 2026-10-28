import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_PROMPT_VERSION, PROMPT_NAME, PROMPTS } from './prompt';

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
    // Every known version has a row (so a score can point at the wording that produced it).
    for (const { version, template } of PROMPTS) {
      await this.prisma.promptVersion.upsert({
        where: { name_version: { name: PROMPT_NAME, version } },
        create: { name: PROMPT_NAME, version, template, isActive: false },
        update: {},
      });
    }
    // The code decides which version is the default (raised only after a held-out evaluation).
    const wanted = await this.prisma.promptVersion.findUniqueOrThrow({
      where: { name_version: { name: PROMPT_NAME, version: DEFAULT_PROMPT_VERSION } },
    });
    if (!wanted.isActive) {
      await this.prisma.$transaction([
        this.prisma.promptVersion.updateMany({
          where: { name: PROMPT_NAME },
          data: { isActive: false },
        }),
        this.prisma.promptVersion.update({ where: { id: wanted.id }, data: { isActive: true } }),
      ]);
    }
    const prompt = { id: wanted.id, version: wanted.version, template: wanted.template };
    this.cached = { prompt, until: now + 60_000 };
    return prompt;
  }
}
