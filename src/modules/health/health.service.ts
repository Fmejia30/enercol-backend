import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { HealthChecksDto } from './dto/health-response.dto.js';

export interface HealthReport {
  checks: HealthChecksDto;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthReport> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { checks: { database: 'up' } };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown database error';
      this.logger.error(`Database health check failed: ${message}`);
      return { checks: { database: 'down' } };
    }
  }
}
