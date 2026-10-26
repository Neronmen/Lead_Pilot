import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type ChangeRoleRequest,
  changeRoleRequestSchema,
  type Member,
  memberSchema,
} from '@leadpilot/shared';
import { z } from 'zod';
import { type AuthContext, CurrentAuth, MinRole } from '../auth/auth-context';
import { ApiZodResponse, ZodBody } from '../common/validation/zod-swagger';
import { MembersService } from './members.service';

/** Settings > Team: the people in the workspace. Admin and Owner only. */
@ApiTags('members')
@ApiBearerAuth()
@MinRole('ADMIN')
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @ApiOperation({ summary: 'People in the workspace, with role, open leads and last active' })
  @ApiZodResponse(HttpStatus.OK, z.array(memberSchema), 'Members, oldest first')
  list(@CurrentAuth() auth: AuthContext): Promise<Member[]> {
    return this.members.list(auth.workspaceId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change a person’s role between Admin and Member',
    description:
      'OWNER_IMMUTABLE for the owner, CANNOT_MODIFY_SELF for yourself. The id is the membership id from the list.',
  })
  @ApiZodResponse(HttpStatus.OK, memberSchema, 'The updated member')
  changeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(changeRoleRequestSchema) body: ChangeRoleRequest,
  ): Promise<Member> {
    return this.members.changeRole(auth, id, body.role);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a person from the workspace',
    description:
      'All their leads become unassigned and their sessions in this workspace end. The account itself is kept.',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.members.remove(auth, id);
  }
}
