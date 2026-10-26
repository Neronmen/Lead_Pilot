import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Global: every module that changes settings writes to the change history. */
@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
