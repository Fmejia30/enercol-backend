import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { decideReportValidation } from '../../identity-access/domain/report-validation-policy.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { PrivacyService } from '../../privacy/application/privacy.service.js';
import type { AnalysisProtectionSource } from '../../privacy/application/analysis-transfer.js';
import { assertOutboundSafe } from '../../privacy/domain/outbound-validation.js';
import {
  MalformedPrivacyTokenError,
  PrivacyAuthorizationError,
  PrivacyProtectionError,
  UnknownPrivacyTokenError,
} from '../../privacy/domain/privacy-error.js';
import { PostSaleRequestService } from '../../post-sale-requests/application/post-sale-request.service.js';
import type { RequestActivityEvent } from '../../post-sale-requests/domain/request-activity.js';
import { TechnicalAnalysisService } from '../../post-sale-requests/application/technical-analysis.service.js';
import type { TechnicalAnalysisRecord } from '../../post-sale-requests/application/technical-analysis.repository.js';
import {
  requestVisibility,
  type PostSaleRequest,
} from '../../post-sale-requests/domain/post-sale-request.js';
import {
  PostSaleRequestForbiddenError,
  PostSaleRequestNotFoundError,
  PostSaleRequestPersistenceError,
  TechnicalDatasetNotFoundError,
} from '../../post-sale-requests/domain/post-sale-request-error.js';
import type { TechnicalDataset } from '../../post-sale-requests/domain/technical-dataset.js';
import {
  USER_DIRECTORY_REPOSITORY,
  type UserDirectoryRepository,
} from '../../users/application/user-directory.repository.js';
import {
  REPORT_LANGUAGE_MODEL,
  type ReportLanguageModel,
} from './report-language-model.js';
import {
  TECHNICAL_REPORT_REPOSITORY,
  type TechnicalReportCatalogRow,
  type TechnicalReportRecord,
  type TechnicalReportRepository,
  type TechnicalReportReviewRecord,
} from './technical-report.repository.js';
import {
  assertReportConsistent,
  parseTechnicalReportContent,
  reportConsistencyInput,
  type TechnicalReportContent,
} from '../domain/report-content.js';
import {
  ReportContentInvalidError,
  ReportGenerationConflictError,
  ReportNotFoundError,
  ReportPrerequisiteError,
  ReportProviderUnavailableError,
  ReportRevisionConflictError,
  ReportSaveUnavailableError,
  ReportWorkflowError,
} from '../domain/report-error.js';
import {
  acceptedReviewSlot,
  canGenerateReport,
  canRevise,
  reviewComments,
  transitionFor,
  type ReportStatus,
  type ReviewAction,
  type ReviewEventType,
} from '../domain/report-workflow.js';

export interface TechnicalReportCatalogItem {
  readonly ticketCode: string;
  readonly customerName: string;
  readonly facilityName: string;
  readonly requestType: string;
  readonly report: TechnicalReportView;
}

export interface PersonName {
  readonly firstName: string;
  readonly lastName: string;
}

export interface TechnicalReportDecisionView {
  readonly type: Extract<ReviewEventType, 'APPROVED' | 'CHANGES_REQUESTED' | 'REANALYSIS_REQUIRED'>;
  readonly version: number;
  readonly comments: string | null;
  readonly at: string;
  readonly by: PersonName | null;
}

export interface TechnicalReportReviewState {
  readonly submittedVersion: number | null;
  readonly submittedAt: string | null;
  readonly submittedBy: PersonName | null;
  readonly approvedVersion: number | null;
  readonly approvedAt: string | null;
  readonly approvedBy: PersonName | null;
  readonly decision: TechnicalReportDecisionView | null;
  readonly canSubmit: boolean;
  readonly canStartReview: boolean;
  readonly canDecide: boolean;
}

export interface TechnicalReportView {
  readonly id: string;
  readonly requestId: string;
  readonly analysisId: string;
  readonly version: number;
  readonly status: ReportStatus;
  readonly origin: 'AI' | 'MANUAL';
  readonly schemaVersion: number;
  readonly content: TechnicalReportContent;
  readonly generation: {
    readonly model: string;
    readonly reasoningEffort: string;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
  };
  readonly createdBy: PersonName | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly review: TechnicalReportReviewState;
}

