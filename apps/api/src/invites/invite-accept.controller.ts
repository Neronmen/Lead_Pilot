import { Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type AcceptInviteRequest,
  acceptInviteRequestSchema,
  type AuthSession,
  authSessionSchema,
  type InvitePreviewRequest,
  invitePreviewRequestSchema,
  type InvitePreviewResponse,
  invitePreviewResponseSchema,
} from '@leadpilot/shared';
import type { Response } from 'express';
import { Public } from '../auth/auth-context';
import { isSecureCookie, setRefreshCookie } from '../auth/refresh-cookie';
import { ApiZodResponse, ZodBody } from '../common/validation/zod-swagger';
import type { Env } from '../config/env.schema';
import { InviteAcceptService } from './invite-accept.service';

/**
 * The Accept invite page's API. Public (the person has no account or session
 * yet) and rate limited per IP like login: the token is 256 random bits, but
 * the password check on an existing account is still a guessing target.
 */
@ApiTags('invites')
@Public()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ refresh: true, invites: true, invitesDay: true })
@Controller('auth/invites')
export class InviteAcceptController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly accepting: InviteAcceptService,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookie = isSecureCookie(config.get('NODE_ENV', { infer: true }));
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'What an invite link is for (workspace, inviter, role, email)',
    description: 'INVITE_INVALID for an unknown, expired, cancelled or used link.',
  })
  @ApiZodResponse(HttpStatus.OK, invitePreviewResponseSchema, 'The invite')
  preview(
    @ZodBody(invitePreviewRequestSchema) body: InvitePreviewRequest,
  ): Promise<InvitePreviewResponse> {
    return this.accepting.preview(body.token);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an invite, join the workspace and sign in to it',
    description:
      'A new account sends `name` and a new `password`; an existing account sends its current `password` only.',
  })
  @ApiZodResponse(HttpStatus.OK, authSessionSchema, 'Signed in to the new workspace; cookie set')
  async accept(
    @ZodBody(acceptInviteRequestSchema) body: AcceptInviteRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const session = await this.accepting.accept(body);
    setRefreshCookie(res, session.refreshToken, this.secureCookie);
    return session.body;
  }
}
