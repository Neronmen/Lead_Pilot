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
  type LeadDetail,
  leadDetailSchema,
  type LeadList,
  leadListSchema,
  type ListLeadsQuery,
  listLeadsQuerySchema,
  type RescoreRequest,
  rescoreRequestSchema,
  type RescoreResponse,
  rescoreResponseSchema,
  type ReviewLeadRequest,
  reviewLeadRequestSchema,
  type SetOutcomeRequest,
  setOutcomeRequestSchema,
} from '@leadpilot/shared';
import { type AuthContext, CurrentAuth, MinRole } from '../auth/auth-context';
import { ApiZodResponse, ZodBody } from '../common/validation/zod-swagger';
import { ZodValidationPipe } from '../common/validation/zod-validation.pipe';
import { LeadsService } from './leads.service';
import { ReviewService } from './review.service';

/** The Leads list, a lead's page and the review of the AI's rating. Every member can use them. */
@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly review: ReviewService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Leads, newest first, with filters, search and paging' })
  @ApiZodResponse(HttpStatus.OK, leadListSchema, 'One page of leads')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(listLeadsQuerySchema)) query: ListLeadsQuery,
  ): Promise<LeadList> {
    return this.leads.list(auth.workspaceId, query);
  }

  /** Before ":id" routes, so "rescore" is never read as an id. */
  @Post('rescore')
  @MinRole('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask the AI to rate leads again (Owner and Admin)' })
  @ApiZodResponse(HttpStatus.OK, rescoreResponseSchema, 'How many leads were queued')
  rescore(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(rescoreRequestSchema) body: RescoreRequest,
  ): Promise<RescoreResponse> {
    return this.review.rescore(auth, body);
  }

  @Get(':id')
  @ApiOperation({ summary: "One lead: details, the AI's reasons and the timeline" })
  @ApiZodResponse(HttpStatus.OK, leadDetailSchema, 'The lead')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LeadDetail> {
    return this.leads.detail(auth.workspaceId, id);
  }

  @Post(':id/outcome')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record how a lead ended: Won, Lost, Bad lead (or clear it)' })
  @ApiNoContentResponse({ description: 'Recorded' })
  async setOutcome(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(setOutcomeRequestSchema) body: SetOutcomeRequest,
  ): Promise<void> {
    await this.review.setOutcome(auth, id, body);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Approve the AI's rating, or override it",
    description: 'CONFLICT when "approve" finds the lead is no longer waiting for review.',
  })
  @ApiNoContentResponse({ description: 'Recorded' })
  async reviewLead(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(reviewLeadRequestSchema) body: ReviewLeadRequest,
  ): Promise<void> {
    await this.review.review(auth, id, body);
  }
}
