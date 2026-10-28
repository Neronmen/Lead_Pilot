import { Module } from '@nestjs/common';
import { IngestModule } from '../ingest/ingest.module';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

@Module({ imports: [IngestModule], controllers: [SourcesController], providers: [SourcesService] })
export class SourcesModule {}
