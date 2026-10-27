/**
 * `pnpm eval`: how good is the scorer? It rates a labelled set of leads
 * (evals/leads.jsonl, rated against evals/rubric.json) and prints accuracy, a
 * confusion matrix by tier, average cost and average latency. Pass a second
 * prompt to compare it with the active one:
 *
 *   pnpm eval                                  # the built-in prompt (version 1)
 *   pnpm eval --candidate path/to/prompt.txt   # also run this prompt and show the difference
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
import { costUsd, type LlmProvider } from '../src/scoring/llm.provider';
import { PROMPT_V1, buildUserMessage } from '../src/scoring/prompt';
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
  avgCostUsd: number;
  avgLatencyMs: number;
}

// The API reads the repo's .env through Nest; this script does not start Nest, so it reads the
// same file itself (variables already set in the shell win). Without this it would silently use the mock.
const envFile = resolve(__dirname, '../../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const root = resolve(__dirname, '../../../../evals');
const rubric = JSON.parse(readFileSync(resolve(root, 'rubric.json'), 'utf8')) as IcpRubric;
const leads: Labelled[] = readFileSync(resolve(root, 'leads.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as Labelled);

async function run(name: string, template: string, llm: LlmProvider): Promise<RunResult> {
  const matrix = Object.fromEntries(
    TIERS.map((tier) => [tier, Object.fromEntries([...TIERS, 'invalid'].map((g) => [g, 0]))]),
  ) as RunResult['matrix'];
  let correct = 0;
  let invalid = 0;
  let cost = 0;
  let latency = 0;
  for (const item of leads) {
    const started = Date.now();
    let guess: Guess = 'invalid';
    try {
      const answer = await llm.complete({
        system: template,
        user: buildUserMessage({ lead: item.lead, company: item.company, rubric }),
      });
      cost += costUsd(llm.model, answer.inputTokens, answer.outputTokens);
      const parsed = scoreOutputSchema.safeParse(extractJson(answer.text));
      if (parsed.success) guess = (parsed.data as ScoreOutput).isSpam ? 'junk' : parsed.data.tier;
    } catch {
      // An unusable answer counts as "invalid" (a miss), not as a crash of the run.
    }
    latency += Date.now() - started;
    if (guess === 'invalid') invalid += 1;
    if (guess === item.label) correct += 1;
    matrix[item.label][guess] += 1;
  }
  return {
    name,
    accuracy: correct / leads.length,
    matrix,
    invalid,
    avgCostUsd: cost / leads.length,
    avgLatencyMs: latency / leads.length,
  };
}

function print(result: RunResult): void {
  console.log(`\nPrompt: ${result.name}`);
  console.log(
    `  Accuracy (exact tier): ${(result.accuracy * 100).toFixed(1)}%  (${leads.length} leads)`,
  );
  console.log(`  Unusable answers: ${result.invalid}`);
  console.log(`  Average cost per lead: $${result.avgCostUsd.toFixed(5)}`);
  console.log(`  Average latency: ${result.avgLatencyMs.toFixed(0)} ms`);
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
  console.log(
    `Scorer: ${llm.name} (${llm.model})${llm.name === 'mock' ? ' - the free built-in mock' : ''}`,
  );
  const base = await run('built-in v1', PROMPT_V1, llm);
  print(base);
  if (candidateAt !== -1) {
    const file = process.argv[candidateAt + 1];
    if (!file) throw new Error('--candidate needs a file');
    const candidate = await run(`candidate (${file})`, readFileSync(resolve(file), 'utf8'), llm);
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
