import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import {
  type AuthSession,
  authSessionSchema,
  type LoginRequest,
  loginRequestSchema,
  type MeResponse,
  meResponseSchema,
  type SignupRequest,
  signupRequestSchema,
  type UpdateMeRequest,
  updateMeRequestSchema,
} from '@leadpilot/shared';
import type { Request, Response } from 'express';
import { DomainError } from '../common/errors/domain-error';
import { ApiZodResponse, ZodBody } from '../common/validation/zod-swagger';
import type { Env } from '../config/env.schema';
import { type AuthContext, CurrentAuth, Public } from './auth-context';
import { sessionExpired } from './auth.errors';
import { AuthService } from './auth.service';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';
import type { IssuedSession } from './session.service';
import { SessionService } from './session.service';

/** Sign-up, sign-in and the signed-in user. Rate limited per IP (SPEC §4.8). */
@ApiTags('auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
// Two budgets: `default` for password guessing (signup, login, accept invite)
// and a higher `refresh` one, since every page load refreshes.
@SkipThrottle({ refresh: true })
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookie = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Create a workspace and its owner, and sign in' })
  @ApiZodResponse(HttpStatus.CREATED, authSessionSchema, 'Signed in; refresh cookie set')
  async signup(
    @ZodBody(signupRequestSchema) body: SignupRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    return this.startSession(res, await this.auth.signup(body));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in to the most recently used workspace' })
  @ApiZodResponse(HttpStatus.OK, authSessionSchema, 'Signed in; refresh cookie set')
  async login(
    @ZodBody(loginRequestSchema) body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    return this.startSession(res, await this.auth.login(body));
  }

  @Public()
  @SkipThrottle({ default: true, refresh: false })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Swap the refresh cookie for a new access token (and a new cookie)',
    description:
      'A refresh token that was already swapped revokes every session of that sign-in (AUTH_REFRESH_REUSED).',
  })
  @ApiZodResponse(HttpStatus.OK, authSessionSchema, 'New session; refresh cookie replaced')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSession> {
    const token = readRefreshCookie(req);
    if (!token) throw sessionExpired();
    try {
      return this.startSession(res, await this.sessions.rotate(token));
    } catch (error) {
      // A cookie that no longer works is cleared, so the browser stops sending
      // it. A server error keeps it: the client can retry with the same token.
      if (error instanceof DomainError && error.status === HttpStatus.UNAUTHORIZED) {
        clearRefreshCookie(res, this.secureCookie);
      }
      throw error;
    }
  }

  @Public()
  @SkipThrottle({ default: true, refresh: true })
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out: revoke this sign-in on every tab, clear the cookie' })
  @ApiNoContentResponse({ description: 'Signed out (also when there was no session)' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = readRefreshCookie(req);
    if (token) await this.sessions.revoke(token);
    clearRefreshCookie(res, this.secureCookie);
  }

  @SkipThrottle({ default: true, refresh: true })
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in user, their workspace and role' })
  @ApiZodResponse(HttpStatus.OK, meResponseSchema, 'The signed-in user')
  me(@CurrentAuth() auth: AuthContext): Promise<MeResponse> {
    return this.auth.me(auth.userId, auth.workspaceId);
  }

  @SkipThrottle({ default: true, refresh: true })
  @Patch('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Save the user's language (null: follow the workspace)" })
  @ApiZodResponse(HttpStatus.OK, meResponseSchema, 'The updated user')
  updateMe(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(updateMeRequestSchema) body: UpdateMeRequest,
  ): Promise<MeResponse> {
    return this.auth.updateMe(auth.userId, auth.workspaceId, body);
  }

  private startSession(res: Response, session: IssuedSession): AuthSession {
    setRefreshCookie(res, session.refreshToken, this.secureCookie);
    return session.body;
  }
}
