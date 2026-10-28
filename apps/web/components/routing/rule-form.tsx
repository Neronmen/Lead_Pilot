'use client';

import {
  OPS_FOR_FIELD,
  CONDITION_FIELDS,
  type ConditionField,
  type ConditionOp,
} from '@leadpilot/shared';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { TextField } from '@/components/auth/form-parts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  defaultOp,
  defaultValue,
  draftToRequest,
  emptyAction,
  emptyCondition,
  type ActionDraft,
  type ActionKind,
  type ConditionDraft,
  type RuleDraft,
} from '@/lib/routing/draft';
import { useIntegrations } from '@/lib/routing/use-routing';
import { useSources } from '@/lib/sources/use-sources';
import { useMembers } from '@/lib/team/use-team';
import type { CreateRoutingRuleRequest } from '@leadpilot/shared';

const TIERS = ['hot', 'warm', 'cold', 'junk'] as const;
const INTEGRATION_KINDS = ['slack', 'telegram', 'webhook', 'hubspot'] as const;
const BASE_KINDS: ActionKind[] = ['assign', 'tag', 'email_owner', 'email_admins'];

/**
 * The "If … then …" editor. Everything is a plain input; the same shared schema the API uses decides
 * whether the form is complete when the person saves.
 */
export function RuleForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: RuleDraft;
  saving: boolean;
  onSave: (request: CreateRoutingRuleRequest) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('routing');
  const tiers = useTranslations('tiers');
  const members = useMembers();
  const sources = useSources();
  const integrations = useIntegrations();
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [problem, setProblem] = useState<'name' | 'conditions' | 'actions' | null>(null);

  const patch = (changes: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...changes }));
  const setCondition = (index: number, changes: Partial<ConditionDraft>) =>
    patch({ conditions: draft.conditions.map((c, i) => (i === index ? { ...c, ...changes } : c)) });
  const setAction = (index: number, changes: Partial<ActionDraft>) =>
    patch({ actions: draft.actions.map((a, i) => (i === index ? { ...a, ...changes } : a)) });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = draftToRequest(draft);
    if (!result.ok) return setProblem(result.field);
    setProblem(null);
    onSave(result.request);
  }

  function changeField(index: number, field: ConditionField) {
    setCondition(index, { field, op: defaultOp(field), value: defaultValue(field), key: '' });
  }

  // A list ("is one of") and a single value do not fit each other's input: start over at the border.
  function changeOp(index: number, op: ConditionOp) {
    const current = draft.conditions[index]!;
    const crosses = (current.op === 'in') !== (op === 'in');
    setCondition(index, { op, ...(crosses ? { value: defaultValue(current.field) } : {}) });
  }

  function changeKind(index: number, kind: ActionKind) {
    const first = INTEGRATION_KINDS.includes(kind as (typeof INTEGRATION_KINDS)[number])
      ? (integrations.data?.find((i) => i.type === kind.toUpperCase())?.id ?? '')
      : '';
    setAction(index, { kind, target: first });
  }

  const kindsAvailable = (current: ActionKind): ActionKind[] => [
    ...BASE_KINDS,
    ...INTEGRATION_KINDS.filter(
      (kind) => integrations.data?.some((i) => i.type === kind.toUpperCase()) || kind === current,
    ),
    ...(current === 'assign_team' ? (['assign_team'] as const) : []),
  ];

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={t('form.label')}
      className="flex flex-col gap-4 rounded-xl border border-accent-line bg-card px-[18px] py-4"
    >
      <TextField
        label={t('form.name')}
        value={draft.name}
        maxLength={100}
        autoComplete="off"
        autoFocus
        error={problem === 'name' ? t('form.incomplete.name') : undefined}
        onChange={(event) => patch({ name: event.target.value })}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('form.ifTitle')}</legend>
        {draft.conditions.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('form.noConditions')}</p>
        ) : null}
        {draft.conditions.length > 1 ? (
          <label className="flex flex-wrap items-center gap-2 text-[13px]">
            <span>{t('form.matchLabel')}</span>
            <NativeSelect
              className="h-9 w-auto"
              value={draft.match}
              onChange={(event) => patch({ match: event.target.value as 'all' | 'any' })}
            >
              <option value="all">{t('form.matchAll')}</option>
              <option value="any">{t('form.matchAny')}</option>
            </NativeSelect>
          </label>
        ) : null}
        {draft.conditions.map((c, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label={t('form.fieldLabel', { n: index + 1 })}
              className="h-9 w-auto"
              value={c.field}
              onChange={(event) => changeField(index, event.target.value as ConditionField)}
            >
              {CONDITION_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {t(`field.${field}`)}
                </option>
              ))}
            </NativeSelect>
            {c.field === 'custom' ? (
              <Input
                aria-label={t('form.keyLabel', { n: index + 1 })}
                placeholder={t('form.keyPlaceholder')}
                className="h-9 w-36"
                value={c.key}
                onChange={(event) => setCondition(index, { key: event.target.value })}
              />
            ) : null}
            <NativeSelect
              aria-label={t('form.opLabel', { n: index + 1 })}
              className="h-9 w-auto"
              value={c.op}
              onChange={(event) => changeOp(index, event.target.value as ConditionOp)}
            >
              {OPS_FOR_FIELD[c.field].map((op) => (
                <option key={op} value={op}>
                  {t(`op.${op}`)}
                </option>
              ))}
            </NativeSelect>
            <ValueInput
              index={index}
              condition={c}
              sources={sources.data ?? []}
              tierLabel={(tier) => tiers(tier.toUpperCase() as 'HOT')}
              onChange={(value) => setCondition(index, { value })}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('form.removeCondition', { n: index + 1 })}
              onClick={() => patch({ conditions: draft.conditions.filter((_, i) => i !== index) })}
            >
              <X aria-hidden />
            </Button>
          </div>
        ))}
        {problem === 'conditions' ? (
          <p role="alert" className="text-[13px] text-danger-text">
            {t('form.incomplete.conditions')}
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => patch({ conditions: [...draft.conditions, emptyCondition()] })}
          >
            <Plus aria-hidden />
            {t('form.addCondition')}
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('form.thenTitle')}</legend>
        {draft.actions.map((a, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label={t('form.actionLabel', { n: index + 1 })}
              className="h-9 w-auto"
              value={a.kind}
              onChange={(event) => changeKind(index, event.target.value as ActionKind)}
            >
              {kindsAvailable(a.kind).map((kind) => (
                <option key={kind} value={kind}>
                  {t(`kind.${kind}`)}
                </option>
              ))}
            </NativeSelect>
            {a.kind === 'assign' ? (
              <NativeSelect
                aria-label={t('form.personLabel', { n: index + 1 })}
                className="h-9 w-auto"
                value={a.target}
                onChange={(event) => setAction(index, { target: event.target.value })}
              >
                <option value="">{t('form.choose')}</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name || m.email}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            {a.kind === 'tag' ? (
              <Input
                aria-label={t('form.tagLabel', { n: index + 1 })}
                className="h-9 w-40"
                maxLength={40}
                value={a.target}
                onChange={(event) => setAction(index, { target: event.target.value })}
              />
            ) : null}
            {INTEGRATION_KINDS.includes(a.kind as (typeof INTEGRATION_KINDS)[number]) ? (
              <NativeSelect
                aria-label={t('form.toolLabel', { n: index + 1 })}
                className="h-9 w-auto"
                value={a.target}
                onChange={(event) => setAction(index, { target: event.target.value })}
              >
                <option value="">{t('form.choose')}</option>
                {(integrations.data ?? [])
                  .filter((i) => i.type === a.kind.toUpperCase())
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </NativeSelect>
            ) : null}
            {a.kind === 'assign_team' ? (
              <span className="text-[13px] text-muted-foreground">{t('form.teamNote')}</span>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={t('form.removeAction', { n: index + 1 })}
              onClick={() => patch({ actions: draft.actions.filter((_, i) => i !== index) })}
            >
              <X aria-hidden />
            </Button>
          </div>
        ))}
        {problem === 'actions' ? (
          <p role="alert" className="text-[13px] text-danger-text">
            {t('form.incomplete.actions')}
          </p>
        ) : null}
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => patch({ actions: [...draft.actions, emptyAction()] })}
          >
            <Plus aria-hidden />
            {t('form.addAction')}
          </Button>
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.alwaysRun}
            onChange={(event) => patch({ alwaysRun: event.target.checked })}
          />
          {t('form.alwaysRun')}
        </label>
        <p className="text-xs text-muted-foreground">{t('form.alwaysRunHelp')}</p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
          {t('form.enabled')}
        </label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {t('form.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('form.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** The value box fits the field: a list of tiers, yes / no, a source, a number, or plain text. */
function ValueInput({
  index,
  condition,
  sources,
  tierLabel,
  onChange,
}: {
  index: number;
  condition: ConditionDraft;
  sources: { id: string; name: string }[];
  tierLabel: (tier: string) => string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations('routing');
  const label = t('form.valueLabel', { n: index + 1 });
  const { field, op, value } = condition;
  if (field === 'tier' && op !== 'in') {
    return (
      <NativeSelect
        aria-label={label}
        className="h-9 w-auto"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {TIERS.map((tier) => (
          <option key={tier} value={tier}>
            {tierLabel(tier)}
          </option>
        ))}
      </NativeSelect>
    );
  }
  if (field === 'isFreeMail') {
    return (
      <NativeSelect
        aria-label={label}
        className="h-9 w-auto"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="true">{t('yes')}</option>
        <option value="false">{t('no')}</option>
      </NativeSelect>
    );
  }
  if (field === 'source' && op !== 'in') {
    return (
      <NativeSelect
        aria-label={label}
        className="h-9 w-auto"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t('form.choose')}</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </NativeSelect>
    );
  }
  return (
    <Input
      aria-label={label}
      className="h-9 w-40"
      type={field === 'score' ? 'number' : 'text'}
      inputMode={field === 'score' ? 'numeric' : undefined}
      placeholder={op === 'in' ? t('form.listPlaceholder') : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
