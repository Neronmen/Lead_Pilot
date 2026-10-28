/**
 * `pnpm eval`: how good is the scorer? It rates a labelled set of leads
 * (evals/leads.jsonl, rated against evals/rubric.json) and prints accuracy, a
 * confusion matrix by tier, average cost and average latency. Pass a second
 * prompt to compare it with the active one:
 *
 *   pnpm eval                                  # the built-in prompt (version 1)
 *   pnpm eval --candidate path/to/prompt.txt   # also run this prompt and show the difference
 *   pnpm eval --candidate v2                   # the built-in version 2
 *   pnpm eval --split dev                      # only the 30 "dev" leads (tune the prompt on these)
 *   pnpm eval --split held                     # only the 20 "held-out" leads (measure ONCE, never tune on them)
 *   pnpm eval --split dev --show-errors        # list the wrong leads (number, label, answer) to tune on
 *
 * It uses whichever AI the environment selects (LLM_PROVIDER, ANTHROPIC_API_KEY,
 * OPENAI_API_KEY): with no key it runs the free mock, which only proves the
 * plumbing and the rule-based baseline. Real accuracy needs a real model and
 * real labels (the corrections people make on the Review queue are the source).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scoreOutputSchema, type IcpRubric, type ScoreOutput } from '@leadpilot/shared';
import { chooseLlm } from '../src/scoring/llm.factory';
import { costUsd, LlmError, type LlmProvider } from '../src/scoring/llm.provider';
import { capForInfo, informationLevel, type InfoLevel } from '../src/scoring/info';
import { PROMPT_V1, PROMPT_V2, buildUserMessage } from '../src/scoring/prompt';
import type { ScoringInput } from '../src/scoring/rules';
import { extractJson } from '../src/scoring/scoring.util';

const TIERS = ['hot', 'warm', 'cold', 'junk'] as const;
type Tier = (typeof TIERS)[number];
type Guess = Tier | 'invalid';

interface Labelled {
  label: Tier;
  lead: ScoringInput['lead'];
  company: ScoringInput['company'];
}

interface RunResult {
  name: string;
  accuracy: number;
  matrix: Record<Tier, Record<Guess, number>>;
  invalid: number;
  /** Why answers were unusable, most common first: an error message, "not JSON" or a schema problem. */
  problems: [string, number][];
  /** Accuracy by how much the lead told us. */
  byLevel: Partial<Record<InfoLevel, { total: number; correct: number }>>;
  /** Wrong leads (number, label, answer), only with --show-errors. */
  wrong: string[];
  accuracyOfValid: number;
  avgOutputTokens: number;
  avgThinkingTokens: number;
  avgCostUsd: number;
  avgLatencyMs: number;
}

