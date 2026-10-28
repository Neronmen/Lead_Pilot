import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type HistoryPage,
  historyPageSchema,
  type ListHistoryQuery,
  listHistoryQuerySchema,
} from '@leadpilot/shared';
import { type AuthContext, CurrentAuth, MinRole } from '../auth/auth-context';
import { ApiZodResponse } from '../common/validation/zod-swagger';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { HistoryService } from './history.service';

/** Settings > Change history. Admin and Owner only. */
@ApiTags('history')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  @ApiOperation({
    summary: 'Who changed what, newest first (50 a page)',
    description:
      'Filter by `area`, `actor` and `days`. Pass `next` from a page as `before` for the next one.',
  })
  @ApiZodResponse(HttpStatus.OK, historyPageSchema, 'A page of changes')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(listHistoryQuerySchema)) query: ListHistoryQuery,
  ): Promise<HistoryPage> {
    return this.history.list(auth.workspaceId, query);
  }
}
