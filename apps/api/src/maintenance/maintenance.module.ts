import { Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceWorker } from './maintenance.worker';

@Module({
  providers: [MaintenanceService, MaintenanceWorker],
  exports: [MaintenanceService, MaintenanceWorker],
})
export class MaintenanceModule {}