export interface TechnicalReportReviewView {
  readonly id: string;
  readonly reportId: string;
  readonly version: number;
  readonly type: ReviewEventType;
  readonly comments: string | null;
  readonly at: string;
  readonly by: PersonName | null;
}

export interface PendingTechnicalReportView {
  readonly requestId: string;
  readonly reportId: string;
  readonly ticketCode: string;
  readonly customerName: string;
  readonly facilityName: string;
  readonly title: string;
  readonly version: number;
  readonly status: ReportStatus;
  readonly submittedAt: string | null;
  readonly submittedBy: PersonName | null;
}

export interface TechnicalReportReviewPacket {
  readonly request: {
    readonly ticketCode: string;
    readonly customerName: string;
    readonly facilityName: string;
  };
  readonly reports: TechnicalReportView[];
  readonly reviews: TechnicalReportReviewView[];
}

@Injectable()
export class TechnicalReportService {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly requests: PostSaleRequestService,
    private readonly analyses: TechnicalAnalysisService,
    private readonly privacy: PrivacyService,
    @Inject(REPORT_LANGUAGE_MODEL)
    private readonly model: ReportLanguageModel,
    @Inject(TECHNICAL_REPORT_REPOSITORY)
    private readonly reports: TechnicalReportRepository,
    @Inject(USER_DIRECTORY_REPOSITORY)
    private readonly profiles: Pick<UserDirectoryRepository, 'findProfiles'>,
  ) {}

  async generate(
    actor: AuthenticatedUser,
    requestId: string,
  ): Promise<TechnicalReportView> {
    if (!canGenerate(actor)) {
      throw new PostSaleRequestForbiddenError();
    }
    if (this.inFlight.has(requestId)) {
      throw new ReportGenerationConflictError();
    }
    this.inFlight.add(requestId);
    try {
      return await this.generateOnce(actor, requestId);
    } catch (error) {
      if (isFlowError(error)) {
        throw error;
      }
      throw new ReportProviderUnavailableError();
    } finally {
      this.inFlight.delete(requestId);
    }
  }

  async list(
    actor: AuthenticatedUser,
    requestId: string,
  ): Promise<TechnicalReportView[]> {
    await this.requests.get(actor, requestId);
    return this.present(await this.reports.listByRequestId(requestId), actor);
  }

  async get(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
  ): Promise<TechnicalReportView> {
    await this.requests.get(actor, requestId);
    const record = await this.reports.findById(reportId);
    if (!record || record.requestId !== requestId) {
      throw new ReportNotFoundError();
    }
    const [view] = await this.present([record], actor);
    if (!view) {
      throw new ReportNotFoundError();
    }
    return view;
  }

  async catalog(actor: AuthenticatedUser): Promise<TechnicalReportCatalogItem[]> {
    const visibility = requestVisibility(actor);
    const rows = await this.reports.listVisible(
      visibility.kind === 'all' ? null : visibility.specialistSub,
    );
    const views = await this.present(rows.map((row) => row.report), actor);
    return rows.map((row, index) => catalogItem(row, views[index]));
  }

  async saveRevision(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
    baseVersion: number,
    content: unknown,
  ): Promise<TechnicalReportView> {
    if (!canGenerate(actor)) {
      throw new PostSaleRequestForbiddenError();
    }
    try {
      return await this.saveRevisionOnce(actor, requestId, reportId, baseVersion, content);
    } catch (error) {
      if (isFlowError(error)) {
        throw error;
      }
      throw new ReportSaveUnavailableError();
    }
  }

  async versions(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
  ): Promise<TechnicalReportView[]> {
    const items = await this.list(actor, requestId);
    if (!items.some((item) => item.id === reportId)) {
      throw new ReportNotFoundError();
    }
    return items;
  }

  async submit(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
  ): Promise<TechnicalReportView> {
    if (!actor.roles.includes(UserRole.SPECIALIST)) {
      throw new ReportWorkflowError('No tiene permiso para realizar esta acción', 'forbidden');
    }
    return this.transition(actor, requestId, reportId, 'submit', null);
  }

  async startReview(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
  ): Promise<TechnicalReportView> {
    return this.transition(actor, requestId, reportId, 'start', null);
  }

  async approve(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
  ): Promise<TechnicalReportView> {
    return this.transition(actor, requestId, reportId, 'approve', null);
  }

  async requestChanges(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
    comments: string,
  ): Promise<TechnicalReportView> {
    return this.transition(actor, requestId, reportId, 'request-changes', comments);
  }

  async requireReanalysis(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
    comments: string,
  ): Promise<TechnicalReportView> {
    return this.transition(actor, requestId, reportId, 'require-reanalysis', comments);
  }

  async reviews(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
  ): Promise<TechnicalReportReviewView[]> {
    await this.visibleReport(actor, requestId, reportId);
    return this.reviewViews(requestId);
  }

  async reviewPacket(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
  ): Promise<TechnicalReportReviewPacket> {
    await this.visibleReport(actor, requestId, reportId);
    const label = await this.reports.requestLabel(requestId);
    if (!label) throw new ReportNotFoundError();
    const records = await this.reports.listByRequestId(requestId);
    return {
      request: label,
      reports: await this.present(records, actor),
      reviews: await this.reviewViews(requestId),
    };
  }

  async pendingReview(
    actor: AuthenticatedUser,
    page: number,
    pageSize: number,
  ): Promise<{
    items: PendingTechnicalReportView[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    if (!actor.roles.includes(UserRole.VALIDATOR)) {
      throw new ReportWorkflowError('No tiene permiso para realizar esta acción', 'forbidden');
    }
    const result = await this.reports.listPending(page, pageSize);
    const names = await this.creatorNames([
      ...result.items.map((item) => item.submittedBySub ?? ''),
    ]);
    return {
      page,
      pageSize,
      total: result.total,
      items: result.items.map((item) => ({
        requestId: item.report.requestId,
        reportId: item.report.id,
        ticketCode: item.ticketCode,
        customerName: item.customerName,
        facilityName: item.facilityName,
        title: item.report.content.title,
        version: item.report.version,
        status: item.report.status,
        submittedAt: item.submittedAt?.toISOString() ?? null,
        submittedBy: item.submittedBySub ? names.get(item.submittedBySub) ?? null : null,
      })),
    };
  }

  async approvedDocument(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
  ): Promise<{ report: TechnicalReportView; approval: { version: number; approvedAt: string; approver: PersonName | null } }> {
    const report = await this.visibleReport(actor, requestId, reportId);
    const events = await this.reports.listReviewEvents([requestId]);
    const approval = events.find(
      (event) => event.reportId === report.id && event.eventType === 'APPROVED',
    );
    if (report.status !== 'APPROVED' || !approval || approval.submittedVersion !== report.version) {
      throw new ReportWorkflowError(
        'El informe todavía no tiene una aprobación registrada para esta versión.',
        'conflict',
      );
    }
    const [view] = await this.present([report], actor);
    if (!view) throw new ReportNotFoundError();
    const names = await this.creatorNames([approval.actorSub]);
    return {
      report: view,
      approval: {
        version: approval.submittedVersion,
        approvedAt: approval.createdAt.toISOString(),
        approver: names.get(approval.actorSub) ?? null,
      },
    };
  }

  private async generateOnce(
    actor: AuthenticatedUser,
    requestId: string,
  ): Promise<TechnicalReportView> {
    const detail = await this.requests.getDetail(actor, requestId);
    const dataset = await this.requests.getTechnicalDataset(actor, requestId);
    const analysis = await this.latestSuccessfulAnalysis(actor, detail.request.id);
    const source = protectionSource(detail.request, detail.assignedSpecialist, dataset, analysis);
    const protectedTransfer = await this.privacy.protectAnalysisTransfer(actor, source);
    assertOutboundSafe(protectedTransfer.payload, prohibitedIdentifiers(source));
    const generated = await this.model.generate(protectedTransfer.payload);
    parseTechnicalReportContent(generated.content);
    const restored = await this.privacy.detokenizeObject(
      actor,
      protectedTransfer.contextId,
      generated.content,
    );
    const content = parseTechnicalReportContent(restored);
    assertReportConsistent(
      content,
      reportConsistencyInput(detail.request, dataset, analysis.findings),
    );
    const versions = await this.reports.listByRequestId(detail.request.id);
    const latest = versions[0] ?? null;
    if (!canGenerateReport(latest?.status ?? null, latest?.analysisId === analysis.id)) {
      throw new ReportWorkflowError(
        latest?.status === 'REANALYSIS_REQUIRED'
          ? 'Ejecute un análisis técnico nuevo antes de generar el informe.'
          : 'El informe no admite una generación nueva en su estado actual.',
        'conflict',
      );
    }
    const createdAt = new Date();
    const record = await this.reports.insert({
      id: randomUUID(),
      requestId: detail.request.id,
      analysisId: analysis.id,
      status: 'DRAFT',
      schemaVersion: content.schemaVersion,
      content,
      model: generated.model,
      reasoningEffort: generated.reasoningEffort,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      createdBySub: actor.userId,
      origin: 'AI',
      createdAt,
    });
    await this.requests.recordActivity({
      actor,
      requestId: detail.request.id,
      eventType: 'REPORT_GENERATED',
      dedupeKey: `report:${record.id}:generated`,
      preferredRole: UserRole.SPECIALIST,
      technicalAnalysisId: analysis.id,
      technicalReportId: record.id,
      reportVersion: record.version,
      metadata: { origin: 'AI' },
      occurredAt: createdAt,
    });
    const [view] = await this.present([record], actor);
    if (!view) {
      throw new ReportProviderUnavailableError();
    }
    return view;
  }

  private async latestSuccessfulAnalysis(
    actor: AuthenticatedUser,
    requestId: string,
  ): Promise<TechnicalAnalysisRecord> {
    const records = await this.analyses.list(actor, requestId);
    const analysis = records.find(
      (item) => item.status === 'SUCCEEDED' && item.requestId === requestId,
    );
    if (!analysis) {
      throw new ReportPrerequisiteError();
    }
    return analysis;
  }

  private async saveRevisionOnce(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
    baseVersion: number,
    submitted: unknown,
  ): Promise<TechnicalReportView> {
    const detail = await this.requests.getDetail(actor, requestId);
    const current = await this.reports.findById(reportId);
    if (!current || current.requestId !== detail.request.id) {
      throw new ReportNotFoundError();
    }
    const versions = await this.reports.listByRequestId(detail.request.id);
    const latest = versions[0];
    if (!latest || latest.version !== baseVersion) {
      throw new ReportRevisionConflictError();
    }
    if (!canRevise(latest.status)) {
      throw new ReportWorkflowError(revisionMessage(latest.status), 'conflict');
    }
    const records = await this.analyses.list(actor, detail.request.id);
    const analysis = records.find(
      (item) => item.id === current.analysisId && item.status === 'SUCCEEDED',
    );
    if (!analysis) {
      throw new ReportPrerequisiteError();
    }
    const content = parseTechnicalReportContent(submitted);
    assertReportConsistent(
      content,
      reportConsistencyInput(detail.request, {
        demandThreshold: analysis.inputSnapshot.demandThreshold,
        evaluationConsumption: analysis.inputSnapshot.evaluationConsumption,
        telemetry: [...analysis.inputSnapshot.telemetry],
        historicalConsumption: [...analysis.inputSnapshot.historicalConsumption],
      }, analysis.findings),
    );
    const createdAt = new Date();
    const record = await this.reports.insert({
      id: randomUUID(),
      requestId: detail.request.id,
      analysisId: current.analysisId,
      status: 'DRAFT',
      schemaVersion: content.schemaVersion,
      content,
      model: current.model,
      reasoningEffort: current.reasoningEffort,
      inputTokens: null,
      outputTokens: null,
      createdBySub: actor.userId,
      origin: 'MANUAL',
      expectedLatestVersion: baseVersion,
      createdAt,
    });
    if (latest.status === 'CHANGES_REQUESTED') {
      await this.requests.recordActivity({
        actor,
        requestId: detail.request.id,
        eventType: 'REPORT_REVISED',
        dedupeKey: `report:${record.id}:revised`,
        preferredRole: UserRole.SPECIALIST,
        technicalAnalysisId: current.analysisId,
        technicalReportId: record.id,
        reportVersion: record.version,
        metadata: { origin: 'MANUAL' },
        occurredAt: createdAt,
      });
    }
    const [view] = await this.present([record], actor);
    if (!view) {
      throw new ReportProviderUnavailableError();
    }
    return view;
  }

  private async present(
    records: readonly TechnicalReportRecord[],
    actor: AuthenticatedUser,
  ): Promise<TechnicalReportView[]> {
    const requestIds = [...new Set(records.map((record) => record.requestId))];
    const events = await this.reports.listReviewEvents(requestIds);
    const names = await this.creatorNames([
      ...records.map((record) => record.createdBySub),
      ...events.map((event) => event.actorSub),
    ]);
    const latestByRequest = new Map<string, number>();
    for (const record of records) {
      const current = latestByRequest.get(record.requestId) ?? 0;
      if (record.version > current) latestByRequest.set(record.requestId, record.version);
    }
    return records.map((record) => ({
      id: record.id,
      requestId: record.requestId,
      analysisId: record.analysisId,
      version: record.version,
      status: record.status,
      origin: record.origin,
      schemaVersion: record.schemaVersion,
      content: record.content,
      generation: {
        model: record.model,
        reasoningEffort: record.reasoningEffort,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
      },
      createdBy: names.get(record.createdBySub) ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      review: reviewState(
        record,
        events.filter((event) => event.requestId === record.requestId),
        names,
        actor,
        latestByRequest.get(record.requestId) === record.version,
      ),
    }));
  }

  private async transition(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
    action: ReviewAction,
    comments: string | null,
  ): Promise<TechnicalReportView> {
    const report = await this.visibleReport(actor, requestId, reportId);
    const versions = await this.reports.listByRequestId(requestId);
    const latest = versions[0];
    if (!latest || latest.id !== report.id) {
      throw new ReportWorkflowError('Solo puede actuar sobre la versión más reciente.', 'conflict');
    }
    const transition = transitionFor(action);
    if (action === 'submit') {
      const analyses = await this.analyses.list(actor, requestId);
      const analysis = analyses.find(
        (item) => item.id === report.analysisId && item.status === 'SUCCEEDED',
      );
      if (!analysis) throw new ReportPrerequisiteError();
    } else {
      this.assertCanValidate(actor, report.createdBySub);
    }
    if (report.status !== transition.from) {
      throw new ReportWorkflowError('El estado del informe no admite esta acción.', 'conflict');
    }
    const events = await this.reports.listReviewEvents([requestId]);
    const slots = events
      .filter((event) => event.reportId === report.id)
      .map((event) => event.slot);
    if (!acceptedReviewSlot(slots, transition.slot)) {
      throw new ReportWorkflowError(
        'Esta versión ya tiene una decisión de validación.',
        'conflict',
      );
    }
    const text =
      action === 'request-changes' || action === 'require-reanalysis'
        ? reviewComments(comments ?? '')
        : null;
    if ((action === 'request-changes' || action === 'require-reanalysis') && !text) {
      throw new ReportWorkflowError('El comentario es obligatorio.', 'invalid');
    }
    const createdAt = new Date();
    const record = await this.reports.applyReview({
      id: randomUUID(),
      reportId: report.id,
      requestId,
      submittedVersion: report.version,
      eventType: transition.event,
      slot: transition.slot,
      actorSub: actor.userId,
      comments: text,
      analysisId: action === 'require-reanalysis' ? report.analysisId : null,
      createdAt,
      expectedStatus: transition.from,
      nextStatus: transition.to,
    });
    await this.requests.recordActivity({
      actor,
      requestId,
      eventType: requestActivityFor(action),
      dedupeKey: `report:${report.id}:${action}`,
      preferredRole: action === 'submit' ? UserRole.SPECIALIST : UserRole.VALIDATOR,
      technicalAnalysisId: action === 'require-reanalysis' ? report.analysisId : null,
      technicalReportId: report.id,
      reportVersion: report.version,
      metadata: text ? { comments: text } : null,
      occurredAt: createdAt,
    });
    const [view] = await this.present([record], actor);
    if (!view) throw new ReportNotFoundError();
    return view;
  }

  private async visibleReport(
    actor: AuthenticatedUser,
    requestId: string,
    reportId: string,
  ): Promise<TechnicalReportRecord> {
    const report = await this.reports.findById(reportId);
    if (!report || report.requestId !== requestId) throw new ReportNotFoundError();
    if (actor.roles.includes(UserRole.VALIDATOR)) return report;
    await this.requests.get(actor, requestId);
    return report;
  }

  private assertCanValidate(actor: AuthenticatedUser, authorSub: string): void {
    const decision = decideReportValidation(actor, authorSub);
    if (decision.allowed) return;
    throw new ReportWorkflowError(
      decision.reason === 'SELF_VALIDATION'
        ? 'No puede validar un informe del que es autor.'
        : 'No tiene permiso para realizar esta acción',
      'forbidden',
    );
  }

  private async reviewViews(requestId: string): Promise<TechnicalReportReviewView[]> {
    const events = await this.reports.listReviewEvents([requestId]);
    const names = await this.creatorNames(events.map((event) => event.actorSub));
    return events.map((event) => ({
      id: event.id,
      reportId: event.reportId,
      version: event.submittedVersion,
      type: event.eventType,
      comments: event.comments,
      at: event.createdAt.toISOString(),
      by: names.get(event.actorSub) ?? null,
    }));
  }

  private async creatorNames(
    subs: readonly string[],
  ): Promise<Map<string, { firstName: string; lastName: string }>> {
    const names = new Map<string, { firstName: string; lastName: string }>();
    const unique = [...new Set(subs.filter((sub) => sub.trim().length > 0))];
    if (unique.length === 0) {
      return names;
    }
    try {
      const profiles = await this.profiles.findProfiles(unique);
      for (const profile of profiles) {
        const firstName = profile.firstName.trim();
        const lastName = profile.lastName.trim();
        if (firstName && lastName) {
          names.set(profile.cognitoSub, { firstName, lastName });
        }
      }
    } catch {
      return names;
    }
    return names;
  }
}

