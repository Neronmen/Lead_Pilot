import { Module } from '@nestjs/common';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { RoutingModule } from '../routing/routing.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';
import { ReviewService } from './review.service';

@Module({
  imports: [EnrichmentModule, RoutingModule],
  controllers: [LeadsController, OverviewController],
  providers: [LeadsService, ReviewService, OverviewService],
})
export class LeadsModule {}
