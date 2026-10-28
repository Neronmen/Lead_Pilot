import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

/** Global: every module that changes settings writes to the change history. */
@Global()
@Module({
  controllers: [HistoryController],
  providers: [AuditService, HistoryService],
  exports: [AuditService],
})
export class AuditModule {}
