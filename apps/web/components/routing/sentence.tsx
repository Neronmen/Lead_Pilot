'use client';

import type {
  Condition,
  ConditionGroup,
  InnerConditionGroup,
  RoutingRule,
} from '@leadpilot/shared';
import { useTranslations } from 'next-intl';
import { useMembers } from '@/lib/team/use-team';
import { useSources } from '@/lib/sources/use-sources';
import { useIntegrations } from '@/lib/routing/use-routing';
import { actionKind } from '@/lib/routing/draft';

/**
 * Turns a rule into the sentence the design shows ("If tier is Hot and country is US → assign to
 * Mia, email the owner"). Names of people, sources and tools are looked up from the lists the page
 * already loads; a name that is not found falls back to a plain word, so a sentence never breaks.
 */
export function useDescribe() {
  const t = useTranslations('routing');
  const tiers = useTranslations('tiers');
  const members = useMembers();
  const sources = useSources();
  const integrations = useIntegrations();

  const person = (id: string) => {
    const found = members.data?.find((m) => m.userId === id);
    return found ? found.name || found.email : t('somebody');
  };
  const sourceName = (id: string) => sources.data?.find((s) => s.id === id)?.name ?? t('aSource');
  const toolName = (id: string) => integrations.data?.find((i) => i.id === id)?.name ?? t('aTool');

  function value(condition: Condition): string {
    const one = (v: string | number | boolean): string => {
      if (condition.field === 'tier') return tiers(String(v).toUpperCase() as 'HOT');
      if (condition.field === 'isFreeMail') return v === true ? t('yes') : t('no');
      if (condition.field === 'source') return sourceName(String(v));
      return String(v);
    };
    return Array.isArray(condition.value)
      ? condition.value.map(one).join(', ')
      : one(condition.value);
  }

  function condition(c: Condition): string {
    return t('cond', {
      field: c.field === 'custom' ? (c.key ?? '') : t(`field.${c.field}`).toLocaleLowerCase(),
      op: t(`op.${c.op}`),
      value: value(c),
    });
  }

  function group(g: ConditionGroup | InnerConditionGroup): string {
    const parts = g.conditions.map((item) =>
      'match' in item ? `(${group(item)})` : condition(item),
    );
    return parts.join(g.match === 'all' ? t('joinAll') : t('joinAny'));
  }

  function action(a: RoutingRule['actions'][number]): string {
    const { kind, target } = actionKind(a);
    const name =
      kind === 'assign'
        ? person(target)
        : kind === 'tag'
          ? target
          : ['slack', 'telegram', 'webhook', 'hubspot'].includes(kind)
            ? toolName(target)
            : '';
    return t(`act.${kind}`, { name });
  }

  function rule(r: Pick<RoutingRule, 'conditions' | 'actions'>): string {
    return t('sentence', {
      conditions: r.conditions.conditions.length === 0 ? t('everyLead') : group(r.conditions),
      actions: r.actions.map(action).join(', '),
    });
  }

  return { condition, action, rule };
}
