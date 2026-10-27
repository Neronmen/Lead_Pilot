import { Module } from '@nestjs/common';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { ReviewService } from './review.service';

@Module({
  imports: [EnrichmentModule],
  controllers: [LeadsController],
  providers: [LeadsService, ReviewService],
})
export class LeadsModule {}
