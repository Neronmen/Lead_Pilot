import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import base from '../../eslint.config.mjs';

const config = [
  ...base,
  ...nextVitals,
  ...nextTs,
  { ignores: ['.next/**', '.next-e2e/**', 'next-env.d.ts'] },
  // No hard-coded user-facing text (SPEC 4.9): words go through next-intl.
  // Internal pages, shadcn primitives and tests are exempt (CLAUDE.md).
  {
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    ignores: ['app/status/**', 'app/dev/**', 'components/ui/**', '**/*.test.tsx'],
    rules: {
      'react/jsx-no-literals': [
        'error',
        { noStrings: false, allowedStrings: [], ignoreProps: true },
      ],
    },
  },
  prettier,
];

export default config;
