import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  type CreateInvitesRequest,
  type CreateInvitesResponse,
  createInvitesRequestSchema,
  createInvitesResponseSchema,
  type PendingInvite,
  pendingInviteSchema,
  type ResendInviteResponse,
  resendInviteResponseSchema,
} from '@leadpilot/shared';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, MinRole } from '../auth/auth-context';
import { ApiZodResponse, ZodBody } from '../common/validation/zod-swagger';
import { InvitesService } from './invites.service';
import { WorkspaceThrottlerGuard } from './workspace-throttler.guard';

/** Settings > Team: invite people and manage pending invites. Admin and Owner only. */
@ApiTags('invites')
@ApiBearerAuth()
@MinRole('ADMIN')
// Sending email is limited per workspace (see WorkspaceThrottlerGuard), on
// the routes that send: create and resend. Everything else is not throttled.
@UseGuards(WorkspaceThrottlerGuard)
@SkipThrottle({ default: true, refresh: true })
@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post()
  @ApiOperation({
    summary: 'Invite people by email as Admin or Member',
    description:
      'One result per distinct address: invited, already_member, already_invited or email_failed (the invite is saved; use Resend).',
  })
  @ApiZodResponse(HttpStatus.CREATED, createInvitesResponseSchema, 'One result per address')
  create(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(createInvitesRequestSchema) body: CreateInvitesRequest,
  ): Promise<CreateInvitesResponse> {
    return this.invites.create(auth, body.emails, body.role);
  }

  @Get()
  @SkipThrottle({ invites: true, invitesDay: true })
  @ApiOperation({ summary: 'Pending invites, newest first (expired ones included)' })
  @ApiZodResponse(HttpStatus.OK, z.array(pendingInviteSchema), 'Pending invites')
  list(@CurrentAuth() auth: AuthContext): Promise<PendingInvite[]> {
    return this.invites.list(auth.workspaceId);
  }

  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send the invite again with a new link; the old link stops working',
    description:
      'The old link dies at once, even if the new email fails (`email_failed`): resend again.',
  })
  @ApiZodResponse(HttpStatus.OK, resendInviteResponseSchema, 'invited or email_failed')
  resend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResendInviteResponse> {
    return this.invites.resend(auth, id);
  }

  @Delete(':id')
  @SkipThrottle({ invites: true, invitesDay: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a pending invite' })
  @ApiNoContentResponse({ description: 'Cancelled' })
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.invites.cancel(auth.workspaceId, id);
  }
}
