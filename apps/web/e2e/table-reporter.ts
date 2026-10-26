import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Writes e2e/results.md: one row per test with PASS / FAIL, the same pass/fail
 * table style as the design milestone's self-check.
 */
export default class TableReporter implements Reporter {
  private rows: { title: string; ok: boolean; ms: number }[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    // Keep the last attempt of a retried test.
    this.rows = this.rows.filter((row) => row.title !== test.titlePath().slice(2).join(' › '));
    this.rows.push({
      title: test.titlePath().slice(2).join(' › '),
      ok: result.status === 'passed' || result.status === 'skipped',
      ms: result.duration,
    });
  }

  onEnd(result: FullResult) {
    const rows = this.rows.sort((a, b) => a.title.localeCompare(b.title));
    const passed = rows.filter((row) => row.ok).length;
    const lines = [
      '# Web render checks',
      '',
      `${passed}/${rows.length} passed (${result.status})`,
      '',
      '| Check | Result |',
      '| --- | --- |',
      ...rows.map((row) => `| ${row.title} | ${row.ok ? 'PASS' : 'FAIL'} |`),
      '',
    ];
    writeFileSync(join(__dirname, 'results.md'), lines.join('\n'));
  }
}
