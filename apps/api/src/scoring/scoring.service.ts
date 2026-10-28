import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ScoreOutput, scoreOutputSchema } from '@leadpilot/shared';
import type { Env } from '../config/env.schema';
import { EnrichmentService } from '../enrichment/enrichment.service';
import { Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import type { ProcessLeadJob } from '../queue/pipeline.queue';
import { costUsd, LLM_PROVIDER, type LlmProvider } from './llm.provider';
import { buildUserMessage } from './prompt';
import { PromptService } from './prompt.service';
import { capForInfo, type InfoLevel, informationLevel, reviewReasonOf } from './info';
import { extractJson, monthStart } from './scoring.util';
import { RubricService } from './rubric.service';
import { ruleScore, type ScoringInput } from './rules';

/** Why a lead was rated by the rules and not by the AI. */
export type FallbackReason = 'limit' | 'invalid_output' | 'provider_error';

const DB_TIER = { hot: 'HOT', warm: 'WARM', cold: 'COLD', junk: 'JUNK' } as const;

/**
 * Pipeline step 2: rate one lead against the workspace's ideal customer.
 *
 * - The AI's answer must pass the zod schema; an invalid answer is asked again
 *   once, and if it is still invalid the rule-based score is used and the lead
 *   goes to review.
 * - Over the monthly AI budget, leads are rated by the rules ("rated without AI")
 *   and still saved: nothing is lost, and they can be looked at again later.
 * - A provider that is down throws, so the queue retries with backoff.
 * - Every score records the prompt version, model, tokens, cost and time.
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly tenant: TenantPrisma,
    private readonly rubric: RubricService,
    private readonly enrichment: EnrichmentService,
    private readonly prompts: PromptService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async scoreLead(job: ProcessLeadJob, now: Date = new Date()): Promise<void> {
    const db = this.tenant.for(job.workspaceId);
    const lead = await db.lead.findUnique({ where: { id: job.leadId } });
    if (!lead) return; // gone, or not in this workspace
    await db.lead.update({ where: { id: lead.id }, data: { status: 'PROCESSING' } });

    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: job.workspaceId } });
    const input = await this.inputFor(
      lead,
      await this.rubric.get(job.workspaceId),
      lead.domain ? (await this.enrichment.forDomain(lead.domain, now)).data : null,
    );
    const prompt = await this.prompts.active();

    let fallback: FallbackReason | null = null;
    const spent = await db.score.aggregate({
      where: { createdAt: { gte: monthStart(now) } },
      _sum: { costUsd: true },
    });
    // A workspace with no limit of its own gets the default: unlimited is never the silent setting.
    const fallbackLimit = this.config.get('AI_DEFAULT_MONTHLY_LIMIT_USD', { infer: true });
    const limit =
      workspace.aiMonthlyLimitUsd ?? (fallbackLimit > 0 ? new Prisma.Decimal(fallbackLimit) : null);
    if (limit !== null && (spent._sum.costUsd ?? new Prisma.Decimal(0)).gte(limit)) {
      fallback = 'limit';
    }

    const started = Date.now();
    let output: ScoreOutput;
    let provider: string = this.llm.name;
    let model: string = this.llm.model;
    let inputTokens = 0;
    let outputTokens = 0;
    if (fallback === null) {
      const asked = await this.ask(prompt.template, input);
      inputTokens = asked.inputTokens;
      outputTokens = asked.outputTokens;
      if (asked.output) output = asked.output;
      else {
        fallback = 'invalid_output';
        output = this.rules(input);
      }
    } else {
      output = this.rules(input);
    }
    if (fallback !== null) {
      provider = 'rules';
      model = 'rules-1';
    }
    await this.save(job, {
      output,
      provider,
      model,
      inputTokens,
      outputTokens,
      latencyMs: Date.now() - started,
      promptVersionId: prompt.id,
      fallback,
      threshold: workspace.reviewThreshold,
      level: informationLevel(input.lead, input.company).level,
    });
  }

  /** Called when the queue gave up on a lead: rate it by the rules so it is not lost. */
  async scoreWithRules(job: ProcessLeadJob, reason: FallbackReason): Promise<void> {
    const db = this.tenant.for(job.workspaceId);
    const lead = await db.lead.findUnique({ where: { id: job.leadId } });
    if (!lead) return;
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: job.workspaceId } });
    const input = await this.inputFor(lead, await this.rubric.get(job.workspaceId), null);
    await this.save(job, {
      output: this.rules(input),
      provider: 'rules',
      model: 'rules-1',
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      promptVersionId: (await this.prompts.active()).id,
      fallback: reason,
      threshold: workspace.reviewThreshold,
      level: informationLevel(input.lead, input.company).level,
    });
  }

  private inputFor(
    lead: {
      email: string | null;
      phone: string | null;
      firstName: string | null;
      lastName: string | null;
      company: string | null;
      domain: string | null;
      country: string | null;
      isFreeMail: boolean;
      message: string | null;
      budget: string | null;
      timeline: string | null;
      jobTitle: string | null;
      interest: string | null;
      customFields: unknown;
    },
    rubric: ScoringInput['rubric'],
    company: ScoringInput['company'] | Promise<ScoringInput['company']>,
  ): Promise<ScoringInput> {
    return Promise.resolve(company).then((resolved) => ({
      lead: {
        email: lead.email,
        phone: lead.phone,
        firstName: lead.firstName,
        lastName: lead.lastName,
        company: lead.company,
        domain: lead.domain,
        country: lead.country,
        isFreeMail: lead.isFreeMail,
        message: lead.message,
        budget: lead.budget,
        timeline: lead.timeline,
        jobTitle: lead.jobTitle,
        interest: lead.interest,
        customFields: (lead.customFields ?? {}) as Record<string, unknown>,
      },
      rubric,
      company: resolved,
    }));
  }

  /** The rule-based answer, with confidence kept low so the lead is looked at by a person. */
  private rules(input: ScoringInput): ScoreOutput {
    const { facts: _facts, ...answer } = ruleScore(input);
    return { ...answer, confidence: Math.min(answer.confidence, 0.3) };
  }

  /** Asks the AI, and asks once more if the answer does not match the schema. */
  private async ask(
    template: string,
    input: ScoringInput,
  ): Promise<{ output: ScoreOutput | null; inputTokens: number; outputTokens: number }> {
    const user = buildUserMessage(input);
    let inputTokens = 0;
    let outputTokens = 0;
    let problem = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const answer = await this.llm.complete({
        system: template,
        user:
          attempt === 0
            ? user
            : `${user}\n\nYour previous answer was not valid (${problem}). Answer again with ONLY the JSON object.`,
      });
      inputTokens += answer.inputTokens;
      outputTokens += answer.outputTokens;
      try {
        const parsed = scoreOutputSchema.safeParse(extractJson(answer.text));
        if (parsed.success) return { output: parsed.data, inputTokens, outputTokens };
        problem = parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.') || 'answer'}: ${issue.code}`)
          .join('; ');
      } catch {
        problem = 'not JSON';
      }
    }
    this.logger.warn('The AI answered twice with an invalid answer: rating by the rules');
    return { output: null, inputTokens, outputTokens };
  }

  private async save(
    job: ProcessLeadJob,
    r: {
      output: ScoreOutput;
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      promptVersionId: string;
      fallback: FallbackReason | null;
      threshold: number;
      level: InfoLevel;
    },
  ): Promise<void> {
    const db = this.tenant.for(job.workspaceId);
    // With limited information the rating is a guess: never Hot, and a person looks at it.
    const output = capForInfo(r.output, r.level);
    const tier = output.isSpam ? 'junk' : output.tier;
    const reviewReason = reviewReasonOf({
      fallback: r.fallback !== null,
      level: r.level,
      isSpam: output.isSpam,
      confidence: output.confidence,
      threshold: r.threshold,
    });
    const review = reviewReason !== null;
    await db.$transaction(async (tx) => {
      // A person's override is final: a later automatic score is recorded but changes nothing on the lead.
      const locked =
        (await tx.feedback.count({ where: { leadId: job.leadId, kind: 'override' } })) > 0;
      const score = await tx.score.create({
        data: {
          workspaceId: job.workspaceId,
          leadId: job.leadId,
          promptVersionId: r.promptVersionId,
          provider: r.provider,
          model: r.model,
          output: output as unknown as Prisma.InputJsonObject,
          score: output.score,
          tier: DB_TIER[tier],
          confidence: output.confidence,
          isSpam: output.isSpam,
          isFallback: r.fallback !== null,
          infoLevel: r.level,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costUsd: costUsd(r.model, r.inputTokens, r.outputTokens),
          latencyMs: r.latencyMs,
        },
      });
      // Conditional on "no override yet" in the SAME statement: an override that commits between the
      // check above and this write still wins (the update then matches nothing).
      await tx.lead.updateMany({
        where: { id: job.leadId, feedback: { none: { kind: 'override' } } },
        data: locked
          ? {}
          : {
              score: output.score,
              tier: DB_TIER[tier],
              confidence: output.confidence,
              status: review ? 'NEEDS_REVIEW' : 'SCORED',
              infoLevel: r.level,
              reviewReason,
            },
      });
      await tx.leadEvent.create({
        data: {
          workspaceId: job.workspaceId,
          leadId: job.leadId,
          type: 'scored',
          payload: {
            scoreId: score.id,
            tier,
            score: output.score,
            confidence: output.confidence,
            provider: r.provider,
            ratedWithoutAi: r.fallback !== null,
            ...(r.fallback ? { reason: r.fallback } : {}),
            infoLevel: r.level,
            needsReview: review && !locked,
            ...(reviewReason ? { reviewReason } : {}),
            ...(locked ? { keptPersonsRating: true } : {}),
          },
        },
      });
    });
  }
}