function reviewState(
  record: TechnicalReportRecord,
  events: readonly TechnicalReportReviewRecord[],
  names: Map<string, PersonName>,
  actor: AuthenticatedUser,
  isLatest: boolean,
): TechnicalReportReviewState {
  const own = events.filter((event) => event.reportId === record.id);
  const submitted = own.find((event) => event.eventType === 'SUBMITTED');
  const approved = own.find((event) => event.eventType === 'APPROVED');
  const decision = [...events]
    .reverse()
    .find(
      (event) =>
        event.submittedVersion <= record.version &&
        (event.eventType === 'APPROVED' ||
          event.eventType === 'CHANGES_REQUESTED' ||
          event.eventType === 'REANALYSIS_REQUIRED'),
    );
  const validator = decideReportValidation(actor, record.createdBySub).allowed;
  return {
    submittedVersion: submitted?.submittedVersion ?? null,
    submittedAt: submitted?.createdAt.toISOString() ?? null,
    submittedBy: submitted ? names.get(submitted.actorSub) ?? null : null,
    approvedVersion: approved?.submittedVersion ?? null,
    approvedAt: approved?.createdAt.toISOString() ?? null,
    approvedBy: approved ? names.get(approved.actorSub) ?? null : null,
    decision:
      decision &&
      (decision.eventType === 'APPROVED' ||
        decision.eventType === 'CHANGES_REQUESTED' ||
        decision.eventType === 'REANALYSIS_REQUIRED')
        ? {
            type: decision.eventType,
            version: decision.submittedVersion,
            comments: decision.comments,
            at: decision.createdAt.toISOString(),
            by: names.get(decision.actorSub) ?? null,
          }
        : null,
    canSubmit: isLatest && record.status === 'DRAFT' && actor.roles.includes(UserRole.SPECIALIST),
    canStartReview: isLatest && record.status === 'PENDING_VALIDATION' && validator,
    canDecide: isLatest && record.status === 'UNDER_REVIEW' && validator,
  };
}

