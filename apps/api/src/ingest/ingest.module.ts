import { Module } from '@nestjs/common';
import { WINDOW_STORE } from '../redis/redis.tokens';
import { IngestAuthService } from './ingest-auth.service';
import { IngestController } from './ingest.controller';
import { IngestLimits, IngestService } from './ingest.service';
import type { WindowStore } from './rate-limiter';

@Module({
  controllers: [IngestController],
  providers: [
    IngestService,
    IngestAuthService,
    // The counters live in Redis, so every API instance counts together.
    {
      provide: IngestLimits,
      inject: [WINDOW_STORE],
      useFactory: (store: WindowStore) => new IngestLimits(store),
    },
  ],
  exports: [IngestService],
})
export class IngestModule {}
