'use client';

import type { CreateRoutingRuleRequest, RoutingRule } from '@leadpilot/shared';
import { ArrowDown, ArrowUp, FlaskConical, Plus, Route } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SourcesNotice, useFailureNotice, type Notice } from '@/components/sources/sources-notice';
import { ErrorState, StateView } from '@/components/state-views';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { emptyDraft, hasInnerGroups, ruleToDraft } from '@/lib/routing/draft';
import { useRuleActions, useRules } from '@/lib/routing/use-routing';
import { RuleForm } from './rule-form';
import { RuleTester } from './rule-tester';
import { useDescribe } from './sentence';

/** The Routing rules page (Owner and Admin only: the Settings frame keeps everyone else out). */
export function RoutingView() {
  const t = useTranslations('routing');
  const rules = useRules();
  const actions = useRuleActions();
  const failure = useFailureNotice();
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setNotice(null);
    try {
      await action();
      return true;
    } catch (error) {
      setNotice(failure(error));
      return false;
    }
  }

  async function create(request: CreateRoutingRuleRequest) {
    if (await run(() => actions.create.mutateAsync(request))) setAdding(false);
  }

  if (rules.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={t('loading')}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (rules.isError) {
    return (
      <section className="rounded-xl border border-border bg-card">
        <ErrorState title={t('loadTitle')} body={t('loadBody')}>
          <Button variant="outline" onClick={() => void rules.refetch()}>
            {t('retry')}
          </Button>
        </ErrorState>
      </section>
    );
  }

  const list = rules.data;
  const move = (index: number, by: -1 | 1) => {
    const ids = list.map((r) => r.id);
    const other = index + by;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other]!, ids[index]!];
    void run(() => actions.reorder.mutateAsync(ids));
  };

  return (
    <div className="flex flex-col gap-4">
      {notice ? (
        <SourcesNotice
          notice={notice}
          onReload={() => {
            setNotice(null);
            void rules.refetch();
          }}
          onDismiss={() => setNotice(null)}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {adding ? null : (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t('add')}
          </Button>
        )}
        {testing ? null : (
          <Button variant="outline" onClick={() => setTesting(true)}>
            <FlaskConical aria-hidden />
            {t('test.open')}
          </Button>
        )}
      </div>

      {testing ? <RuleTester onClose={() => setTesting(false)} /> : null}
      {adding ? (
        <RuleForm
          initial={emptyDraft()}
          saving={actions.create.isPending}
          onSave={(request) => void create(request)}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {list.length === 0 ? (
        adding ? null : (
          <section className="rounded-xl border border-border bg-card">
            <StateView icon={Route} tone="accent" title={t('empty.title')} body={t('empty.body')}>
              <Button onClick={() => setAdding(true)}>{t('empty.cta')}</Button>
            </StateView>
          </section>
        )
      ) : (
        <>
          <p className="text-[13px] text-muted-foreground">{t('orderHelp')}</p>
          <ol className="flex flex-col gap-3">
            {list.map((rule, index) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                first={index === 0}
                last={index === list.length - 1}
                editing={editing === rule.id}
                busy={
                  actions.update.isPending || actions.remove.isPending || actions.reorder.isPending
                }
                onEdit={() => setEditing(rule.id)}
                onStopEditing={() => setEditing(null)}
                onMove={(by) => move(index, by)}
                onToggle={() =>
                  void run(() =>
                    actions.update.mutateAsync({ id: rule.id, enabled: !rule.enabled }),
                  )
                }
                onSave={async (request) => {
                  if (await run(() => actions.update.mutateAsync({ id: rule.id, ...request }))) {
                    setEditing(null);
                  }
                }}
                onDelete={() => run(() => actions.remove.mutateAsync(rule.id))}
              />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  first,
  last,
  editing,
  busy,
  onEdit,
  onStopEditing,
  onMove,
  onToggle,
  onSave,
  onDelete,
}: {
  rule: RoutingRule;
  first: boolean;
  last: boolean;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onStopEditing: () => void;
  onMove: (by: -1 | 1) => void;
  onToggle: () => void;
  onSave: (request: CreateRoutingRuleRequest) => Promise<void>;
  onDelete: () => Promise<boolean>;
}) {
  const t = useTranslations('routing');
  const describe = useDescribe();
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    // A rule with a group inside a group (made through the API) cannot be shown in the flat form.
    if (hasInnerGroups(rule.conditions)) {
      return (
        <li className="flex flex-col gap-2 rounded-xl border border-border bg-card px-[18px] py-4">
          <p className="text-sm">{t('groupsNote')}</p>
          <div>
            <Button size="sm" variant="ghost" onClick={onStopEditing}>
              {t('form.cancel')}
            </Button>
          </div>
        </li>
      );
    }
    return (
      <li>
        <RuleForm
          initial={ruleToDraft(rule)}
          saving={busy}
          onSave={(request) => void onSave(request)}
          onCancel={onStopEditing}
        />
      </li>
    );
  }

  return (
    <li
      className={
        'flex flex-col gap-2 rounded-xl border border-border bg-card px-[18px] py-4' +
        (rule.enabled ? '' : ' opacity-70')
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="min-w-0 flex-1 truncate text-[15px] leading-[22px] font-semibold">
          {rule.name}
        </h2>
        {rule.enabled ? null : <Badge variant="outline">{t('off')}</Badge>}
        {rule.alwaysRun ? <Badge variant="secondary">{t('alwaysRuns')}</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">{describe.rule(rule)}</p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px]">{t('deleteAsk', { name: rule.name })}</span>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void onDelete().then((ok) => ok && setConfirming(false))}
          >
            {t('deleteYes')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            {t('form.cancel')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || first}
            aria-label={t('moveUp', { name: rule.name })}
            onClick={() => onMove(-1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || last}
            aria-label={t('moveDown', { name: rule.name })}
            onClick={() => onMove(1)}
          >
            <ArrowDown aria-hidden />
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
            {t('edit')}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onToggle}>
            {rule.enabled ? t('switchOff') : t('switchOn')}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
            {t('delete')}
          </Button>
        </div>
      )}
    </li>
  );
}
