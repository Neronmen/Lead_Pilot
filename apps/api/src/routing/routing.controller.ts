import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type CreateRoutingRuleRequest,
  createRoutingRuleRequestSchema,
  type ReorderRoutingRulesRequest,
  reorderRoutingRulesRequestSchema,
  type RoutingRule,
  routingRuleSchema,
  type TestRoutingRequest,
  type TestRoutingResponse,
  testRoutingRequestSchema,
  testRoutingResponseSchema,
  type UpdateRoutingRuleRequest,
  updateRoutingRuleRequestSchema,
} from '@leadpilot/shared';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, MinRole } from '../auth/auth-context';
import { ApiZodResponse, ZodBody } from '../common/validation/zod-swagger';
import { RoutingService } from './routing.service';

/** Routing rules editor. Admin and Owner only (Members do not see it). */
@ApiTags('routing')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('routing')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  @Get('rules')
  @ApiOperation({ summary: 'Rules in the order they are checked' })
  @ApiZodResponse(HttpStatus.OK, z.array(routingRuleSchema), 'Rules, first checked first')
  list(@CurrentAuth() auth: AuthContext): Promise<RoutingRule[]> {
    return this.routing.list(auth.workspaceId);
  }

  @Post('rules')
  @ApiOperation({ summary: 'Add a rule at the end of the list' })
  @ApiZodResponse(HttpStatus.CREATED, routingRuleSchema, 'The new rule')
  create(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(createRoutingRuleRequestSchema) body: CreateRoutingRuleRequest,
  ): Promise<RoutingRule> {
    return this.routing.create(auth, body);
  }

  // Declared before ':id' so "order" is never read as an id.
  @Put('rules/order')
  @ApiOperation({
    summary: 'Put the rules in a new order',
    description: 'Send every rule id once. RULE_ORDER_INVALID when one is missing or repeated.',
  })
  @ApiZodResponse(HttpStatus.OK, z.array(routingRuleSchema), 'Rules in the new order')
  reorder(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(reorderRoutingRulesRequestSchema) body: ReorderRoutingRulesRequest,
  ): Promise<RoutingRule[]> {
    return this.routing.reorder(auth, body);
  }

  @Patch('rules/:id')
  @ApiOperation({ summary: 'Change a rule, or switch it off or on' })
  @ApiZodResponse(HttpStatus.OK, routingRuleSchema, 'The updated rule')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateRoutingRuleRequestSchema) body: UpdateRoutingRuleRequest,
  ): Promise<RoutingRule> {
    return this.routing.update(auth, id, body);
  }

  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a rule (its past action runs stay in the history)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.routing.remove(auth, id);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test the rules with a sample lead',
    description: 'Says which rule decides and why. Sends, assigns and saves nothing.',
  })
  @ApiZodResponse(HttpStatus.OK, testRoutingResponseSchema, 'Every rule with its checks')
  test(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(testRoutingRequestSchema) body: TestRoutingRequest,
  ): Promise<TestRoutingResponse> {
    return this.routing.test(auth.workspaceId, body.lead);
  }
}
