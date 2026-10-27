import { Controller, Get, HttpStatus, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type IcpRubric,
  type IcpRubricResponse,
  icpRubricResponseSchema,
  icpRubricSchema,
} from '@leadpilot/shared';
import { type AuthContext, CurrentAuth, MinRole } from '../auth/auth-context';
import { ApiZodResponse, ZodBody } from '../common/validation/zod-swagger';
import { RubricService } from './rubric.service';

/** Settings > Ideal customer. Owner and Admin only. */
@ApiTags('ideal-customer')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('icp-rubric')
export class RubricController {
  constructor(private readonly rubric: RubricService) {}

  @Get()
  @ApiOperation({ summary: 'The ideal customer (empty lists until first saved)' })
  @ApiZodResponse(HttpStatus.OK, icpRubricResponseSchema, 'The rubric')
  get(@CurrentAuth() auth: AuthContext): Promise<IcpRubricResponse> {
    return this.rubric.get(auth.workspaceId);
  }

  @Put()
  @ApiOperation({ summary: 'Save the ideal customer (replaces what was saved)' })
  @ApiZodResponse(HttpStatus.OK, icpRubricResponseSchema, 'The saved rubric')
  save(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(icpRubricSchema) body: IcpRubric,
  ): Promise<IcpRubricResponse> {
    return this.rubric.save(auth, body);
  }
}
