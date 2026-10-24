import { z } from 'zod';

export const healthCheckSchema = z.object({
  status: z.enum(['up', 'down']),
  message: z.string().optional(),
});

/** Response of `GET /health/live` and `GET /health/ready`. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.record(z.string(), healthCheckSchema),
});

export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
