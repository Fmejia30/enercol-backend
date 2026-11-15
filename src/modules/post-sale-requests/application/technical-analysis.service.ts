import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import {
  analyzeTechnicalDataset,
  type AnalysisFinding,
  type AnalysisStatus,
} from '../domain/technical-analysis.js';
import { requestVisibility } from '../domain/post-sale-request.js';
import {
  PostSaleRequestForbiddenError,
  TechnicalDatasetNotFoundError,
} from '../domain/post-sale-request-error.js';
import { PostSaleRequestService } from './post-sale-request.service.js';
import {
  TECHNICAL_ANALYSIS_REPOSITORY,
  type TechnicalAnalysisRecord,
  type TechnicalAnalysisRepository,
} from './technical-analysis.repository.js';
import {
  TECHNICAL_DATASET_REPOSITORY,
  type TechnicalDatasetRepository,
} from './technical-dataset.repository.js';

@Injectable()
export class TechnicalAnalysisService {
  constructor(
    private readonly requests: PostSaleRequestService,
    @Inject(TECHNICAL_DATASET_REPOSITORY)
    private readonly datasets: TechnicalDatasetRepository,
    @Inject(TECHNICAL_ANALYSIS_REPOSITORY)
    private readonly analyses: TechnicalAnalysisRepository,
  ) {}

  async execute(
    actor: AuthenticatedUser,
    requestId: string,
  ): Promise<TechnicalAnalysisRecord> {
    const request = await this.requests.get(actor, requestId);
    if (!canExecute(actor)) {
      throw new PostSaleRequestForbiddenError();
    }
    const stored = await this.datasets.findByRequestId(request.id);
    if (!stored) {
      throw new TechnicalDatasetNotFoundError();
    }
    const outcome = analyzeTechnicalDataset(request, stored);
    const record = await this.analyses.insert({
      id: randomUUID(),
      requestId: request.id,
      status: outcome.status,
      executedAt: new Date(),
      executedBySub: actor.userId,
      failureMessage: outcome.failureMessage,
      inputSnapshot: outcome.inputSnapshot,
      findings: outcome.findings,
    });
    const succeeded = outcome.status === 'SUCCEEDED';
    await this.requests.recordActivity({
      actor,
      requestId: request.id,
      eventType: succeeded ? 'ANALYSIS_COMPLETED' : 'ANALYSIS_FAILED',
      dedupeKey: `analysis:${record.id}:${succeeded ? 'completed' : 'failed'}`,
      preferredRole: UserRole.SPECIALIST,
      technicalAnalysisId: record.id,
      metadata: outcome.failureMessage ? { failureMessage: outcome.failureMessage } : null,
      occurredAt: record.executedAt,
    });
    return record;
  }

  async list(
    actor: AuthenticatedUser,
    requestId: string,
  ): Promise<TechnicalAnalysisRecord[]> {
    const request = await this.requests.get(actor, requestId);
    return this.analyses.listByRequestId(request.id);
  }

  async catalog(actor: AuthenticatedUser): Promise<TechnicalAnalysisCatalogItem[]> {
    const visibility = requestVisibility(actor);
    const rows = await this.analyses.listVisible(
      visibility.kind === 'all' ? null : visibility.specialistSub,
    );
    return rows.map((row) => ({
      id: row.analysis.id,
      requestId: row.analysis.requestId,
      ticketCode: row.ticketCode,
      customerName: row.customerName,
      facilityName: row.facilityName,
      requestType: row.requestType,
      status: row.analysis.status,
      executedAt: row.analysis.executedAt.toISOString(),
      failureMessage: row.analysis.failureMessage,
      findings: row.analysis.findings,
    }));
  }
}

export interface TechnicalAnalysisCatalogItem {
  readonly id: string;
  readonly requestId: string;
  readonly ticketCode: string;
  readonly customerName: string;
  readonly facilityName: string;
  readonly requestType: string;
  readonly status: AnalysisStatus;
  readonly executedAt: string;
  readonly failureMessage: string | null;
  readonly findings: readonly AnalysisFinding[];
}

function canExecute(actor: AuthenticatedUser): boolean {
  return (
    actor.roles.includes(UserRole.ADMINISTRATOR) ||
    actor.roles.includes(UserRole.SPECIALIST)
  );
}
