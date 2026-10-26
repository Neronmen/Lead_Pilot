import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantPrisma } from './tenant-prisma.service';

@Global()
@Module({
  providers: [PrismaService, TenantPrisma],
  exports: [PrismaService, TenantPrisma],
})
export class PrismaModule {}
