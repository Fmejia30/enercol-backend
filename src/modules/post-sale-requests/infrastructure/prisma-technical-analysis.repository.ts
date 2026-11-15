import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type {
  TechnicalAnalysisRecord,
  TechnicalAnalysisRepository,
  VisibleTechnicalAnalysis,
} from '../application/technical-analysis.repository.js';
import { PostSaleRequestPersistenceError } from '../domain/post-sale-request-error.js';
import {
  ANALYSIS_INTERPRETATIONS,
  ANALYSIS_STATUSES,
  type AnalysisEvidence,
  type AnalysisFinding,
  type AnalysisInputSnapshot,
  type AnalysisInterpretation,
  type AnalysisStatus,
} from '../domain/technical-analysis.js';
import { POST_SALE_REQUEST_TYPES } from '../domain/post-sale-request.js';

interface AnalysisRow {
  id: string;
  postSaleRequestId: string;
  status: string;
  executedAt: Date;
  executedBySub: string;
  failureMessage: string | null;
  inputSnapshot: Prisma.JsonValue;
  findings: Prisma.JsonValue;
}

@Injectable()
export class PrismaTechnicalAnalysisRepository implements TechnicalAnalysisRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(
    analysis: TechnicalAnalysisRecord,
  ): Promise<TechnicalAnalysisRecord> {
    try {
      const row = await this.prisma.technicalAnalysis.create({
        data: {
          id: analysis.id,
          postSaleRequestId: analysis.requestId,
          status: analysis.status,
          executedAt: analysis.executedAt,
          executedBySub: analysis.executedBySub,
          failureMessage: analysis.failureMessage,
          inputSnapshot: toJson(analysis.inputSnapshot),
          findings: toJson(analysis.findings),
        },
      });
      return toDomain(row);
    } catch {
      throw new PostSaleRequestPersistenceError();
    }
  }

  async listByRequestId(requestId: string): Promise<TechnicalAnalysisRecord[]> {
    try {
      const rows = await this.prisma.technicalAnalysis.findMany({
        where: { postSaleRequestId: requestId },
        orderBy: [{ executedAt: 'desc' }, { id: 'desc' }],
      });
      return rows.map((row) => toDomain(row));
    } catch (error) {
      if (error instanceof PostSaleRequestPersistenceError) {
        throw error;
      }
      throw new PostSaleRequestPersistenceError();
    }
  }

  async listVisible(
    assignedSpecialistSub: string | null,
  ): Promise<VisibleTechnicalAnalysis[]> {
    try {
      const rows = await this.prisma.technicalAnalysis.findMany({
        where:
          assignedSpecialistSub === null
            ? {}
            : { request: { assignedSpecialistSub } },
        orderBy: [{ executedAt: 'desc' }, { id: 'desc' }],
        include: {
          request: {
            select: {
              ticketCode: true,
              customerName: true,
              facilityName: true,
              type: true,
            },
          },
        },
      });
      return rows.map((row) => ({
        analysis: toDomain(row),
        ticketCode: row.request.ticketCode,
        customerName: row.request.customerName,
        facilityName: row.request.facilityName,
        requestType: row.request.type,
      }));
    } catch (error) {
      if (error instanceof PostSaleRequestPersistenceError) {
        throw error;
      }
      throw new PostSaleRequestPersistenceError();
    }
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toDomain(row: AnalysisRow): TechnicalAnalysisRecord {
  if (!isStatus(row.status)) {
    throw new PostSaleRequestPersistenceError();
  }
  return {
    id: row.id,
    requestId: row.postSaleRequestId,
    status: row.status,
    executedAt: row.executedAt,
    executedBySub: row.executedBySub,
    failureMessage: row.failureMessage,
    inputSnapshot: snapshot(row.inputSnapshot),
    findings: findings(row.findings),
  };
}

function snapshot(value: Prisma.JsonValue): AnalysisInputSnapshot {
  if (!isRecord(value) || !isRequestType(value.requestType)) {
    throw new PostSaleRequestPersistenceError();
  }
  if (
    typeof value.periodStart !== 'string' ||
    typeof value.periodEnd !== 'string' ||
    typeof value.demandUnit !== 'string' ||
    typeof value.consumptionUnit !== 'string' ||
    !isNullableText(value.demandThreshold) ||
    !isNullableText(value.evaluationConsumption) ||
    !Array.isArray(value.telemetry) ||
    !Array.isArray(value.historicalConsumption)
  ) {
    throw new PostSaleRequestPersistenceError();
  }
  return {
    requestType: value.requestType,
    periodStart: value.periodStart,
    periodEnd: value.periodEnd,
    demandThreshold: value.demandThreshold,
    demandUnit: value.demandUnit,
    evaluationConsumption: value.evaluationConsumption,
    consumptionUnit: value.consumptionUnit,
    telemetry: value.telemetry.map((reading) => {
      if (
        !isRecord(reading) ||
        typeof reading.measuredAt !== 'string' ||
        typeof reading.measuredDemand !== 'string'
      ) {
        throw new PostSaleRequestPersistenceError();
      }
      return {
        measuredAt: reading.measuredAt,
        measuredDemand: reading.measuredDemand,
      };
    }),
    historicalConsumption: value.historicalConsumption.map((item) => {
      if (
        !isRecord(item) ||
        typeof item.periodStart !== 'string' ||
        typeof item.periodEnd !== 'string' ||
        typeof item.consumption !== 'string'
      ) {
        throw new PostSaleRequestPersistenceError();
      }
      return {
        periodStart: item.periodStart,
        periodEnd: item.periodEnd,
        consumption: item.consumption,
      };
    }),
  };
}

function findings(value: Prisma.JsonValue): AnalysisFinding[] {
  if (!Array.isArray(value)) {
    throw new PostSaleRequestPersistenceError();
  }
  return value.map((item) => {
    if (!isRecord(item) || !isInterpretation(item.interpretation)) {
      throw new PostSaleRequestPersistenceError();
    }
    const text = [
      item.findingType,
      item.description,
      item.measuredValue,
      item.referenceValue,
      item.difference,
      item.percentage,
      item.unit,
      item.periodStart,
      item.periodEnd,
    ];
    if (
      text.some((entry) => typeof entry !== 'string') ||
      !Array.isArray(item.evidence)
    ) {
      throw new PostSaleRequestPersistenceError();
    }
    return {
      findingType: item.findingType as string,
      description: item.description as string,
      measuredValue: item.measuredValue as string,
      referenceValue: item.referenceValue as string,
      difference: item.difference as string,
      percentage: item.percentage as string,
      unit: item.unit as string,
      interpretation: item.interpretation,
      periodStart: item.periodStart as string,
      periodEnd: item.periodEnd as string,
      evidence: item.evidence.map((entry) => evidence(entry)),
    };
  });
}

function evidence(value: Prisma.JsonValue): AnalysisEvidence {
  if (
    !isRecord(value) ||
    typeof value.label !== 'string' ||
    typeof value.value !== 'string' ||
    typeof value.unit !== 'string' ||
    !isNullableText(value.measuredAt) ||
    !isNullableText(value.periodStart) ||
    !isNullableText(value.periodEnd)
  ) {
    throw new PostSaleRequestPersistenceError();
  }
  return {
    label: value.label,
    value: value.value,
    unit: value.unit,
    measuredAt: value.measuredAt,
    periodStart: value.periodStart,
    periodEnd: value.periodEnd,
  };
}

function isStatus(value: string): value is AnalysisStatus {
  return (ANALYSIS_STATUSES as readonly string[]).includes(value);
}

function isInterpretation(value: unknown): value is AnalysisInterpretation {
  return (
    typeof value === 'string' &&
    (ANALYSIS_INTERPRETATIONS as readonly string[]).includes(value)
  );
}

function isRequestType(
  value: unknown,
): value is AnalysisInputSnapshot['requestType'] {
  return (
    typeof value === 'string' &&
    (POST_SALE_REQUEST_TYPES as readonly string[]).includes(value)
  );
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
