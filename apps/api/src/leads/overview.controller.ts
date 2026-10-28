import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Overview, overviewSchema } from '@leadpilot/shared';
import { type AuthContext, CurrentAuth } from '../auth/auth-context';
import { ApiZodResponse } from '../common/validation/zod-swagger';
import { OverviewService } from './overview.service';

/** Numbers for the Overview page. Every member of the workspace can read them. */
@ApiTags('overview')
@ApiBearerAuth()
@Controller('overview')
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get()
  @ApiOperation({
    summary:
      'Last 30 days: junk filtered, time to first rating, leads by tier and information level',
  })
  @ApiZodResponse(HttpStatus.OK, overviewSchema, 'The numbers')
  get(@CurrentAuth() auth: AuthContext): Promise<Overview> {
    return this.overview.get(auth.workspaceId);
  }
}
