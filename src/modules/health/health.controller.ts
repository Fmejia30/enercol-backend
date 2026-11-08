import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../identity-access/presentation/public.decorator.js';
import { HealthResponseDto } from './dto/health-response.dto.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Comprueba el proceso y la conexión con PostgreSQL',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto })
  async getHealth(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponseDto> {
    const report = await this.healthService.check();
    const databaseUp = report.checks.database === 'up';
    response.status(
      databaseUp ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );

    return {
      status: databaseUp ? 'ok' : 'error',
      service: 'enercol-backend',
      timestamp: new Date().toISOString(),
      checks: report.checks,
    };
  }
}