// The API reads the repo's .env through Nest; this script does not start Nest, so it reads the
// same file itself (variables already set in the shell win). Without this it would silently use the mock.
const envFile = resolve(__dirname, '../../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const root = resolve(__dirname, '../../../../evals');
const rubric = JSON.parse(readFileSync(resolve(root, 'rubric.json'), 'utf8')) as IcpRubric;
const all: Labelled[] = readFileSync(resolve(root, 'leads.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as Labelled);

// Dev leads are for tuning the prompt. Held-out leads are measured once at the end and never tuned
// on: numbers 0 and 1 of every five are held out (20 of 50, spread over every tier).
const splitAt = process.argv.indexOf('--split');
const split = splitAt === -1 ? 'all' : (process.argv[splitAt + 1] ?? 'all');
const isHeld = (index: number) => index % 5 < 2;
const chosen = all
  .map((item, index) => ({ item, index }))
  .filter(({ index }) =>
    split === 'dev' ? !isHeld(index) : split === 'held' ? isHeld(index) : true,
  );
const leads = chosen.map(({ item }) => item);
const showErrors = process.argv.includes('--show-errors');

/** A short fixed word for why an answer was unusable (counted and printed per reason). */
function reasonOf(error: unknown): string {
  if (error instanceof LlmError) return error.code; // http_429, timeout, finish_MAX_TOKENS, ...
  if (error instanceof SyntaxError) return 'json_parse_failed';
  if (error instanceof Error && error.message === 'no JSON object') return 'json_not_found';
  return 'other';
}

async function run(name: string, template: string, llm: LlmProvider): Promise<RunResult> {
  const matrix = Object.fromEntries(
    TIERS.map((tier) => [tier, Object.fromEntries([...TIERS, 'invalid'].map((g) => [g, 0]))]),
  ) as RunResult['matrix'];
  let correct = 0;
  let invalid = 0;
  const problems = new Map<string, number>();
  const note = (reason: string) => problems.set(reason, (problems.get(reason) ?? 0) + 1);
  let cost = 0;
  let latency = 0;
  let answered = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  const wrong: string[] = [];
  const byLevel: Partial<Record<InfoLevel, { total: number; correct: number }>> = {};
  for (const { item, index } of chosen) {
    const started = Date.now();
    let guess: Guess = 'invalid';
    // The same cap the real pipeline applies: with limited information the answer is never Hot.
    const info = informationLevel(item.lead, item.company);
    try {
      const answer = await llm.complete({
        system: template,
        user: buildUserMessage({ lead: item.lead, company: item.company, rubric }),
      });
      cost += costUsd(llm.model, answer.inputTokens, answer.outputTokens);
      outputTokens += answer.outputTokens;
      thinkingTokens += answer.thinkingTokens ?? 0;
      answered += 1;
      const parsed = scoreOutputSchema.safeParse(extractJson(answer.text));
      if (parsed.success) {
        const capped = capForInfo(parsed.data as ScoreOutput, info.level);
        guess = capped.isSpam ? 'junk' : capped.tier;
      } else {
        // Which field and what is wrong with it (names from our own schema, no values).
        const issue = parsed.error.issues[0];
        note(`schema_${issue?.path.join('.') || 'answer'}_${issue?.code}`);
      }
    } catch (error) {
      // An unusable answer counts as "invalid" (a miss), not as a crash of the run. Only a short
      // fixed code is kept: never the key, the lead's text or what the AI service sent back.
      note(reasonOf(error));
    }
    latency += Date.now() - started;
    if (guess === 'invalid') invalid += 1;
    if (guess === item.label) correct += 1;
    else if (showErrors) wrong.push(`#${index} ${item.label} -> ${guess} (info: ${info.level})`);
    matrix[item.label][guess] += 1;
    const bucket = (byLevel[info.level] ??= { total: 0, correct: 0 });
    bucket.total += 1;
    if (guess === item.label) bucket.correct += 1;
  }
  return {
    name,
    accuracy: correct / leads.length,
    matrix,
    invalid,
    problems: [...problems.entries()].sort((a, b) => b[1] - a[1]),
    byLevel,
    wrong,
    accuracyOfValid: leads.length === invalid ? 0 : correct / (leads.length - invalid),
    avgOutputTokens: answered ? outputTokens / answered : 0,
    avgThinkingTokens: answered ? thinkingTokens / answered : 0,
    avgCostUsd: cost / leads.length,
    avgLatencyMs: latency / leads.length,
  };
}

function print(result: RunResult): void {
  console.log(`\nPrompt: ${result.name}`);
  console.log(
    `  Accuracy (exact tier): ${(result.accuracy * 100).toFixed(1)}%  (${leads.length} leads)`,
  );
  console.log(
    `  Accuracy over the answers that were usable: ${(result.accuracyOfValid * 100).toFixed(1)}%  (${leads.length - result.invalid} of ${leads.length})`,
  );
  console.log(`  Unusable answers: ${result.invalid}`);
  for (const [reason, count] of result.problems) console.log(`    ${count} x ${reason}`);
  console.log(
    `  Average tokens per answer: ${result.avgOutputTokens.toFixed(0)} written, ${result.avgThinkingTokens.toFixed(0)} thinking`,
  );
  console.log(`  Average cost per lead: $${result.avgCostUsd.toFixed(5)}`);
  console.log(
    `  Average latency: ${result.avgLatencyMs.toFixed(0)} ms (includes waiting for the pacing slot)`,
  );
  console.log('  Accuracy by information level:');
  for (const level of ['limited', 'enough', 'rich'] as const) {
    const bucket = result.byLevel[level];
    if (bucket) {
      console.log(
        `    ${level.padEnd(8)} ${((bucket.correct / bucket.total) * 100).toFixed(0).padStart(3)}%  (${bucket.correct} of ${bucket.total})`,
      );
    }
  }
  for (const line of result.wrong) console.log(`    wrong ${line}`);
  console.log('\n  Rows: the label. Columns: what the scorer said.');
  console.log(`  ${'label'.padEnd(8)}${[...TIERS, 'invalid'].map((g) => g.padStart(9)).join('')}`);
  for (const tier of TIERS) {
    const row = [...TIERS, 'invalid'].map((g) =>
      String(result.matrix[tier][g as Guess]).padStart(9),
    );
    console.log(`  ${tier.padEnd(8)}${row.join('')}`);
  }
}

async function main(): Promise<void> {
  const candidateAt = process.argv.indexOf('--candidate');
  const llm = chooseLlm({
    LLM_PROVIDER:
      (process.env.LLM_PROVIDER as 'auto' | 'mock' | 'anthropic' | 'openai' | 'gemini') ?? 'auto',
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_MAX_REQUESTS_PER_MINUTE: Number(process.env.LLM_MAX_REQUESTS_PER_MINUTE ?? 0) || 0,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  });
  const wanted = process.env.LLM_PROVIDER ?? 'auto';
  if (llm.name === 'mock' && wanted !== 'auto' && wanted !== 'mock') {
    console.log(
      `WARNING: LLM_PROVIDER=${wanted}, but its API key was not found (looked in the shell and in ${envFile}), so the free mock is used.`,
    );
  }
  console.log(`Leads: ${leads.length} (${split})`);
  console.log(
    `Scorer: ${llm.name} (${llm.model})${llm.name === 'mock' ? ' - the free built-in mock' : ''}`,
  );
  const base = await run('built-in v1', PROMPT_V1, llm);
  print(base);
  if (candidateAt !== -1) {
    const file = process.argv[candidateAt + 1];
    if (!file) throw new Error('--candidate needs a file');
    const template = file === 'v2' ? PROMPT_V2 : readFileSync(resolve(file), 'utf8');
    const candidate = await run(`candidate (${file})`, template, llm);
    print(candidate);
    const delta = (candidate.accuracy - base.accuracy) * 100;
    console.log(
      `\nCandidate vs v1: accuracy ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} points, cost ${candidate.avgCostUsd - base.avgCostUsd >= 0 ? '+' : ''}$${(candidate.avgCostUsd - base.avgCostUsd).toFixed(5)} per lead.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