function revisionMessage(status: ReportStatus): string {
  if (status === 'APPROVED') return 'La versión aprobada no se puede modificar.';
  if (status === 'PENDING_VALIDATION' || status === 'UNDER_REVIEW') {
    return 'El informe está en validación y no se puede modificar.';
  }
  if (status === 'REANALYSIS_REQUIRED') {
    return 'Debe ejecutar un análisis técnico nuevo antes de modificar el informe.';
  }
  return 'El informe no admite una edición en su estado actual.';
}

function protectionSource(
  request: PostSaleRequest,
  assignedSpecialist: AnalysisProtectionSource['assignedSpecialist'],
  dataset: TechnicalDataset,
  analysis: TechnicalAnalysisRecord,
): AnalysisProtectionSource {
  return {
    request,
    assignedSpecialist,
    dataset: {
      demandThreshold: dataset.demandThreshold,
      demandUnit: dataset.demandUnit,
      evaluationConsumption: dataset.evaluationConsumption,
      consumptionUnit: dataset.consumptionUnit,
      sourceName: dataset.sourceName,
      sourceKind: dataset.sourceKind,
      telemetry: dataset.telemetry,
      historicalConsumption: dataset.historicalConsumption,
    },
    analysis: {
      id: analysis.id,
      status: analysis.status,
      executedAt: analysis.executedAt.toISOString(),
      executedBySub: analysis.executedBySub,
      failureMessage: analysis.failureMessage,
      findings: analysis.findings,
      inputSnapshot: analysis.inputSnapshot,
    },
  };
}

