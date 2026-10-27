/** The Redis connection BullMQ uses (separate from REDIS_CLIENT, see QueueModule). */
export const QUEUE_CONNECTION = Symbol('QUEUE_CONNECTION');
export const PIPELINE_QUEUE = 'pipeline';
export const MAINTENANCE_QUEUE = 'maintenance';
