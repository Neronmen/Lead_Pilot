import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type PublicFormInfo,
  publicFormInfoSchema,
  type PublicFormSubmission,
  publicFormSubmissionSchema,
} from '@leadpilot/shared';
import type { Request, Response } from 'express';
import { Public } from '../auth/auth-context';
import { ApiZodResponse, ZodBody } from '../common/validation/zod-swagger';
import { IngestService, RateLimitedError } from './ingest.service';

/**
 * The public web form of a source (`/f/<id>` in the web app). Open to anyone with the link, so it
 * answers 404 unless the source's form is switched on, counts every visitor's address, and drops
 * submissions that fill the hidden trap field.
 */
@ApiTags('forms')
@Public()
@Controller('v1/forms')
export class FormsController {
  constructor(private readonly ingest: IngestService) {}

  @Get(':sourceId')
  @ApiOperation({ summary: 'What the web form shows (404 when its form is off)' })
  @ApiZodResponse(HttpStatus.OK, publicFormInfoSchema, 'The company name')
  info(@Param('sourceId', ParseUUIDPipe) sourceId: string): Promise<PublicFormInfo> {
    return this.ingest.formInfo(sourceId);
  }

  @Post(':sourceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Send a lead from the web form',
    description:
      'No key: limited to 10 a minute per address. 400 with the problem fields when the contact is not usable.',
  })
  async submit(
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @ZodBody(publicFormSubmissionSchema) body: PublicFormSubmission,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    try {
      await this.ingest.submitForm(sourceId, req.ip ?? 'unknown', body);
    } catch (error) {
      if (error instanceof RateLimitedError) res.setHeader('Retry-After', String(error.retryAfter));
      throw error;
    }
  }
}
