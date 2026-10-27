import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type LeadList,
  leadListSchema,
  type ListLeadsQuery,
  listLeadsQuerySchema,
} from '@leadpilot/shared';
import { type AuthContext, CurrentAuth } from '../auth/auth-context';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { ApiZodResponse } from '../common/validation/zod-swagger';
import { LeadsService } from './leads.service';

/** The Leads list. Every member of the workspace can read it. */
@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @ApiOperation({ summary: 'Leads, newest first, with filters, search and paging' })
  @ApiZodResponse(200, leadListSchema, 'One page of leads')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(listLeadsQuerySchema)) query: ListLeadsQuery,
  ): Promise<LeadList> {
    return this.leads.list(auth.workspaceId, query);
  }
}
