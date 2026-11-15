import type { TechnicalReportContent } from '../domain/report-content.js';
import type {
  ReportStatus,
  ReviewEventType,
  ReviewSlot,
} from '../domain/report-workflow.js';

export interface TechnicalReportInsert {
  readonly id: string;
  readonly requestId: string;
  readonly analysisId: string;
  readonly status: ReportStatus;
  readonly schemaVersion: number;
  readonly content: TechnicalReportContent;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly createdBySub: string;
  readonly origin: 'AI' | 'MANUAL';
  readonly createdAt: Date;
  readonly expectedLatestVersion?: number;
}

export interface TechnicalReportRecord
  extends Omit<TechnicalReportInsert, 'expectedLatestVersion'> {
  readonly version: number;
  readonly updatedAt: Date;
}

export interface TechnicalReportCatalogRow {
  readonly report: TechnicalReportRecord;
  readonly ticketCode: string;
  readonly customerName: string;
  readonly facilityName: string;
  readonly requestType: string;
}

export interface TechnicalReportReviewCommand {
  readonly id: string;
  readonly reportId: string;
  readonly requestId: string;
  readonly submittedVersion: number;
  readonly eventType: ReviewEventType;
  readonly slot: ReviewSlot;
  readonly actorSub: string;
  readonly comments: string | null;
  readonly analysisId: string | null;
  readonly createdAt: Date;
  readonly expectedStatus: ReportStatus;
  readonly nextStatus: ReportStatus;
}

export interface TechnicalReportReviewRecord {
  readonly id: string;
  readonly reportId: string;
  readonly requestId: string;
  readonly submittedVersion: number;
  readonly eventType: ReviewEventType;
  readonly slot: ReviewSlot;
  readonly actorSub: string;
  readonly comments: string | null;
  readonly analysisId: string | null;
  readonly createdAt: Date;
}

export interface PendingTechnicalReportRow {
  readonly report: TechnicalReportRecord;
  readonly ticketCode: string;
  readonly customerName: string;
  readonly facilityName: string;
  readonly submittedAt: Date | null;
  readonly submittedBySub: string | null;
}

export interface TechnicalReportRequestLabel {
  readonly ticketCode: string;
  readonly customerName: string;
  readonly facilityName: string;
}

export interface TechnicalReportRepository {
  insert(report: TechnicalReportInsert): Promise<TechnicalReportRecord>;
  listByRequestId(requestId: string): Promise<TechnicalReportRecord[]>;
  findById(id: string): Promise<TechnicalReportRecord | null>;
  listVisible(assignedSpecialistSub: string | null): Promise<TechnicalReportCatalogRow[]>;
  applyReview(command: TechnicalReportReviewCommand): Promise<TechnicalReportRecord>;
  listReviewEvents(requestIds: readonly string[]): Promise<TechnicalReportReviewRecord[]>;
  listPending(
    page: number,
    pageSize: number,
  ): Promise<{ items: PendingTechnicalReportRow[]; total: number }>;
  requestLabel(requestId: string): Promise<TechnicalReportRequestLabel | null>;
}

export const TECHNICAL_REPORT_REPOSITORY = Symbol(
  'TECHNICAL_REPORT_REPOSITORY',
);
