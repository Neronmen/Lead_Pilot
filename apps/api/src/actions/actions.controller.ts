import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type ActionRun,
  actionRunSchema,
  type ListActionsQuery,
  listActionsQuerySchema,
} from '@leadpilot/shared';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, MinRole } from '../auth/auth-context';
import { ApiZodResponse } from '../common/validation/zod-swagger';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { ActionsService } from './actions.service';

/** What happened after leads were rated: sends, assignments, failures. Admin and Owner only. */
@ApiTags('actions')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('actions')
export class ActionsController {
  constructor(private readonly actions: ActionsService) {}

  @Get()
  @ApiOperation({ summary: 'Recent action runs, newest first (at most 100)' })
  @ApiZodResponse(HttpStatus.OK, z.array(actionRunSchema), 'Action runs')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(listActionsQuerySchema)) query: ListActionsQuery,
  ): Promise<ActionRun[]> {
    return this.actions.list(auth.workspaceId, query);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Try a failed action again',
    description: 'CONFLICT when the action did not fail.',
  })
  @ApiNoContentResponse({ description: 'Queued again' })
  retry(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.actions.retry(auth.workspaceId, id);
  }
}
