// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { resetInviteTokenForTests } from '@/lib/invite/token';
import en from '@/messages/en.json';
import vi_ from '@/messages/vi.json';
import { AcceptInvite } from './accept-invite';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';

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

/** A stand-in for the auth client: what the page asks of the API, and what it answers. */
const client = {
  request: vi.fn(),
  acceptInvite: vi.fn(),
};
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

function setup(options: {
  strict: boolean;
  messages?: typeof en;
  locale?: 'en' | 'vi';
  hash?: string;
}) {
  window.history.replaceState({}, '', `/invite${options.hash ?? `#t=${TOKEN}`}`);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <NextIntlClientProvider
      locale={options.locale ?? 'en'}
      messages={options.messages ?? en}
      timeZone="UTC"
    >
      <QueryClientProvider client={queryClient}>
        <AcceptInvite />
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
  return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const previewCalls = () =>
  client.request.mock.calls.filter(([path]) => path === '/auth/invites/preview');

beforeEach(() => {
  resetInviteTokenForTests();
  replace.mockReset();
  client.request.mockReset();
  client.acceptInvite.mockReset();
  client.request.mockImplementation(async (path: string) => {
    if (path === '/auth/invites/preview') return preview();
    throw new ApiError(500, 'INTERNAL', 'not needed here'); // /auth/me: ignored by the page
  });
  client.acceptInvite.mockResolvedValue(undefined);
});
afterEach(cleanup);

// The same scenarios with and without StrictMode (which mounts every component twice, as
// `next dev` does): the page must behave identically.
describe.each([
  ['without StrictMode', false],
  ['under StrictMode', true],
])('Accept invite %s', (_name, strict) => {
  it('reads the token once, clears the address, previews once and shows the invite', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    setup({ strict });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Join Northstar Growth',
    );
    expect(window.location.hash).toBe('');
    // One clean-up of the address, one preview request, with the token in the body only.
    expect(replaceState.mock.calls.filter(([, , url]) => url === '/invite')).toHaveLength(1);
    expect(previewCalls()).toHaveLength(1);
    expect(previewCalls()[0]![1]).toMatchObject({ body: { token: TOKEN }, anonymous: true });
    expect(JSON.stringify(client.request.mock.calls.map(([path]) => path))).not.toContain(TOKEN);
    expect(screen.getByLabelText('Email')).toHaveValue('ethan.brooks@northstargrowth.com');
    expect(screen.getByText(/Expires in 6 days/)).toBeInTheDocument();
  });

  it('accepts as a new person: sends name and password with the token, then opens the app', async () => {
    setup({ strict });
    await screen.findByRole('heading', { level: 1 });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ethan Brooks' } });
    fireEvent.change(screen.getByLabelText('Choose a password'), {
      target: { value: 'correct-horse-battery-9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Accept invite and continue' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/leads'));
    expect(client.acceptInvite).toHaveBeenCalledTimes(1);
    expect(client.acceptInvite).toHaveBeenCalledWith({
      token: TOKEN,
      name: 'Ethan Brooks',
      password: 'correct-horse-battery-9',
    });
  });

  it('accepts as an existing account: only the password goes with the token', async () => {
    client.request.mockImplementation(async (path: string) => {
      if (path === '/auth/invites/preview') return preview({ accountExists: true });
      throw new ApiError(500, 'INTERNAL', 'x');
    });
    setup({ strict });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByLabelText('Full name')).toBeNull();
    fireEvent.change(screen.getByLabelText('Your password'), {
      target: { value: 'my-old-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Accept invite and continue' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/leads'));
    expect(client.acceptInvite).toHaveBeenCalledWith({ token: TOKEN, password: 'my-old-password' });
  });

  it('explains empty fields without calling the API', async () => {
    setup({ strict });
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Accept invite and continue' }));
    expect(await screen.findAllByText('This field is required.')).toHaveLength(1); // the name
    expect(screen.getByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(client.acceptInvite).not.toHaveBeenCalled();
  });

  it('a wrong password says so, keeps the form, and warns about the limit', async () => {
    client.request.mockImplementation(async (path: string) => {
      if (path === '/auth/invites/preview') return preview({ accountExists: true });
      throw new ApiError(500, 'INTERNAL', 'x');
    });
    client.acceptInvite.mockRejectedValue(new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'x'));
    setup({ strict });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/After 5 wrong passwords/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept invite and continue' }));
    expect(await screen.findByText('That password is not right.')).toBeInTheDocument();
    expect(screen.getByText(/After 5 wrong passwords/)).toBeInTheDocument();
    expect(screen.getByLabelText('Your password')).toHaveValue('nope');
    expect(replace).not.toHaveBeenCalled();
  });

  it('INVITE_INVALID while accepting (after wrong passwords) shows the expired card and why', async () => {
    client.request.mockImplementation(async (path: string) => {
      if (path === '/auth/invites/preview') return preview({ accountExists: true });
      throw new ApiError(500, 'INTERNAL', 'x');
    });
    client.acceptInvite
      .mockRejectedValueOnce(new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'x'))
      .mockRejectedValueOnce(new ApiError(400, 'INVITE_INVALID', 'x'));
    setup({ strict });
    await screen.findByRole('heading', { level: 1 });
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept invite and continue' }));
    await screen.findByText('That password is not right.');
    fireEvent.click(screen.getByRole('button', { name: 'Accept invite and continue' }));
    expect(await screen.findByText('This invite link no longer works')).toBeInTheDocument();
    expect(screen.getByText(/also expires after 5 wrong passwords/)).toBeInTheDocument();
  });

  it('EMAIL_TAKEN while accepting turns the form into "enter your password"', async () => {
    let calls = 0;
    client.request.mockImplementation(async (path: string) => {
      if (path === '/auth/invites/preview') return preview({ accountExists: calls++ > 0 });
      throw new ApiError(500, 'INTERNAL', 'x');
    });
    client.acceptInvite.mockRejectedValueOnce(new ApiError(409, 'EMAIL_TAKEN', 'x'));
    setup({ strict });
    await screen.findByRole('heading', { level: 1 });
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ethan' } });
    fireEvent.change(screen.getByLabelText('Choose a password'), {
      target: { value: 'correct-horse-battery-9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Accept invite and continue' }));
    expect(await screen.findByLabelText('Your password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).toBeNull();
    expect(screen.getByText(/now exists/)).toBeInTheDocument();
    // The token is still in memory for the retry.
    expect(previewCalls()).toHaveLength(2);
    expect(previewCalls()[1]![1]).toMatchObject({ body: { token: TOKEN } });
  });

  it('shows the expired card for INVITE_INVALID from the preview', async () => {
    client.request.mockRejectedValue(new ApiError(400, 'INVITE_INVALID', 'x'));
    setup({ strict });
    expect(await screen.findByText('This invite link no longer works')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Already a member? Sign in' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('shows the expired card without any request when the address has no token', async () => {
    setup({ strict, hash: '' });
    expect(await screen.findByText('This invite link no longer works')).toBeInTheDocument();
    expect(client.request).not.toHaveBeenCalled();
  });

  it('offers a retry when the preview fails for another reason', async () => {
    client.request.mockRejectedValueOnce(new ApiError(503, 'INTERNAL', 'x'));
    setup({ strict });
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Join Northstar Growth')).toBeInTheDocument();
  });

  it('is in Vietnamese when the page is', async () => {
    setup({ strict, messages: vi_ as unknown as typeof en, locale: 'vi' });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Tham gia Northstar Growth',
    );
    expect(
      screen.getByRole('button', { name: 'Chấp nhận lời mời và tiếp tục' }),
    ).toBeInTheDocument();
  });
});

describe('the address', () => {
  it('never keeps the token once the page has read it, even if it renders again', async () => {
    const { rerender } = setup({ strict: true });
    await screen.findByRole('heading', { level: 1 });
    rerender(<div />);
    expect(window.location.href).not.toContain(TOKEN);
  });
});
