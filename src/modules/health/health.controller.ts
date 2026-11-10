import {
  Controller,
  Get,
  HttpStatus,
  Res,
} from '@nestjs/common';

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
  constructor(
    private readonly healthService: HealthService,
  ) {}

  @Get('live')
  @ApiOperation({
    summary: 'Verifica que la aplicación esté activa',
  })
  @ApiOkResponse({
    description: 'La aplicación está respondiendo correctamente',
    type: HealthResponseDto,
  })
  getLiveness(): HealthResponseDto {
    return this.healthService.checkLiveness();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Verifica la disponibilidad de PostgreSQL',
  })
  @ApiOkResponse({
    description: 'La aplicación y la base de datos están disponibles',
    type: HealthResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'La base de datos no está disponible',
    type: HealthResponseDto,
  })
  async getReadiness(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponseDto> {
    const report = await this.healthService.checkReadiness();

    response.status(
      report.status === 'ok'
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE,
    );

    return report;
  }
}