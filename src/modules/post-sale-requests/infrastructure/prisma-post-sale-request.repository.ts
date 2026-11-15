import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type {
  AppendRequestActivity,
  ListPostSaleRequestsCriteria,
  PostSaleRequestPage,
  PostSaleRequestRepository,
  RequestActivityRecord,
} from '../application/post-sale-request.repository.js';
import {
  REQUEST_ACTIVITY_EVENTS,
  nextRequestStatus,
  type RequestActivityEvent,
} from '../domain/request-activity.js';
import {
  InvalidPostSaleRequestError,
  POST_SALE_REQUEST_STATUSES,
  POST_SALE_REQUEST_TYPES,
  createPostSaleRequest,
  type PostSaleRequest,
  type PostSaleRequestStatus,
  type PostSaleRequestType,
} from '../domain/post-sale-request.js';
import {
  PostSaleRequestConflictError,
  PostSaleRequestPersistenceError,
} from '../domain/post-sale-request-error.js';

interface PostSaleRequestRow {
  id: string;
  ticketCode: string;
  customerId: string;
  customerName: string;
  facilityName: string;
  assetId: string | null;
  assignedSpecialistSub: string | null;
  type: string;
  description: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  createdAt: Date;
}

const TICKET_COUNTER_ID = 'post-sale';

