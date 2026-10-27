import { Module } from '@nestjs/common';
import { IngestAuthService } from './ingest-auth.service';
import { IngestController } from './ingest.controller';
import { IngestLimits, IngestService } from './ingest.service';

@Module({
  controllers: [IngestController],
  providers: [IngestService, IngestAuthService, IngestLimits],
})
export class IngestModule {}
