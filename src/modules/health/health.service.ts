
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  HealthChecksDto,
  HealthResponseDto,
} from './dto/health-response.dto.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  checkLiveness(): HealthResponseDto {
    return {
      status: 'ok',
      service: 'enercol-backend',
      timestamp: new Date().toISOString(),
      checks: {},
    };
  }

  async checkReadiness(): Promise<HealthResponseDto> {
    let checks: HealthChecksDto;

    try {
      await this.prisma.$queryRaw`SELECT 1`;

      checks = {
        database: 'up',
      };
    } catch (error) {
      this.logger.error(
        'Database readiness check failed',
        error instanceof Error ? error.stack : undefined,
      );

      checks = {
        database: 'down',
      };
    }

    const databaseUp = checks.database === 'up';

    return {
      status: databaseUp ? 'ok' : 'error',
      service: 'enercol-backend',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
