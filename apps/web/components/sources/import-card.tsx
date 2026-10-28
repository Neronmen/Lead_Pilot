'use client';

import { IMPORT_BATCH_ROWS, type ImportResult } from '@leadpilot/shared';
import { FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  hasContactColumn,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  parseCsv,
  type ParsedCsv,
} from '@/lib/csv/parse';
import { useSourceActions } from '@/lib/sources/use-sources';
import { type Notice, useFailureNotice } from './sources-notice';

/**
 * "Import a spreadsheet": choose a CSV file, see what was found, import it in batches. Each row goes
 * through the same cleaning, de-duplication and rating as a lead sent by a form. Column names are used
 * as they are ("First Name", "E-mail" and "email" all work); unknown columns are kept as extra details.
 */
export function ImportCard({
  sourceId,
  onClose,
  onNotice,
}: {
  sourceId: string;
  onClose: () => void;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useTranslations('sources.import');
  const reasons = useTranslations('sources.stats.reasons');
  const failure = useFailureNotice();
  const { importRows } = useSourceActions();
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [problem, setProblem] = useState<'big' | 'rows' | 'empty' | 'read' | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setParsed(null);
    setResult(null);
    setProblem(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setProblem('big');
    try {
      const data = parseCsv(await file.text());
      if (data.rows.length === 0) return setProblem('empty');
      if (data.rows.length > MAX_IMPORT_ROWS) return setProblem('rows');
      setParsed(data);
    } catch {
      setProblem('read');
    }
  }

  async function run() {
    if (!parsed || progress !== null) return;
    onNotice(null);
    const total: ImportResult = { created: 0, merged: 0, rejected: 0, reasons: [] };
    const counts = new Map<string, number>();
    try {
      for (let at = 0; at < parsed.rows.length; at += IMPORT_BATCH_ROWS) {
        setProgress(at);
        const batch = await importRows.mutateAsync({
          id: sourceId,
          rows: parsed.rows.slice(at, at + IMPORT_BATCH_ROWS),
        });
        total.created += batch.created;
        total.merged += batch.merged;
        total.rejected += batch.rejected;
        for (const { reason, count } of batch.reasons)
          counts.set(reason, (counts.get(reason) ?? 0) + count);
      }
      total.reasons = [...counts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count);
      setResult(total);
      setParsed(null);
    } catch (error) {
      onNotice(failure(error));
    } finally {
      setProgress(null);
    }
  }

  const knownReasons = new Set([
    'invalid_email',
    'disposable_email',
    'invalid_phone',
    'contact_required',
    'invalid_text',
    'invalid_country',
  ]);

  return (
    <section
      aria-labelledby="import-title"
      className="flex flex-col gap-3 rounded-lg border border-accent-line bg-raised p-3"
    >
      <div className="flex items-start gap-2">
        <FileSpreadsheet className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 id="import-title" className="text-sm font-medium">
            {t('title')}
          </h3>
          <p className="text-[13px] text-muted-foreground">{t('help')}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
      </div>

      {result ? (
        <div role="status" className="flex flex-col gap-1 text-[13px]">
          <p className="font-medium">
            {t('done', {
              created: result.created,
              merged: result.merged,
              rejected: result.rejected,
            })}
          </p>
          {result.reasons.length > 0 ? (
            <p className="text-muted-foreground">
              {t('why', {
                list: result.reasons
                  .map(
                    ({ reason, count }) =>
                      `${reasons((knownReasons.has(reason) ? reason : 'other') as 'other')} (${count})`,
                  )
                  .join(', '),
              })}
            </p>
          ) : null}
          <Link href="/leads" className="text-accent-text underline underline-offset-2">
            {t('open')}
          </Link>
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-[13px]">
            <span>{t('choose')}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void onFile(event)}
              disabled={progress !== null}
              className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5"
            />
          </label>
          {problem ? (
            <p role="alert" className="text-[13px] text-danger-text">
              {t(`problem.${problem}`, {
                rows: MAX_IMPORT_ROWS,
                mb: MAX_IMPORT_BYTES / 1024 / 1024,
              })}
            </p>
          ) : null}
          {parsed ? (
            <div className="flex flex-col gap-2 text-[13px]">
              <p>{t('found', { rows: parsed.rows.length, columns: parsed.headers.length })}</p>
              <p className="text-muted-foreground">
                {t('columns', { list: parsed.headers.join(', ') })}
              </p>
              {hasContactColumn(parsed.headers) ? null : (
                <p role="alert" className="text-danger-text">
                  {t('noContact')}
                </p>
              )}
              <div>
                <Button size="sm" disabled={progress !== null} onClick={() => void run()}>
                  {progress === null ? (
                    t('start', { rows: parsed.rows.length })
                  ) : (
                    <>
                      <LoaderCircle
                        className="animate-spin motion-reduce:animate-none"
                        aria-hidden
                      />
                      {t('working', {
                        done: Math.min(progress, parsed.rows.length),
                        total: parsed.rows.length,
                      })}
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
