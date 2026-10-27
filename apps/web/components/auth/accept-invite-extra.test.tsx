// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { StrictMode, type ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { resetInviteTokenForTests } from '@/lib/invite/token';
import en from '@/messages/en.json';
import vi_ from '@/messages/vi.json';
import { AcceptInvite } from './accept-invite';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';
const t = en.auth.invite;

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
  usePathname: () => '/invite',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const client = { request: vi.fn(), acceptInvite: vi.fn() };
vi.mock('@/lib/auth/auth-provider', () => ({
  useAuthClient: () => client,
  ME_QUERY_KEY: ['me'],
}));

const preview = (over: Record<string, unknown> = {}) => ({
  workspaceName: 'Northstar Growth',
  inviterName: 'Mia Johnson',
  role: 'MEMBER' as const,
  email: 'ethan.brooks@northstargrowth.com',
  expiresAt: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(),
  accountExists: false,
  ...over,
});
const me = (email: string) => ({
  user: { id: '11111111-1111-4111-8111-111111111111', email, name: 'X', locale: null },
  workspace: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'W',
    slug: 'w',
    defaultLocale: 'en',
    currency: 'USD',
    timezone: 'UTC',
    defaultCountry: null,
  },
  role: 'MEMBER',
});

function wrap(
  queryClient: QueryClient,
  strict: boolean,
  messages: unknown = en,
  locale: 'en' | 'vi' = 'en',
) {
  const tree = (
    <NextIntlClientProvider locale={locale} messages={messages as typeof en} timeZone="UTC">
      <QueryClientProvider client={queryClient}>
        <AcceptInvite />
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
  return strict ? <StrictMode>{tree}</StrictMode> : tree;
}
function setup(
  strict = true,
  hash = `#t=${TOKEN}`,
  messages: unknown = en,
  locale: 'en' | 'vi' = 'en',
) {
  window.history.replaceState({}, '', `/invite${hash}`);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { queryClient, ...render(wrap(queryClient, strict, messages, locale)) };
}
const previews = () => client.request.mock.calls.filter(([p]) => p === '/auth/invites/preview');
const submit = () => fireEvent.submit(document.querySelector('form')!);
const fillNew = () => {
  fireEvent.change(screen.getByLabelText(t.name), { target: { value: 'Ethan Brooks' } });
  fireEvent.change(screen.getByLabelText(t.newPassword), {
    target: { value: 'correct-horse-battery-9' },
  });
};

beforeEach(() => {
  resetInviteTokenForTests();
  replace.mockReset();
  client.request.mockReset();
  client.acceptInvite.mockReset();
  client.request.mockImplementation(async (path: string) => {
    if (path === '/auth/invites/preview') return preview();
    return me('ethan.brooks@northstargrowth.com');
  });
  client.acceptInvite.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
});

describe.each([[true], [false]])('extra behaviour (strict=%s)', (strict) => {
  it('does not refetch the preview on window focus or tab visibility', async () => {
    setup(strict);
    await screen.findByLabelText(t.name);
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(previews()).toHaveLength(1);
  });

  it('password field: masked, right autocomplete, never in the URL, form posts', async () => {
    const { container } = setup(strict);
    const password = (await screen.findByLabelText(t.newPassword)) as HTMLInputElement;
    expect(password.type).toBe('password');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText(t.name)).toHaveAttribute('autocomplete', 'name');
    const form = container.querySelector('form')!;
    expect(form.getAttribute('method')?.toLowerCase()).toBe('post');
    fireEvent.change(password, { target: { value: 'correct-horse-battery-9' } });
    expect(window.location.href).not.toContain('correct-horse');
  });

  it('existing account: current-password autocomplete and no name field', async () => {
    client.request.mockImplementation(async () => preview({ accountExists: true }));
    setup(strict);
    const pw = await screen.findByLabelText(t.existingPassword);
    expect(pw).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByLabelText(t.name)).toBeNull();
  });

  it('the email is read-only but focusable, and described by its hint', async () => {
    setup(strict);
    const email = (await screen.findByLabelText(t.email)) as HTMLInputElement;
    expect(email).toHaveAttribute('readonly');
    expect(email).not.toBeDisabled();
    expect(email).toHaveAttribute('autocomplete', 'username');
    email.focus();
    expect(document.activeElement).toBe(email);
    const describedBy = email.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!.split(' ')[0]!)).toHaveTextContent(t.emailHint);
  });

  it.each([['MEMBER'], ['ADMIN']] as const)('shows the role help for %s', async (role) => {
    client.request.mockImplementation(async () => preview({ role }));
    setup(strict);
    await screen.findByLabelText(t.name);
    expect(screen.getByText(t.roleHelp[role], { exact: false })).toBeInTheDocument();
    expect(screen.getByText(en.shell.roles[role])).toBeInTheDocument();
  });

  it('has exactly one h1 in the form and in the invalid state', async () => {
    setup(strict);
    expect(await screen.findAllByRole('heading', { level: 1 })).toHaveLength(1);
    cleanup();
    resetInviteTokenForTests();
    setup(strict, '');
    expect(await screen.findAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('the loading card has no heading but is announced as a status', () => {
    client.request.mockImplementation(() => new Promise(() => {}));
    setup(strict);
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy');
    expect(screen.getByText(t.loading)).toBeInTheDocument();
  });

  // The retry state (preview failed for a non-INVITE_INVALID reason) is the only invite
  // state with no heading: a screen-reader user landing here finds no page title.
  it('the retryable error state has an h1 as well', async () => {
    client.request.mockRejectedValue(new ApiError(503, 'INTERNAL', 'x'));
    setup(strict);
    await screen.findByText(en.errors.INTERNAL);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('many submits in a row send one accept request', async () => {
    let finish!: () => void;
    client.acceptInvite.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    setup(strict);
    await screen.findByLabelText(t.name);
    fillNew();
    submit();
    submit();
    submit();
    expect(client.acceptInvite).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: t.submitting })).toBeDisabled();
    finish();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/leads'));
  });

  it('EMAIL_TAKEN: name field goes, password is cleared, preview refetched once', async () => {
    let n = 0;
    client.request.mockImplementation(async (p: string) =>
      p === '/auth/invites/preview' ? preview({ accountExists: n++ > 0 }) : me('a@b.co'),
    );
    client.acceptInvite.mockRejectedValueOnce(new ApiError(409, 'EMAIL_TAKEN', 'x'));
    setup(strict);
    await screen.findByLabelText(t.name);
    fillNew();
    submit();
    const pw = (await screen.findByLabelText(t.existingPassword)) as HTMLInputElement;
    expect(pw.value).toBe('');
    expect(screen.queryByLabelText(t.name)).toBeNull();
    expect(screen.getByText(t.accountAppeared)).toBeInTheDocument();
    expect(previews()).toHaveLength(2);
  });

  it('a second EMAIL_TAKEN on the existing-account form does not crash or loop', async () => {
    client.request.mockImplementation(async (p: string) =>
      p === '/auth/invites/preview' ? preview({ accountExists: true }) : me('a@b.co'),
    );
    client.acceptInvite.mockRejectedValue(new ApiError(409, 'EMAIL_TAKEN', 'x'));
    setup(strict);
    const pw = await screen.findByLabelText(t.existingPassword);
    fireEvent.change(pw, { target: { value: 'some-password-1' } });
    submit();
    await waitFor(() => expect(previews()).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(previews()).toHaveLength(2);
    expect(screen.getByRole('button', { name: t.submit })).toBeEnabled();
  });

  it('accepting while another person is signed in replaces the cached me', async () => {
    const { queryClient } = setup(strict);
    queryClient.setQueryData(['me'], me('old.user@other.com'));
    await screen.findByLabelText(t.name);
    fillNew();
    submit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/leads'));
    expect((queryClient.getQueryData(['me']) as ReturnType<typeof me>).user.email).toBe(
      'ethan.brooks@northstargrowth.com',
    );
  });

  // Source gap: finishSignIn only overwrites ['me']; every other query of the old user
  // (leads, team...) stays in the shared QueryClient and may show to the new session.
  it("accepting drops the previous person's other cached data", async () => {
    const { queryClient } = setup(strict);
    queryClient.setQueryData(['leads', 'list'], [{ id: 'old-user-lead' }]);
    await screen.findByLabelText(t.name);
    fillNew();
    submit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/leads'));
    expect(queryClient.getQueryData(['leads', 'list'])).toBeUndefined();
  });

  it('the query keys never contain the token', async () => {
    const { queryClient } = setup(strict);
    await screen.findByLabelText(t.name);
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => JSON.stringify(q.queryKey));
    expect(keys.join()).not.toContain(TOKEN);
  });
});

