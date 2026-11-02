import { Controller, Delete, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type DeleteWorkspaceRequest,
  deleteWorkspaceRequestSchema,
  meResponseSchema,
  type MeResponse,
  type UpdateWorkspaceRequest,
  updateWorkspaceRequestSchema,
} from '@leadpilot/shared';
import { type AuthContext, CurrentAuth, MinRole } from '../auth/auth-context';
import { ApiZodResponse, ZodBody } from '../common/validation/zod-swagger';
import { WorkspacesService } from './workspaces.service';

/** The signed-in person's own workspace: its settings, and deleting it. */
@ApiTags('workspace')
@ApiBearerAuth()
@Controller('workspace')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Patch()
  @MinRole('ADMIN')
  @ApiOperation({ summary: 'Change the workspace name, language, currency or time zone' })
  @ApiZodResponse(HttpStatus.OK, meResponseSchema.shape.workspace, 'The updated workspace')
  update(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(updateWorkspaceRequestSchema) body: UpdateWorkspaceRequest,
  ): Promise<MeResponse['workspace']> {
    return this.workspaces.update(auth, body);
  }

  @Delete()
  @MinRole('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete the workspace and all its data for good (Owner only)',
    description: 'Send the workspace name as `confirm`. CONFIRMATION_MISMATCH when it differs.',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  remove(
    @CurrentAuth() auth: AuthContext,
    @ZodBody(deleteWorkspaceRequestSchema) body: DeleteWorkspaceRequest,
  ): Promise<void> {
    return this.workspaces.remove(auth, body.confirm);
  }
}
