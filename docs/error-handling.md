# Error handling

How the API reports problems, and how to add a new one. The rule behind all of it (SPEC §4.9): **the API returns codes and data, never text a person should read.** The web app turns each code into a message in the user's language.

## The one shape

Every error response has the same body:

```json
{ "error": { "code": "INVITE_INVALID", "message": "This invite link no longer works" } }
```

- `code`: stable, `UPPER_SNAKE_CASE`. Clients switch on it. Never rename one.
- `message`: English, for developers reading logs or Swagger. **Never show it to a user** and never translate it.
- `details`: optional, structured data the client needs (see validation below). It is left out when there is none.

One global filter ([global-exception.filter.ts](../apps/api/src/common/filters/global-exception.filter.ts)) produces this from anything thrown. Controllers and services do not build error bodies.

## Throwing an error

Services throw a `DomainError(code, message, status, details?)`:

```ts
throw new DomainError(ErrorCode.NOT_FOUND, 'Member not found', HttpStatus.NOT_FOUND);
```

- Put the code in `packages/shared/src/errors.ts` (`ErrorCode`) so the web app can use it, and add a comment saying when it happens.
- Small modules keep factory functions next to them (`auth/auth.errors.ts`) so the message and status are written once.
- Choose the status by what the client should do: `400` fix the input, `401` sign in again, `403` not allowed for your role, `404` not there (also for another workspace's id, so an id's existence does not leak), `409` conflicts with the current state, `429` slow down.

### 5xx and `message`

A `DomainError` with a status of 500 or more **passes its `message` to the client** (a deliberate 503, for example). Anything else that fails with a 5xx keeps its status (a 503 tells clients to retry) but its message is replaced by a generic `Internal server error`, and the real error is logged.

So: **never put internals in the message of a 5xx `DomainError`** (no SQL, hostnames, ids, file paths). If you are unsure, throw a plain `Error` and let the filter hide it.

## Validation errors

Request bodies are checked with a shared zod schema through `@ZodBody(schema)`. A failure is `400 VALIDATION_FAILED` with one entry per problem in `details`:

```json
{ "path": "password", "code": "too_small", "origin": "string", "minimum": 12 }
```

`path` is the dotted field path (`emails.2`; empty for the whole body), `code` is zod's issue code, and the rest are the limits and names a form needs. There is no English text in `details`: the web form maps `code` plus `path` to its own translated sentence. A check of ours (not zod's) appears as `code: "custom"` with `format` naming it, for example `format: "unknown_tld"` for an email ending that is not a real top-level domain.

The same function (`toValidationIssues` in `@leadpilot/shared`) is used by the API and by web forms, so both describe a problem the same way.

## Prisma errors

Errors a request can cause by itself are mapped to codes; their own text names tables and columns, so it never reaches the client:

| Prisma | Response |
|---|---|
| `P2002` unique violation | `409 CONFLICT` |
| `P2003` foreign key violation | `409 CONFLICT` ("still in use") |
| `P2025` record not found | `404 NOT_FOUND` |

Anything else from Prisma is a bug and becomes `500 INTERNAL`. Services should not rely on `P2003` for ids that come from a request: look the id up through the workspace-scoped client first and throw a domain `NOT_FOUND` or `VALIDATION_FAILED` error, so a missing or foreign id never reaches the database as a foreign key error.

## The shared codes

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | The input does not match its schema (details say which fields) |
| `UNAUTHORIZED` | 401 | A Nest-level 401 with no more specific code |
| `FORBIDDEN` | 403 | The role is not allowed to do this |
| `NOT_FOUND` | 404 | Not there, or in another workspace |
| `CONFLICT` | 409 | Clashes with the current state (a duplicate, still in use) |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL` | 500 | Something unexpected; the cause is in the logs |

Modules add their own (`INVITE_INVALID`, `OWNER_IMMUTABLE`, ...): all are listed in `packages/shared/src/errors.ts`.

## Email addresses

Addresses are trimmed and lowercased, must be well formed, and must end in a **real top-level domain** (`.cmo` and `.test` are refused with `format: "unknown_tld"`). The list is a snapshot of the IANA root zone from the `tlds` package, kept in `packages/shared/src/tlds.ts`; refresh it when bumping `tlds` (`pnpm --filter @leadpilot/shared tlds`). Internationalised (`xn--`) endings and non-ASCII addresses are refused. No DNS or MX lookup is done. **Sign-in does not apply this check**: it only normalises the address, so an account created before a rule changed can still sign in.

## Control characters

Every free-text field in `packages/shared` refuses control characters (`displayTextSchema` for names, the email check, the login address): Postgres text cannot hold a NUL byte, and a line break in a name could inject an email header. **Passwords are the one deliberate exception**: they may contain any character, because they are only hashed with argon2 and never stored as text. They are capped at 128 characters (512 bytes at most) so a huge password cannot be used to make argon2 burn memory and time. Any new free-text field must use `displayTextSchema` or an equivalent.

## Auth errors, at a glance

| Code | Status | Meaning for the client |
|---|---|---|
| `AUTH_INVALID_CREDENTIALS` | 401 | Wrong email or password (the same answer for both) |
| `AUTH_SESSION_EXPIRED` | 401 | No usable session: refresh once, else sign in again |
| `AUTH_REFRESH_REUSED` | 401 | A copied refresh token was used: every session of that sign-in is revoked |
| `AUTH_NO_WORKSPACE` | 403 | The account belongs to no workspace |
| `FORBIDDEN` | 403 | The role is not allowed to do this |
| `RATE_LIMITED` | 429 | Too many requests; a 429 on refresh means "retry later", not "signed out" |

## Logging errors

Unexpected errors (5xx) are logged once by the filter with the request id and, for signed-in requests, `workspaceId` and `userId`. Expected errors (4xx) are not logged as errors. Never log secrets, tokens, passwords or the body of a request; the logger redacts secret-looking keys as a last defence, not as a license.
