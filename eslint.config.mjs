// Shared flat config. Apps extend it (the web app adds Next.js rules).
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/generated/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Tenancy guard (CLAUDE.md): API code reaches tenant tables only through
  // TenantPrisma.for(workspaceId). The raw client and raw SQL bypass that
  // scope, so they are allowed only in the files listed in the next block.
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/prisma/prisma.service'],
              message:
                'Query tenant data through TenantPrisma.for(workspaceId). The raw PrismaService is allowlisted in eslint.config.mjs.',
            },
            {
              group: ['**/generated/prisma/client'],
              importNames: ['PrismaClient'],
              message:
                'Use TenantPrisma (or the allowlisted PrismaService), not a new PrismaClient.',
            },
            {
              group: ['@prisma/client', '@prisma/client/*', '**/generated/prisma/internal/*'],
              message: 'Import Prisma types from src/generated/prisma/client only.',
            },
          ],
        },
      ],
      // Dot access, computed access and destructuring of the raw-SQL methods,
      // plus a dynamic import of PrismaService. Anything more creative is
      // left to code review.
      'no-restricted-syntax': [
        'error',
        ...[
          'MemberExpression[property.name=/^\\$(queryRaw|executeRaw)/]',
          'MemberExpression[computed=true][property.value=/^\\$(queryRaw|executeRaw)/]',
          'MemberExpression[computed=true] > TemplateLiteral.property[quasis.0.value.raw=/^\\$(queryRaw|executeRaw)/]',
          'ObjectPattern > Property[key.name=/^\\$(queryRaw|executeRaw)/]',
        ].map((selector) => ({
          selector,
          message:
            'Raw SQL bypasses the workspace scope. It is allowlisted in eslint.config.mjs for reviewed files only.',
        })),
        {
          selector: 'ImportExpression[source.value=/prisma\\.service/]',
          message: 'Query tenant data through TenantPrisma.for(workspaceId).',
        },
      ],
    },
  },
  {
    // Allowlist, reviewed per entry:
    // - prisma/: defines PrismaService and the workspace scope itself.
    // - health/: `SELECT 1` readiness probe, touches no table.
    // - auth/: runs before a workspace is known (global users, a user's
    //   memberships across workspaces at login, the per-request guard).
    // - invites/invite-accept.service.ts: finds an invite by its token across
    //   workspaces, before the person has a session.
    files: [
      'apps/api/src/prisma/**/*.ts',
      'apps/api/src/health/**/*.ts',
      'apps/api/src/auth/auth.service.ts',
      'apps/api/src/auth/session.service.ts',
      'apps/api/src/auth/jwt-auth.guard.ts',
      'apps/api/src/invites/invite-accept.service.ts',
    ],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
  },
  prettier,
);
