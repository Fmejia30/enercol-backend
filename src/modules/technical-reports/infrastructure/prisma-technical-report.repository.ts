import { Injectable } from '@nestjs/common';
import { TechnicalReportStatus, type Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  parseTechnicalReportContent,
  type TechnicalReportContent,
} from '../domain/report-content.js';
import { ReportProviderUnavailableError } from '../domain/report-error.js';
import {
  ReportRevisionConflictError,
  ReportWorkflowError,
} from '../domain/report-error.js';
import {
  acceptedReviewSlot,
  isReportStatus,
  isReviewEventType,
  isReviewSlot,
} from '../domain/report-workflow.js';
import type {
  PendingTechnicalReportRow,
  TechnicalReportCatalogRow,
  TechnicalReportInsert,
  TechnicalReportRecord,
  TechnicalReportRepository,
  TechnicalReportRequestLabel,
  TechnicalReportReviewCommand,
  TechnicalReportReviewRecord,
} from '../application/technical-report.repository.js';

interface ReportRow {
  id: string;
  postSaleRequestId: string;
  analysisId: string;
  version: number;
  status: string;
  schemaVersion: number;
  content: Prisma.JsonValue;
  model: string;
  reasoningEffort: string;
  inputTokens: number | null;
  outputTokens: number | null;
  createdBySub: string;
  origin: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PrismaTechnicalReportRepository implements TechnicalReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insert(report: TechnicalReportInsert): Promise<TechnicalReportRecord> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const current = await tx.technicalReport.aggregate({
          where: { postSaleRequestId: report.requestId },
          _max: { version: true },
        });
        const latest = current._max.version ?? 0;
        if (
          report.expectedLatestVersion !== undefined &&
          latest !== report.expectedLatestVersion
        ) {
          throw new ReportRevisionConflictError();
        }
        return tx.technicalReport.create({
          data: {
            id: report.id,
            postSaleRequestId: report.requestId,
            analysisId: report.analysisId,
            version: latest + 1,
            status: report.status,
            origin: report.origin,
            schemaVersion: report.schemaVersion,
            content: JSON.parse(JSON.stringify(report.content)) as Prisma.InputJsonValue,
            model: report.model,
            reasoningEffort: report.reasoningEffort,
            inputTokens: report.inputTokens,
            outputTokens: report.outputTokens,
            createdBySub: report.createdBySub,
            createdAt: report.createdAt,
            updatedAt: report.createdAt,
          },
        });
      });
      return mapRow(row);
    } catch (error) {
      if (error instanceof ReportRevisionConflictError) {
        throw error;
      }
      if (report.expectedLatestVersion !== undefined && isUniqueConflict(error)) {
        throw new ReportRevisionConflictError();
      }
      throw new ReportProviderUnavailableError();
    }
  }

  async listByRequestId(requestId: string): Promise<TechnicalReportRecord[]> {
    try {
      const rows = await this.prisma.technicalReport.findMany({
        where: { postSaleRequestId: requestId },
        orderBy: { version: 'desc' },
      });
      return rows.map((row) => mapRow(row));
    } catch {
      throw new ReportProviderUnavailableError();
    }
  }

  async listVisible(
    assignedSpecialistSub: string | null,
  ): Promise<TechnicalReportCatalogRow[]> {
    try {
      const rows = await this.prisma.technicalReport.findMany({
        where:
          assignedSpecialistSub === null
            ? {}
            : { request: { assignedSpecialistSub } },
        orderBy: [{ updatedAt: 'desc' }, { version: 'desc' }],
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
        report: mapRow(row),
        ticketCode: row.request.ticketCode,
        customerName: row.request.customerName,
        facilityName: row.request.facilityName,
        requestType: row.request.type,
      }));
    } catch (error) {
      if (error instanceof ReportProviderUnavailableError) {
        throw error;
      }
      throw new ReportProviderUnavailableError();
    }
  }

  async findById(id: string): Promise<TechnicalReportRecord | null> {
    try {
      const row = await this.prisma.technicalReport.findUnique({ where: { id } });
      return row ? mapRow(row) : null;
    } catch (error) {
      if (error instanceof ReportProviderUnavailableError) throw error;
      throw new ReportProviderUnavailableError();
    }
  }

  async applyReview(command: TechnicalReportReviewCommand): Promise<TechnicalReportRecord> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.technicalReport.updateMany({
          where: {
            id: command.reportId,
            postSaleRequestId: command.requestId,
            status: command.expectedStatus,
            version: command.submittedVersion,
          },
          data: { status: command.nextStatus, updatedAt: command.createdAt },
        });
        if (updated.count !== 1) {
          throw new ReportWorkflowError(
            'El estado del informe no admite esta acción.',
            'conflict',
          );
        }
        const existing = await tx.technicalReportReview.findMany({
          where: { reportId: command.reportId },
          select: { slot: true },
        });
        if (!acceptedReviewSlot(existing.map((event) => event.slot), command.slot)) {
          throw new ReportWorkflowError(
            'Esta versión ya tiene una decisión de validación.',
            'conflict',
          );
        }
        await tx.technicalReportReview.create({
          data: {
            id: command.id,
            reportId: command.reportId,
            postSaleRequestId: command.requestId,
            submittedVersion: command.submittedVersion,
            eventType: command.eventType,
            slot: command.slot,
            actorSub: command.actorSub,
            comments: command.comments,
            analysisId: command.analysisId,
            createdAt: command.createdAt,
          },
        });
        const current = await tx.technicalReport.findUnique({
          where: { id: command.reportId },
        });
        if (!current) {
          throw new ReportWorkflowError(
            'El estado del informe no admite esta acción.',
            'conflict',
          );
        }
        return current;
      });
      return mapRow(row);
    } catch (error) {
      if (error instanceof ReportWorkflowError) throw error;
      if (isUniqueConflict(error)) {
        throw new ReportWorkflowError(
          'Esta versión ya tiene una decisión de validación.',
          'conflict',
        );
      }
      throw new ReportProviderUnavailableError();
    }
  }

  async listReviewEvents(requestIds: readonly string[]): Promise<TechnicalReportReviewRecord[]> {
    if (requestIds.length === 0) return [];
    try {
      const rows = await this.prisma.technicalReportReview.findMany({
        where: { postSaleRequestId: { in: [...requestIds] } },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => mapReview(row));
    } catch (error) {
      if (error instanceof ReportProviderUnavailableError) throw error;
      throw new ReportProviderUnavailableError();
    }
  }

  async listPending(
    page: number,
    pageSize: number,
  ): Promise<{ items: PendingTechnicalReportRow[]; total: number }> {
    try {
      const where = {
        status: {
          in: [TechnicalReportStatus.PENDING_VALIDATION, TechnicalReportStatus.UNDER_REVIEW],
        },
      };
      const total = await this.prisma.technicalReport.count({ where });
      const rows = await this.prisma.technicalReport.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          request: {
            select: { ticketCode: true, customerName: true, facilityName: true },
          },
          reviews: { where: { eventType: 'SUBMITTED' }, take: 1 },
        },
      });
      return {
        total,
        items: rows.map((row) => ({
          report: mapRow(row),
          ticketCode: row.request.ticketCode,
          customerName: row.request.customerName,
          facilityName: row.request.facilityName,
          submittedAt: row.reviews[0]?.createdAt ?? null,
          submittedBySub: row.reviews[0]?.actorSub ?? null,
        })),
      };
    } catch (error) {
      if (error instanceof ReportProviderUnavailableError) throw error;
      throw new ReportProviderUnavailableError();
    }
  }

  async requestLabel(requestId: string): Promise<TechnicalReportRequestLabel | null> {
    try {
      return await this.prisma.postSaleRequest.findUnique({
        where: { id: requestId },
        select: { ticketCode: true, customerName: true, facilityName: true },
      });
    } catch {
      throw new ReportProviderUnavailableError();
    }
  }
}

