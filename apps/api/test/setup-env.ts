// Runs before each e2e test file. Real env vars (e.g. from CI) still win.
process.env.LOG_LEVEL ??= 'silent';
