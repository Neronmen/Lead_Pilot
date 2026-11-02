import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { FixedWindowLimiter, type WindowStore } from '../ingest/rate-limiter';
import { WINDOW_STORE } from '../redis/redis.tokens';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fair use of the AI. Every rating by the real AI counts against two daily allowances: one per
 * workspace (so one busy customer cannot use everything up) and one for the whole system (so the
 * AI service's own daily limit is never reached by surprise). A rating past either is made by the
 * simple rules and marked "Rated without AI"; the lead is never lost or delayed. The free built-in
 * mock does not count. Counters live in Redis, so several API processes share them.
 * Limits: AI_DAILY_RATINGS_PER_WORKSPACE and AI_DAILY_RATINGS_GLOBAL (0 turns a limit off).
 */
@Injectable()
export class AiQuota {
  /** Public so a test can swap them. */
  perWorkspace: FixedWindowLimiter;
  global: FixedWindowLimiter;

  constructor(@Inject(WINDOW_STORE) store: WindowStore, config: ConfigService<Env, true>) {
    const perWorkspace = config.get('AI_DAILY_RATINGS_PER_WORKSPACE', { infer: true });
    const global = config.get('AI_DAILY_RATINGS_GLOBAL', { infer: true });
    this.perWorkspace = new FixedWindowLimiter(perWorkspace, store, 'ai:day:workspace', DAY_MS);
    this.global = new FixedWindowLimiter(global, store, 'ai:day:global', DAY_MS);
    this.enabled = { perWorkspace: perWorkspace > 0, global: global > 0 };
  }

  private readonly enabled: { perWorkspace: boolean; global: boolean };

  /** Takes one rating from both allowances. True when both had room; false when either is used up. */
  async take(workspaceId: string): Promise<boolean> {
    // The workspace's own allowance first: a customer over theirs must not use up the shared one.
    if (this.enabled.perWorkspace && (await this.perWorkspace.hit(workspaceId)) > 0) return false;
    if (this.enabled.global && (await this.global.hit('all')) > 0) return false;
    return true;
  }
}
