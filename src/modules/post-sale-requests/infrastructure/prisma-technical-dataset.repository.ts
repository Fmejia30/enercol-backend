import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { TechnicalDatasetRepository } from '../application/technical-dataset.repository.js';
import { PostSaleRequestPersistenceError } from '../domain/post-sale-request-error.js';
import {
  utcDateOnly,
  type StoredTechnicalDataset,
} from '../domain/technical-dataset.js';

const DECIMAL_TEXT = /^(?:0|[1-9]\d*)\.\d{3}$/;

interface Quantity {
  toFixed(digits: number): string;
}

interface DatasetRow {
  demandThreshold: Quantity | null;
  demandUnit: string;
  evaluationConsumption: Quantity | null;
  consumptionUnit: string;
  sourceName: string;
  sourceKind: string;
  telemetryReadings: ReadonlyArray<{
    measuredAt: Date;
    measuredDemand: Quantity;
  }>;
  historicalConsumption: ReadonlyArray<{
    periodStart: Date;
    periodEnd: Date;
    consumption: Quantity;
  }>;
}

@Injectable()
export class PrismaTechnicalDatasetRepository implements TechnicalDatasetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByRequestId(
    requestId: string,
  ): Promise<StoredTechnicalDataset | null> {
    try {
      const row = await this.prisma.technicalDataset.findUnique({
        where: { postSaleRequestId: requestId },
        include: {
          telemetryReadings: { orderBy: { measuredAt: 'asc' } },
          historicalConsumption: { orderBy: { periodStart: 'asc' } },
        },
      });
      return row ? toDomain(row) : null;
    } catch {
      throw new PostSaleRequestPersistenceError();
    }
  }
}

function toDomain(row: DatasetRow): StoredTechnicalDataset {
  return {
    demandThreshold: optionalQuantity(row.demandThreshold),
    demandUnit: requiredText(row.demandUnit),
    evaluationConsumption: optionalQuantity(row.evaluationConsumption),
    consumptionUnit: requiredText(row.consumptionUnit),
    sourceName: requiredText(row.sourceName),
    sourceKind: requiredText(row.sourceKind),
    telemetry: row.telemetryReadings.map((reading) => ({
      measuredAt: reading.measuredAt.toISOString(),
      measuredDemand: quantity(reading.measuredDemand),
    })),
    historicalConsumption: row.historicalConsumption.map((item) => ({
      periodStart: utcDateOnly(item.periodStart),
      periodEnd: utcDateOnly(item.periodEnd),
      consumption: quantity(item.consumption),
    })),
  };
}

function optionalQuantity(value: Quantity | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  return quantity(value);
}

function quantity(value: Quantity): string {
  const text = value.toFixed(3);
  if (!DECIMAL_TEXT.test(text)) {
    throw new PostSaleRequestPersistenceError();
  }
  return text;
}

function requiredText(value: string): string {
  const text = value.trim();
  if (!text) {
    throw new PostSaleRequestPersistenceError();
  }
  return text;
}
