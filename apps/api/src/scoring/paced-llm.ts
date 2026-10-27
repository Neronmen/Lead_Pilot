import { setTimeout as sleep } from 'node:timers/promises';
import type { LlmProvider, LlmRequest, LlmResponse } from './llm.provider';

/**
 * Spaces calls to the AI at most `perMinute` a minute, in this process. Free tiers allow only a
 * few calls a minute (Gemini's free Flash-Lite: 15), and a burst of leads would otherwise be
 * answered with 429 and fall back to the rules. Each call reserves the next free slot
 * synchronously, so concurrent workers queue up in order instead of racing.
 */
export class PacedLlm implements LlmProvider {
  private nextSlot = 0;
  private readonly interval: number;

  constructor(
    private readonly inner: LlmProvider,
    perMinute: number,
    private readonly now: () => number = Date.now,
  ) {
    this.interval = 60_000 / perMinute;
  }

  get name(): string {
    return this.inner.name;
  }

  get model(): string {
    return this.inner.model;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const now = this.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.interval;
    if (slot > now) await sleep(slot - now);
    return this.inner.complete(request);
  }
}