function mapRow(row: ReportRow): TechnicalReportRecord {
  if (!isReportStatus(row.status)) {
    throw new ReportProviderUnavailableError();
  }
  return {
    id: row.id,
    requestId: row.postSaleRequestId,
    analysisId: row.analysisId,
    version: row.version,
    status: row.status,
    schemaVersion: row.schemaVersion,
    content: readContent(row.content),
    model: row.model,
    reasoningEffort: row.reasoningEffort,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    createdBySub: row.createdBySub,
    origin: reportOrigin(row.origin),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapReview(row: {
  id: string;
  reportId: string;
  postSaleRequestId: string;
  submittedVersion: number;
  eventType: string;
  slot: string;
  actorSub: string;
  comments: string | null;
  analysisId: string | null;
  createdAt: Date;
}): TechnicalReportReviewRecord {
  if (!isReviewEventType(row.eventType) || !isReviewSlot(row.slot)) {
    throw new ReportProviderUnavailableError();
  }
  return {
    id: row.id,
    reportId: row.reportId,
    requestId: row.postSaleRequestId,
    submittedVersion: row.submittedVersion,
    eventType: row.eventType,
    slot: row.slot,
    actorSub: row.actorSub,
    comments: row.comments,
    analysisId: row.analysisId,
    createdAt: row.createdAt,
  };
}

function reportOrigin(value: string): 'AI' | 'MANUAL' {
  if (value === 'AI' || value === 'MANUAL') return value;
  throw new ReportProviderUnavailableError();
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function readContent(value: Prisma.JsonValue): TechnicalReportContent {
  try {
    return parseTechnicalReportContent(value);
  } catch {
    throw new ReportProviderUnavailableError();
  }
}
