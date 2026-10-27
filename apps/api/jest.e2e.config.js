// e2e tests: test/**/*.e2e-spec.ts against the real docker-compose services.
/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  // The generated Prisma client imports './x.js' (ESM style); map it to the .ts source.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  // argon2 hashing and parallel files against one Postgres can pass Jest's 5 s default.
  testTimeout: 20_000,
  // On GitHub Actions, failures also become annotations on the run (readable without logging in).
  reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
};