describe('expires wording', () => {
  const cases: [string, number, RegExp][] = [
    ['6 days', 6 * 24 * 3600e3 + 60e3, /in 6 days/],
    ['3 hours', 3 * 3600e3 + 60e3, /in 3 hours/],
    ['10 minutes', 10 * 60e3 + 5e3, /in 10 minutes/],
    ['already past', -2 * 3600e3, /2 hours ago/],
  ];
  it.each(cases)('%s', async (_n, ms, pattern) => {
    client.request.mockImplementation(async () =>
      preview({ expiresAt: new Date(Date.now() + ms).toISOString() }),
    );
    setup(true);
    await screen.findByLabelText(t.name);
    expect(screen.getByText(/^Expires /)).toHaveTextContent(pattern);
  });

  it('in Vietnamese the wording is Vietnamese', async () => {
    setup(true, `#t=${TOKEN}`, vi_, 'vi');
    await screen.findByLabelText(vi_.auth.invite.name);
    expect(screen.getByText(/^Hết hạn /)).toHaveTextContent(/ngày/);
  });
});

describe('server render and hydration', () => {
  it('the server snapshot is the loading card and starts no request', () => {
    window.history.replaceState({}, '', `/invite#t=${TOKEN}`);
    const html = renderToString(wrap(new QueryClient(), false));
    expect(html).toContain('role="status"');
    expect(html).toContain(t.loading);
    expect(client.request).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(`#t=${TOKEN}`);
  });

  it('hydrating the server markup raises no mismatch and then shows the form', async () => {
    window.history.replaceState({}, '', `/invite#t=${TOKEN}`);
    const html = renderToString(wrap(new QueryClient(), false));
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, wrap(new QueryClient(), false));
    });
    await waitFor(() => expect(container.querySelector('input[name="email"]')).not.toBeNull());
    const logged = errors.mock.calls.map((c) => String(c[0]));
    expect(logged.filter((m) => !m.includes('ENVIRONMENT_FALLBACK'))).toEqual([]);
    expect(window.location.hash).toBe('');
    act(() => root.unmount());
    container.remove();
    errors.mockRestore();
  });
});

// Source gap: the expiry line calls format.relativeTime(date) without `now`, so next-intl
// reports ENVIRONMENT_FALLBACK to onError (console.error in dev). Pass `now` (or set it
// globally in the provider).
describe('relative time', () => {
  it('does not trigger the next-intl ENVIRONMENT_FALLBACK error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup(false);
    await screen.findByLabelText(t.name);
    const logged = errors.mock.calls.map((c) => String(c[0]));
    errors.mockRestore();
    expect(logged.filter((m) => m.includes('ENVIRONMENT_FALLBACK'))).toEqual([]);
  });
});

describe('client side navigation', () => {
  it('leaving by the sign-in link and coming back keeps the form (token in memory)', async () => {
    const first = setup(true);
    await screen.findByLabelText(t.name);
    expect(screen.getByRole('link', { name: t.signIn })).toHaveAttribute('href', '/login');
    const { queryClient } = first;
    first.unmount();
    render(wrap(queryClient, true));
    expect(await screen.findByLabelText(t.name)).toBeInTheDocument();
    expect(previews()).toHaveLength(1);
  });
});