function prohibitedIdentifiers(source: AnalysisProtectionSource): string[] {
  return [
    source.request.customerName,
    source.request.customerId,
    source.request.facilityName,
    source.request.assetId,
    source.request.ticketCode,
    source.request.id,
    source.request.assignedSpecialistSub,
    source.analysis.executedBySub,
    source.analysis.id,
    source.assignedSpecialist?.firstName,
    source.assignedSpecialist?.lastName,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function catalogItem(
  row: TechnicalReportCatalogRow,
  report: TechnicalReportView | undefined,
): TechnicalReportCatalogItem {
  if (!report) {
    throw new ReportProviderUnavailableError();
  }
  return {
    ticketCode: row.ticketCode,
    customerName: row.customerName,
    facilityName: row.facilityName,
    requestType: row.requestType,
    report,
  };
}

function requestActivityFor(action: ReviewAction): RequestActivityEvent {
  switch (action) {
    case 'submit':
      return 'REPORT_SUBMITTED';
    case 'start':
      return 'REVIEW_STARTED';
    case 'approve':
      return 'REPORT_APPROVED';
    case 'request-changes':
      return 'CHANGES_REQUESTED';
    case 'require-reanalysis':
      return 'REANALYSIS_REQUIRED';
  }
}

function canGenerate(actor: AuthenticatedUser): boolean {
  return (
    actor.roles.includes(UserRole.ADMINISTRATOR) ||
    actor.roles.includes(UserRole.SPECIALIST)
  );
}

function isFlowError(error: unknown): boolean {
  return (
    error instanceof ReportPrerequisiteError ||
    error instanceof ReportContentInvalidError ||
    error instanceof ReportProviderUnavailableError ||
    error instanceof ReportGenerationConflictError ||
    error instanceof ReportNotFoundError ||
    error instanceof ReportRevisionConflictError ||
    error instanceof ReportWorkflowError ||
    error instanceof PostSaleRequestNotFoundError ||
    error instanceof PostSaleRequestForbiddenError ||
    error instanceof PostSaleRequestPersistenceError ||
    error instanceof TechnicalDatasetNotFoundError ||
    error instanceof PrivacyProtectionError ||
    error instanceof PrivacyAuthorizationError ||
    error instanceof UnknownPrivacyTokenError ||
    error instanceof MalformedPrivacyTokenError
  );
}
