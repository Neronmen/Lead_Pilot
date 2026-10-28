import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateSourceRequest,
  createSourceRequestSchema,
  type HmacSecretResponse,
  type ImportResult,
  importResultSchema,
  type ImportRowsRequest,
  importRowsRequestSchema,
  type SampleLeadResponse,
  sampleLeadResponseSchema,
  hmacSecretResponseSchema,
  type Source,
  sourceSchema,
  type SourceWithKey,
  sourceWithKeySchema,
  type UpdateSourceRequest,
  updateSourceRequestSchema,
} from '@leadpilot/shared';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, MinRole } from '../auth/auth-context';
import { ApiZodResponse, ZodBody } from '../common/validation/zod-swagger';
import { IngestService } from '../ingest/ingest.service';
import { SourcesService } from './sources.service';

/** Settings > Lead sources and Advanced / Developer. Admin and Owner only. */
@ApiTags('sources')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('sources')
export class SourcesController {
  constructor(
    private readonly sources: SourcesService,
    private readonly ingest: IngestService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lead sources with leads in the last 30 days and the last lead' })
  @ApiZodResponse(HttpStatus.OK, z.array(sourceSchema), 'Sources, oldest first')
  list(@CurrentAuth() auth: AuthContext): Promise<Source[]> {
    return this.sources.list(auth.workspaceId);
  }

  @Post()
  @Header('Cache-Control', 'no-store') // the response carries a secret shown once
  @ApiOperation({
    summary: 'Create a source and its API key',
    description: 'The key is in this response only. Keep it: it cannot be shown again.',
  })
  @ApiZodResponse(HttpStatus.CREATED, sourceWithKeySchema, 'The source and its new key')
  create(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(createSourceRequestSchema) body: CreateSourceRequest,
  ): Promise<SourceWithKey> {
    return this.sources.create(auth, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a source, or switch it off or on' })
  @ApiZodResponse(HttpStatus.OK, sourceSchema, 'The updated source')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateSourceRequestSchema) body: UpdateSourceRequest,
  ): Promise<Source> {
    return this.sources.update(auth, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a source that has no leads',
    description: 'SOURCE_HAS_LEADS when it has any: switch it off instead.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.sources.remove(auth, id);
  }

  @Post(':id/sample-lead')
  @ApiOperation({
    summary: 'Send a made-up sample lead through this source',
    description: 'For the demo: it is cleaned, rated and routed like a real lead.',
  })
  @ApiZodResponse(HttpStatus.CREATED, sampleLeadResponseSchema, 'The new lead')
  async sendSample(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SampleLeadResponse> {
    const { body } = await this.ingest.submitSample(auth.workspaceId, id);
    return { leadId: body.leadId };
  }

  @Post(':id/import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Import a batch of spreadsheet rows (up to 200)',
    description:
      'Each row is cleaned, de-duplicated and rated like a real lead. Bad rows are counted, not fatal.',
  })
  @ApiZodResponse(HttpStatus.OK, importResultSchema, 'What happened to the batch')
  importRows(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(importRowsRequestSchema) body: ImportRowsRequest,
  ): Promise<ImportResult> {
    return this.ingest.importRows(auth.workspaceId, id, body.rows);
  }

  @Post(':id/api-key')
  @Header('Cache-Control', 'no-store') // the response carries a secret shown once
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Make a new API key; the old one stops working at once',
    description: 'The key is in this response only.',
  })
  @ApiZodResponse(HttpStatus.OK, sourceWithKeySchema, 'The source and its new key')
  rotateApiKey(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SourceWithKey> {
    return this.sources.rotateApiKey(auth, id);
  }

  @Post(':id/hmac-secret')
  @Header('Cache-Control', 'no-store') // the response carries a secret shown once
  @ApiOperation({
    summary: 'Switch request signing on and get the secret',
    description: 'The secret is in this response only. HMAC_ALREADY_ENABLED when it is on.',
  })
  @ApiZodResponse(HttpStatus.CREATED, hmacSecretResponseSchema, 'The signing secret')
  enableHmac(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HmacSecretResponse> {
    return this.sources.enableHmac(auth, id);
  }

  @Delete(':id/hmac-secret')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Switch request signing off (the secret is deleted)' })
  @ApiNoContentResponse({ description: 'Signing is off' })
  disableHmac(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.sources.disableHmac(auth, id);
  }
}
