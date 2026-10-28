import { Module } from '@nestjs/common';
import { ActionsController } from './actions.controller';
import { ActionsQueue } from './actions.queue';
import { ActionsService } from './actions.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { ActionTransport } from './transport';

/** What happens after a lead is rated: the runs behind the routing rules, and the tools they call. */
@Module({
  controllers: [IntegrationsController, ActionsController],
  providers: [ActionTransport, ActionsQueue, ActionsService, IntegrationsService],
  exports: [ActionsService, ActionTransport],
})
export class ActionsModule {}