@Injectable()
export class PrismaPostSaleRequestRepository implements PostSaleRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    criteria: ListPostSaleRequestsCriteria,
  ): Promise<PostSaleRequestPage> {
    const where = whereFor(criteria);
    const [rows, total] = await Promise.all([
      this.prisma.postSaleRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.postSaleRequest.count({ where }),
    ]);
    return {
      items: rows.map((row) => toDomain(row)),
      page: criteria.page,
      pageSize: criteria.pageSize,
      total,
    };
  }

  async findById(id: string): Promise<PostSaleRequest | null> {
    const row = await this.prisma.postSaleRequest.findUnique({
      where: { id },
    });
    return row ? toDomain(row) : null;
  }

  async allocateTicketCode(): Promise<string> {
    try {
      const counter = await this.prisma.postSaleRequestTicket.update({
        where: { id: TICKET_COUNTER_ID },
        data: { lastValue: { increment: 1 } },
      });
      return formatTicketCode(counter.lastValue);
    } catch {
      throw new PostSaleRequestPersistenceError();
    }
  }

  async insert(request: PostSaleRequest): Promise<PostSaleRequest> {
    try {
      const row = await this.prisma.postSaleRequest.create({
        data: {
          id: request.id,
          ticketCode: request.ticketCode,
          customerId: request.customerId,
          customerName: request.customerName,
          facilityName: request.facilityName,
          assetId: request.assetId,
          assignedSpecialistSub: request.assignedSpecialistSub,
          type: request.type,
          description: request.description,
          periodStart: utcDate(request.periodStart),
          periodEnd: utcDate(request.periodEnd),
          status: request.status,
          createdAt: request.createdAt,
          updatedAt: request.createdAt,
        },
      });
      return toDomain(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new PostSaleRequestConflictError();
      }
      throw new PostSaleRequestPersistenceError();
    }
  }

  async appendActivity(activity: AppendRequestActivity): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const request = await tx.postSaleRequest.findUnique({
          where: { id: activity.requestId },
        });
        if (!request || !isRequestStatus(request.status)) {
          throw new PostSaleRequestPersistenceError();
        }
        const next = nextRequestStatus(request.status, activity.eventType);
        await tx.postSaleRequestActivity.create({
          data: {
            id: activity.id,
            postSaleRequestId: activity.requestId,
            eventType: activity.eventType,
            previousStatus: request.status,
            newStatus: next,
            description: activity.description,
            actorSub: activity.actorSub,
            actorRole: activity.actorRole,
            technicalAnalysisId: activity.technicalAnalysisId,
            technicalReportId: activity.technicalReportId,
            reportVersion: activity.reportVersion,
            metadata: activity.metadata ?? undefined,
            dedupeKey: activity.dedupeKey,
            createdAt: activity.createdAt,
          },
        });
        if (next !== request.status) {
          await tx.postSaleRequest.update({
            where: { id: request.id },
            data: { status: next },
          });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return;
      }
      if (error instanceof PostSaleRequestPersistenceError) {
        throw error;
      }
      throw new PostSaleRequestPersistenceError();
    }
  }

  async listActivity(requestId: string): Promise<readonly RequestActivityRecord[]> {
    try {
      const rows = await this.prisma.postSaleRequestActivity.findMany({
        where: { postSaleRequestId: requestId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      return rows.map((row) => toActivity(row));
    } catch {
      throw new PostSaleRequestPersistenceError();
    }
  }
}

function whereFor(
  criteria: ListPostSaleRequestsCriteria,
): Prisma.PostSaleRequestWhereInput {
  const search = criteria.search?.trim();
  return {
    ...(criteria.visibility.kind === 'assigned'
      ? { assignedSpecialistSub: criteria.visibility.specialistSub }
      : {}),
    ...(criteria.status ? { status: criteria.status } : {}),
    ...(search
      ? {
          OR: [
            { ticketCode: { contains: search, mode: 'insensitive' } },
            { customerId: { contains: search, mode: 'insensitive' } },
            { customerName: { contains: search, mode: 'insensitive' } },
            { facilityName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

function toDomain(row: PostSaleRequestRow): PostSaleRequest {
  if (!isRequestType(row.type) || !isRequestStatus(row.status)) {
    throw new InvalidPostSaleRequestError();
  }
  return createPostSaleRequest({
    id: row.id,
    ticketCode: row.ticketCode,
    customerId: row.customerId,
    customerName: row.customerName,
    facilityName: row.facilityName,
    assetId: row.assetId,
    assignedSpecialistSub: row.assignedSpecialistSub,
    type: row.type,
    description: row.description,
    periodStart: dateOnly(row.periodStart),
    periodEnd: dateOnly(row.periodEnd),
    status: row.status,
    createdAt: row.createdAt,
  });
}

function dateOnly(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatTicketCode(value: number): string {
  if (!Number.isInteger(value) || value < 1) {
    throw new PostSaleRequestPersistenceError();
  }
  return `PV-${String(value).padStart(6, '0')}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function isRequestType(value: string): value is PostSaleRequestType {
  return (POST_SALE_REQUEST_TYPES as readonly string[]).includes(value);
}

function isRequestStatus(value: string): value is PostSaleRequestStatus {
  return (POST_SALE_REQUEST_STATUSES as readonly string[]).includes(value);
}

function isActivityEvent(value: string): value is RequestActivityEvent {
  return (REQUEST_ACTIVITY_EVENTS as readonly string[]).includes(value);
}

function toActivity(row: {
  id: string;
  postSaleRequestId: string;
  eventType: string;
  previousStatus: string | null;
  newStatus: string | null;
  description: string;
  actorSub: string | null;
  actorRole: string | null;
  technicalAnalysisId: string | null;
  technicalReportId: string | null;
  reportVersion: number | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}): RequestActivityRecord {
  if (
    !isActivityEvent(row.eventType) ||
    (row.previousStatus !== null && !isRequestStatus(row.previousStatus)) ||
    (row.newStatus !== null && !isRequestStatus(row.newStatus))
  ) {
    throw new InvalidPostSaleRequestError();
  }
  return {
    id: row.id,
    requestId: row.postSaleRequestId,
    eventType: row.eventType,
    previousStatus: row.previousStatus,
    newStatus: row.newStatus,
    description: row.description,
    actorSub: row.actorSub,
    actorRole: row.actorRole,
    technicalAnalysisId: row.technicalAnalysisId,
    technicalReportId: row.technicalReportId,
    reportVersion: row.reportVersion,
    metadata: metadataOf(row.metadata),
    createdAt: row.createdAt,
  };
}

function metadataOf(value: Prisma.JsonValue): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const metadata: Record<string, string> = {};
  for (const key of ['comments', 'origin', 'failureMessage'] as const) {
    const entry = value[key];
    if (typeof entry === 'string' && entry.trim().length > 0) {
      metadata[key] = entry;
    }
  }
  return metadata;
}
