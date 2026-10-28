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
  type CreateIntegrationRequest,
  createIntegrationRequestSchema,
  type Integration,
  integrationSchema,
  type IntegrationWithSecret,
  integrationWithSecretSchema,
  type TestIntegrationResponse,
  testIntegrationResponseSchema,
  type UpdateIntegrationRequest,
  updateIntegrationRequestSchema,
} from '@leadpilot/shared';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, MinRole } from '../auth/auth-context';
import { ApiZodResponse, ZodBody } from '../common/validation/zod-swagger';
import { IntegrationsService } from './integrations.service';

/** Settings > Integrations. Admin and Owner only. Tokens go in and never come back out. */
@ApiTags('integrations')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @ApiOperation({ summary: 'Connected tools, with their status and last test' })
  @ApiZodResponse(HttpStatus.OK, z.array(integrationSchema), 'Integrations, oldest first')
  list(@CurrentAuth() auth: AuthContext): Promise<Integration[]> {
    return this.integrations.list(auth.workspaceId);
  }

  @Post()
  @Header('Cache-Control', 'no-store') // an outgoing webhook's signing secret is shown once
  @ApiOperation({
    summary: 'Connect a tool',
    description: 'The signing secret of an outgoing webhook is in this response only.',
  })
  @ApiZodResponse(HttpStatus.CREATED, integrationWithSecretSchema, 'The new integration')
  create(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(createIntegrationRequestSchema) body: CreateIntegrationRequest,
  ): Promise<IntegrationWithSecret> {
    return this.integrations.create(auth, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename an integration, or switch it off or on' })
  @ApiZodResponse(HttpStatus.OK, integrationSchema, 'The updated integration')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateIntegrationRequestSchema) body: UpdateIntegrationRequest,
  ): Promise<Integration> {
    return this.integrations.update(auth, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Disconnect a tool',
    description: 'INTEGRATION_IN_USE when a rule still uses it: switch it off instead.',
  })
  @ApiNoContentResponse({ description: 'Disconnected' })
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.integrations.remove(auth, id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a test message',
    description: 'The result is also kept on the integration.',
  })
  @ApiZodResponse(
    HttpStatus.OK,
    testIntegrationResponseSchema,
    'Whether it worked, and a short code if not',
  )
  test(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TestIntegrationResponse> {
    return this.integrations.test(auth, id);
  }
}
