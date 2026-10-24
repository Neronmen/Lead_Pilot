import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { HealthResponse } from '@leadpilot/shared';
import type { Response } from 'express';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe: the process is running' })
  @ApiOkResponse({ description: '`{ status: "ok", checks: {} }`' })
  live(): HealthResponse {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe: Postgres and Redis reachable' })
  @ApiOkResponse({ description: 'All dependencies are up' })
  @ApiServiceUnavailableResponse({
    description:
      'At least one dependency is down. Body keeps the health shape (not the error envelope) so probes can see which check failed.',
  })
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const result = await this.health.readiness();
    if (result.status === 'error') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
