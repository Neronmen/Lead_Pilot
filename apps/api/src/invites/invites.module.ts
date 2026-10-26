import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InviteAcceptController } from './invite-accept.controller';
import { InviteAcceptService } from './invite-accept.service';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  imports: [AuthModule],
  controllers: [InvitesController, InviteAcceptController],
  providers: [InvitesService, InviteAcceptService],
})
export class InvitesModule {}
