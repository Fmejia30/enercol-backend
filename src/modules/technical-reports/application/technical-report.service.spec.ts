import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { PrivacyService } from '../../privacy/application/privacy.service.js';
import { AesGcmPrivacyCipher } from '../../privacy/infrastructure/aes-gcm-privacy-cipher.js';
import { MemoryTokenVaultRepository } from '../../privacy/infrastructure/memory-token-vault.repository.js';
import { PrivacyProtectionError } from '../../privacy/domain/privacy-error.js';
import { PostSaleRequestService } from '../../post-sale-requests/application/post-sale-request.service.js';
import { TechnicalAnalysisService } from '../../post-sale-requests/application/technical-analysis.service.js';
import type { TechnicalAnalysisRecord } from '../../post-sale-requests/application/technical-analysis.repository.js';
import { analyzeTechnicalDataset } from '../../post-sale-requests/domain/technical-analysis.js';
import type { AnalysisFinding } from '../../post-sale-requests/domain/technical-analysis.js';
import type { PostSaleRequest } from '../../post-sale-requests/domain/post-sale-request.js';
import {
  PostSaleRequestForbiddenError,
  PostSaleRequestNotFoundError,
} from '../../post-sale-requests/domain/post-sale-request-error.js';
import type { TechnicalDataset } from '../../post-sale-requests/domain/technical-dataset.js';
import type { ReportLanguageModel } from './report-language-model.js';
import type {
  PendingTechnicalReportRow,
  TechnicalReportCatalogRow,
  TechnicalReportInsert,
  TechnicalReportRecord,
  TechnicalReportRepository,
  TechnicalReportRequestLabel,
  TechnicalReportReviewCommand,
  TechnicalReportReviewRecord,
} from './technical-report.repository.js';
import { TechnicalReportService } from './technical-report.service.js';
import type { TechnicalReportContent } from '../domain/report-content.js';
import {
  ReportContentInvalidError,
  ReportGenerationConflictError,
  ReportPrerequisiteError,
  ReportRevisionConflictError,
  ReportWorkflowError,
} from '../domain/report-error.js';
import { acceptedReviewSlot } from '../domain/report-workflow.js';

const KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const SPECIALIST_SUB = 'specialist-sub-act05';
const CUSTOMER = 'Textiles del Altiplano S.A.S.';
const PHONE = '55551234';

const specialist: AuthenticatedUser = {
  userId: SPECIALIST_SUB,
  roles: [UserRole.SPECIALIST],
};
const administrator: AuthenticatedUser = {
  userId: 'administrator-sub-act05',
  roles: [UserRole.ADMINISTRATOR],
};
const validator: AuthenticatedUser = {
  userId: 'validator-sub-act05',
  roles: [UserRole.VALIDATOR],
};
const otherSpecialist: AuthenticatedUser = {
  userId: 'other-specialist-sub',
  roles: [UserRole.SPECIALIST],
};

const request: PostSaleRequest = {
  id: '6f1c2a10-4b7e-4a1d-9c31-a05000000001',
  ticketCode: 'PV-A05-001',
  customerId: 'CLI-A05-001',
  customerName: CUSTOMER,
  facilityName: 'Planta Fontibón',
  assetId: 'MED-FTB-014',
  assignedSpecialistSub: SPECIALIST_SUB,
  type: 'VERIFICACION_DEMANDA',
  description:
    'Caso controlado para comparar la demanda medida, en kW, con el umbral contractual de 250.000 kW.',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-07',
  status: 'ABIERTA',
  createdAt: new Date('2026-09-08T12:00:00.000Z'),
};

const dataset: TechnicalDataset = {
  requestId: request.id,
  periodStart: request.periodStart,
  periodEnd: request.periodEnd,
  demandThreshold: '250.000',
  demandUnit: 'kW',
  evaluationConsumption: null,
  consumptionUnit: 'kWh',
  sourceName: 'Conjunto técnico controlado Act-05',
  sourceKind: 'local-controlled-dataset',
  telemetry: [
    { measuredAt: '2026-09-03T15:00:00.000Z', measuredDemand: '210.000' },
    { measuredAt: '2026-09-03T15:15:00.000Z', measuredDemand: '248.500' },
    { measuredAt: '2026-09-03T15:30:00.000Z', measuredDemand: '267.250' },
    { measuredAt: '2026-09-03T15:45:00.000Z', measuredDemand: '241.000' },
  ],
  historicalConsumption: [
    { periodStart: '2026-07-01', periodEnd: '2026-07-31', consumption: '142300.000' },
    { periodStart: '2026-08-01', periodEnd: '2026-08-31', consumption: '148750.500' },
  ],
};

const outcome = analyzeTechnicalDataset(request, dataset);
const analysis: TechnicalAnalysisRecord = {
  id: '6f1c2a10-4b7e-4a1d-9c31-a05000000021',
  requestId: request.id,
  status: 'SUCCEEDED',
  executedAt: new Date('2026-09-08T15:00:00.000Z'),
  executedBySub: SPECIALIST_SUB,
  failureMessage: null,
  findings: outcome.findings,
  inputSnapshot: outcome.inputSnapshot,
};

describe('TechnicalReportService', () => {
  it('tokenizes the outbound payload, detokenizes with the same context, and stores a new draft', async () => {
    const harness = createHarness(echoModel());
    const report = await harness.service.generate(specialist, request.id);
    const serialized = JSON.stringify(harness.payloads[0]);

    expect(serialized).not.toContain(CUSTOMER);
    expect(serialized).not.toContain(request.ticketCode);
    expect(serialized).not.toContain(SPECIALIST_SUB);
    expect(serialized).not.toContain(PHONE);
    expect(serialized).toContain('267.250');
    expect(harness.detokenizedContext).toBe(harness.protectedContext);
    expect(report.content.identification.ticketCode).toBe(request.ticketCode);
    expect(report.content.background).toContain(CUSTOMER);
    expect(report.content.technicalFindings[0]?.measuredValue).toBe('267.250');
    expect(report.content.technicalFindings[0]?.interpretation).toBe(
      'confirmed-observation',
    );
    expect(report.content.hypotheses[0]?.statement).toMatch(/hipótesis/i);
    expect(report.content.financialImpact.status).toBe('unavailable');
    expect(report.status).toBe('DRAFT');
    expect(report.version).toBe(1);
    expect(report.generation).toEqual({
      model: 'gpt-6-luna',
      reasoningEffort: 'low',
      inputTokens: 321,
      outputTokens: 654,
    });
    expect(report.createdBy).toEqual({ firstName: 'Carlos', lastName: 'Méndez' });
    expect(JSON.stringify(report)).not.toContain(SPECIALIST_SUB);
    expect(harness.repository.rows).toHaveLength(1);

    const second = await harness.service.generate(administrator, request.id);
    expect(second.version).toBe(2);
    expect(harness.repository.rows[0]?.version).toBe(1);
    expect(harness.repository.rows[0]?.content.technicalFindings[0]?.measuredValue).toBe(
      '267.250',
    );
  });

  it('rejects an unprotected payload before calling the model', async () => {
    const model = echoModel();
    const harness = createHarness(model, {
      protectAnalysisTransfer: async () => ({
        contextId: 'context-1',
        payload: { customerName: CUSTOMER },
      }),
    });
    await expect(harness.service.generate(specialist, request.id)).rejects.toBeInstanceOf(
      PrivacyProtectionError,
    );
    expect(model.calls).toBe(0);
    expect(harness.repository.rows).toHaveLength(0);
  });

  it('does not save a report when privacy protection, the provider, or the content fails', async () => {
    const blocked = createHarness(echoModel(), {
      protectAnalysisTransfer: async () => {
        throw new PrivacyProtectionError();
      },
    });
    await expect(blocked.service.generate(specialist, request.id)).rejects.toBeInstanceOf(
      PrivacyProtectionError,
    );
    expect(blocked.repository.rows).toHaveLength(0);

    const provider = createHarness({
      generate: async () => {
        throw new Error(`timeout sk-live-secret ${CUSTOMER}`);
      },
    });
    await expect(provider.service.generate(specialist, request.id)).rejects.toThrow(
      /^No fue posible generar el informe$/,
    );
    expect(provider.repository.rows).toHaveLength(0);

    const invalid = createHarness({
      generate: async (payload) => ({
        content: {
          ...protectedDraft(payload, analysis.findings),
          technicalFindings: [
            {
              ...protectedDraft(payload, analysis.findings).technicalFindings[0],
              measuredValue: '999.000',
            },
          ],
        },
        model: 'gpt-6-luna',
        reasoningEffort: 'low',
        inputTokens: 1,
        outputTokens: 1,
      }),
    });
    await expect(invalid.service.generate(specialist, request.id)).rejects.toBeInstanceOf(
      ReportContentInvalidError,
    );
    expect(invalid.repository.rows).toHaveLength(0);
  });

  it('rejects a repeated submission while generation is in progress', async () => {
    let release = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model: ReportLanguageModel = {
      async generate(payload) {
        await gate;
        return resultFrom(payload);
      },
    };
    const harness = createHarness(model);
    const first = harness.service.generate(specialist, request.id);
    await expect(harness.service.generate(specialist, request.id)).rejects.toBeInstanceOf(
      ReportGenerationConflictError,
    );
    release();
    await first;
    expect(harness.repository.rows).toHaveLength(1);
  });

  it('requires a successful analysis that belongs to the visible request', async () => {
    const failed = createHarness(echoModel(), undefined, [
      { ...analysis, status: 'FAILED', findings: [] },
    ]);
    await expect(failed.service.generate(specialist, request.id)).rejects.toBeInstanceOf(
      ReportPrerequisiteError,
    );
    expect(failed.repository.rows).toHaveLength(0);

    const foreign = createHarness(echoModel(), undefined, [
      { ...analysis, requestId: '6f1c2a10-4b7e-4a1d-9c31-a05000000099' },
    ]);
    await expect(foreign.service.generate(specialist, request.id)).rejects.toBeInstanceOf(
      ReportPrerequisiteError,
    );
    expect(foreign.modelCalls()).toBe(0);
  });

  it('keeps generation to specialist and administrator, and reading to visible requests', async () => {
    const harness = createHarness(echoModel());
    await expect(harness.service.generate(validator, request.id)).rejects.toBeInstanceOf(
      PostSaleRequestForbiddenError,
    );
    await expect(
      harness.service.generate(otherSpecialist, request.id),
    ).rejects.toBeInstanceOf(PostSaleRequestNotFoundError);
    expect(harness.repository.rows).toHaveLength(0);

    const created = await harness.service.generate(specialist, request.id);
    const listed = await harness.service.list(specialist, request.id);
    expect(listed.map((item) => item.id)).toEqual([created.id]);
    await expect(harness.service.list(validator, request.id)).rejects.toBeInstanceOf(
      PostSaleRequestNotFoundError,
    );
    await expect(
      harness.service.get(otherSpecialist, request.id, created.id),
    ).rejects.toBeInstanceOf(PostSaleRequestNotFoundError);
    const history = await harness.service.versions(specialist, request.id, created.id);
    expect(history).toHaveLength(1);
    await expect(
      harness.service.versions(specialist, request.id, 'missing-report'),
    ).rejects.toThrow('No existe un informe con ese identificador');
  });

  it('saves a narrative edit as a new version and keeps the deterministic values', async () => {
    const model = echoModel();
    const harness = createHarness(model);
    const created = await harness.service.generate(specialist, request.id);
    expect(created.origin).toBe('AI');
    const edited = {
      ...created.content,
      executiveSummary: 'El especialista precisa el resumen sin cambiar la medición.',
    };
    const saved = await harness.service.saveRevision(
      specialist,
      request.id,
      created.id,
      created.version,
      edited,
    );
    expect(saved.version).toBe(2);
    expect(saved.origin).toBe('MANUAL');
    expect(saved.generation.inputTokens).toBeNull();
    expect(saved.content.technicalFindings[0]?.measuredValue).toBe('267.250');
    expect(saved.content.executiveSummary).toBe(edited.executiveSummary);
    expect(harness.repository.rows.map((row) => row.version)).toEqual([1, 2]);
    expect(model.calls).toBe(1);

    const changed = {
      ...edited,
      technicalFindings: edited.technicalFindings.map((finding, index) =>
        index === 0 ? { ...finding, measuredValue: '999.000' } : finding,
      ),
    };
    await expect(
      harness.service.saveRevision(
        specialist,
        request.id,
        created.id,
        saved.version,
        changed,
      ),
    ).rejects.toBeInstanceOf(ReportContentInvalidError);
    expect(harness.repository.rows).toHaveLength(2);

    await expect(
      harness.service.saveRevision(
        specialist,
        request.id,
        created.id,
        created.version,
        edited,
      ),
    ).rejects.toBeInstanceOf(ReportRevisionConflictError);
    await expect(
      harness.service.saveRevision(validator, request.id, created.id, saved.version, edited),
    ).rejects.toBeInstanceOf(PostSaleRequestForbiddenError);

    const catalog = await harness.service.catalog(administrator);
    expect(catalog.map((item) => item.report.version)).toEqual([1, 2]);
    expect(catalog[0]?.ticketCode).toBe(request.ticketCode);
    expect(JSON.stringify(catalog)).not.toContain(SPECIALIST_SUB);
    await expect(harness.service.catalog(otherSpecialist)).resolves.toEqual([]);
  });

  it('submits a draft and keeps that version unchanged through approval', async () => {
    const harness = createHarness(echoModel());
    const draft = await harness.service.generate(specialist, request.id);
    const submitted = await harness.service.submit(specialist, request.id, draft.id);
    expect(submitted.status).toBe('PENDING_VALIDATION');
    expect(submitted.review.submittedVersion).toBe(1);
    expect(submitted.content.technicalFindings[0]?.measuredValue).toBe('267.250');
    expect(JSON.stringify(submitted)).not.toContain(SPECIALIST_SUB);

    await expect(harness.service.approve(validator, request.id, draft.id)).rejects.toBeInstanceOf(
      ReportWorkflowError,
    );
    await expect(
      harness.service.saveRevision(specialist, request.id, draft.id, 1, {
        ...draft.content,
        executiveSummary: 'Cambio durante la revisión.',
      }),
    ).rejects.toBeInstanceOf(ReportWorkflowError);
    await expect(harness.service.approve(specialist, request.id, draft.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(
      harness.service.approve(
        { userId: SPECIALIST_SUB, roles: [UserRole.VALIDATOR, UserRole.SPECIALIST] },
        request.id,
        draft.id,
      ),
    ).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(harness.service.approve(administrator, request.id, draft.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });

    const started = await harness.service.startReview(validator, request.id, draft.id);
    expect(started.status).toBe('UNDER_REVIEW');
    const approved = await harness.service.approve(validator, request.id, draft.id);
    expect(approved.status).toBe('APPROVED');
    expect(approved.review.approvedVersion).toBe(1);
    expect(approved.review.approvedBy).toEqual({ firstName: 'Laura', lastName: 'Pineda' });
    expect(approved.content).toEqual(draft.content);
    await expect(harness.service.approve(validator, request.id, draft.id)).rejects.toBeInstanceOf(
      ReportWorkflowError,
    );
    await expect(
      harness.service.approvedDocument(specialist, request.id, draft.id),
    ).resolves.toMatchObject({
      approval: { version: 1 },
      report: { id: draft.id, version: 1, status: 'APPROVED' },
    });
    const history = await harness.service.reviews(specialist, request.id, draft.id);
    expect(history.map((event) => event.type)).toEqual([
      'SUBMITTED',
      'REVIEW_STARTED',
      'APPROVED',
    ]);
  });

  it('requests changes without approving the corrected revision', async () => {
    const harness = createHarness(echoModel());
    const draft = await harness.service.generate(specialist, request.id);
    await harness.service.submit(specialist, request.id, draft.id);
    await harness.service.startReview(validator, request.id, draft.id);
    await expect(
      harness.service.requestChanges(validator, request.id, draft.id, '   '),
    ).rejects.toMatchObject({ kind: 'invalid' });
    const returned = await harness.service.requestChanges(
      validator,
      request.id,
      draft.id,
      'Corregir el alcance.',
    );
    expect(returned.status).toBe('CHANGES_REQUESTED');
    expect(returned.review.decision?.comments).toBe('Corregir el alcance.');
    await expect(harness.service.approve(validator, request.id, draft.id)).rejects.toBeInstanceOf(
      ReportWorkflowError,
    );

    const corrected = await harness.service.saveRevision(specialist, request.id, draft.id, 1, {
      ...draft.content,
      executiveSummary: 'Alcance corregido.',
    });
    expect(corrected.version).toBe(2);
    expect(corrected.status).toBe('DRAFT');
    expect(corrected.review.approvedVersion).toBeNull();
    expect(corrected.content.executiveSummary).toBe('Alcance corregido.');
    expect(harness.repository.rows[0]?.status).toBe('CHANGES_REQUESTED');
    expect(harness.repository.rows[0]?.content.executiveSummary).toContain('explica el análisis');
    await expect(
      harness.service.approvedDocument(specialist, request.id, corrected.id),
    ).rejects.toBeInstanceOf(ReportWorkflowError);
    const history = await harness.service.reviews(specialist, request.id, corrected.id);
    expect(history.some((event) => event.type === 'CHANGES_REQUESTED')).toBe(true);
  });

  it('requires a new analysis and preserves the previous decision', async () => {
    const harness = createHarness(echoModel());
    const draft = await harness.service.generate(specialist, request.id);
    await harness.service.submit(specialist, request.id, draft.id);
    await harness.service.startReview(validator, request.id, draft.id);
    await expect(
      harness.service.requireReanalysis(validator, request.id, draft.id, ''),
    ).rejects.toMatchObject({ kind: 'invalid' });
    const blocked = await harness.service.requireReanalysis(
      validator,
      request.id,
      draft.id,
      'La medición debe volver a calcularse.',
    );
    expect(blocked.status).toBe('REANALYSIS_REQUIRED');
    await expect(harness.service.generate(specialist, request.id)).rejects.toBeInstanceOf(
      ReportWorkflowError,
    );
    await expect(
      harness.service.approvedDocument(validator, request.id, draft.id),
    ).rejects.toBeInstanceOf(ReportWorkflowError);

    const replacement = { ...analysis, id: 'analysis-rebuilt' };
    const rebuilt = createHarness(echoModel(), undefined, [replacement, analysis]);
    rebuilt.repository.rows.push(...harness.repository.rows);
    rebuilt.repository.events.push(...harness.repository.events);
    const next = await rebuilt.service.generate(specialist, request.id);
    expect(next.version).toBe(2);
    expect(next.status).toBe('DRAFT');
    expect(next.analysisId).toBe(replacement.id);
    expect(next.review.approvedVersion).toBeNull();
    const history = await rebuilt.service.reviews(specialist, request.id, next.id);
    expect(history.map((event) => event.type)).toContain('REANALYSIS_REQUIRED');
  });

  it('lists only reports waiting for a validator', async () => {
    const harness = createHarness(echoModel());
    const draft = await harness.service.generate(specialist, request.id);
    await expect(harness.service.pendingReview(specialist, 1, 20)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await harness.service.submit(specialist, request.id, draft.id);
    const page = await harness.service.pendingReview(validator, 1, 20);
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      reportId: draft.id,
      ticketCode: request.ticketCode,
      version: 1,
      status: 'PENDING_VALIDATION',
      submittedBy: { firstName: 'Carlos', lastName: 'Méndez' },
    });
    expect(JSON.stringify(page)).not.toContain(SPECIALIST_SUB);
  });
});

function createHarness(
  model: ReportLanguageModel & { calls?: number },
  privacyOverride?: Partial<
    Pick<PrivacyService, 'protectAnalysisTransfer' | 'detokenizeObject'>
  >,
  analyses: TechnicalAnalysisRecord[] = [analysis],
) {
  const visible = (actor: AuthenticatedUser) =>
    actor.roles.includes(UserRole.ADMINISTRATOR) ||
    actor.userId === request.assignedSpecialistSub;
  const requests = {
    async get(actor: AuthenticatedUser, id: string) {
      if (!visible(actor) || id !== request.id) {
        throw new PostSaleRequestNotFoundError();
      }
      return request;
    },
    async getDetail(actor: AuthenticatedUser, id: string) {
      const current = await this.get(actor, id);
      return {
        request: current,
        assignedSpecialist: { firstName: 'Carlos', lastName: 'Méndez' },
      };
    },
    async getTechnicalDataset() {
      return dataset;
    },
    async recordActivity() {
      return undefined;
    },
  };
  const analysisService = {
    async list(actor: AuthenticatedUser, id: string) {
      await requests.get(actor, id);
      return analyses;
    },
  };
  const vault = new MemoryTokenVaultRepository();
  const cipher = new AesGcmPrivacyCipher({
    get: (key: string) => (key === 'privacyEncryptionKey' ? KEY : null),
  } as ConfigService);
  const realPrivacy = new PrivacyService(
    vault,
    cipher,
    requests as unknown as PostSaleRequestService,
    analysisService as unknown as TechnicalAnalysisService,
  );
  const state = { protectedContext: '', detokenizedContext: '' };
  const privacy = {
    async protectAnalysisTransfer(
      ...args: Parameters<PrivacyService['protectAnalysisTransfer']>
    ) {
      if (privacyOverride?.protectAnalysisTransfer) {
        return privacyOverride.protectAnalysisTransfer(...args);
      }
      const result = await realPrivacy.protectAnalysisTransfer(...args);
      state.protectedContext = result.contextId;
      return result;
    },
    async detokenizeObject(...args: Parameters<PrivacyService['detokenizeObject']>) {
      if (privacyOverride?.detokenizeObject) {
        return privacyOverride.detokenizeObject(...args);
      }
      state.detokenizedContext = args[1];
      return realPrivacy.detokenizeObject(...args);
    },
  };
  const repository = new MemoryReports();
  const payloads: unknown[] = [];
  const wrapped: ReportLanguageModel = {
    async generate(payload: unknown) {
      payloads.push(payload);
      return model.generate(payload);
    },
  };
  return {
    service: new TechnicalReportService(
      requests as unknown as PostSaleRequestService,
      analysisService as unknown as TechnicalAnalysisService,
      privacy as unknown as PrivacyService,
      wrapped,
      repository,
      {
        async findProfiles() {
          return [
            {
              cognitoSub: specialist.userId,
              firstName: 'Carlos',
              lastName: 'Méndez',
              phoneNumber: PHONE,
            },
            {
              cognitoSub: validator.userId,
              firstName: 'Laura',
              lastName: 'Pineda',
              phoneNumber: null,
            },
          ];
        },
      },
    ),
    repository,
    payloads,
    get protectedContext() {
      return state.protectedContext;
    },
    get detokenizedContext() {
      return state.detokenizedContext;
    },
    modelCalls: () => payloads.length,
  };
}

function echoModel(): ReportLanguageModel & { calls: number } {
  const model = {
    calls: 0,
    async generate(payload: unknown) {
      model.calls += 1;
      return resultFrom(payload);
    },
  };
  return model;
}

function resultFrom(payload: unknown) {
  return {
    content: protectedDraft(payload, analysis.findings),
    model: 'gpt-6-luna',
    reasoningEffort: 'low',
    inputTokens: 321,
    outputTokens: 654,
  };
}

class MemoryReports implements TechnicalReportRepository {
  readonly rows: TechnicalReportRecord[] = [];
  readonly events: TechnicalReportReviewRecord[] = [];

  async insert(report: TechnicalReportInsert): Promise<TechnicalReportRecord> {
    const current = this.rows
      .filter((row) => row.requestId === report.requestId)
      .reduce((max, row) => Math.max(max, row.version), 0);
    if (
      report.expectedLatestVersion !== undefined &&
      current !== report.expectedLatestVersion
    ) {
      throw new ReportRevisionConflictError();
    }
    const stored: TechnicalReportRecord = {
      id: report.id,
      requestId: report.requestId,
      analysisId: report.analysisId,
      status: report.status,
      schemaVersion: report.schemaVersion,
      content: report.content,
      model: report.model,
      reasoningEffort: report.reasoningEffort,
      inputTokens: report.inputTokens,
      outputTokens: report.outputTokens,
      createdBySub: report.createdBySub,
      origin: report.origin,
      version: current + 1,
      createdAt: report.createdAt,
      updatedAt: report.createdAt,
    };
    this.rows.push(stored);
    return stored;
  }

  async listVisible(
    assignedSpecialistSub: string | null,
  ): Promise<TechnicalReportCatalogRow[]> {
    const visible =
      assignedSpecialistSub === null || assignedSpecialistSub === SPECIALIST_SUB;
    return (visible ? this.rows : []).map((report) => ({
      report,
      ticketCode: request.ticketCode,
      customerName: request.customerName,
      facilityName: request.facilityName,
      requestType: request.type,
    }));
  }

  async listByRequestId(requestId: string): Promise<TechnicalReportRecord[]> {
    return this.rows
      .filter((row) => row.requestId === requestId)
      .sort((left, right) => right.version - left.version);
  }

  async findById(id: string): Promise<TechnicalReportRecord | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async applyReview(command: TechnicalReportReviewCommand): Promise<TechnicalReportRecord> {
    const current = this.rows.find(
      (row) => row.id === command.reportId && row.requestId === command.requestId,
    );
    const slots = this.events
      .filter((event) => event.reportId === command.reportId)
      .map((event) => event.slot);
    if (
      !current ||
      current.status !== command.expectedStatus ||
      current.version !== command.submittedVersion ||
      !acceptedReviewSlot(slots, command.slot)
    ) {
      throw new ReportWorkflowError('El estado del informe no admite esta acción.', 'conflict');
    }
    const stored = { ...current, status: command.nextStatus, updatedAt: command.createdAt };
    this.rows[this.rows.indexOf(current)] = stored;
    this.events.push({
      id: command.id,
      reportId: command.reportId,
      requestId: command.requestId,
      submittedVersion: command.submittedVersion,
      eventType: command.eventType,
      slot: command.slot,
      actorSub: command.actorSub,
      comments: command.comments,
      analysisId: command.analysisId,
      createdAt: command.createdAt,
    });
    return stored;
  }

  async listReviewEvents(requestIds: readonly string[]): Promise<TechnicalReportReviewRecord[]> {
    return this.events
      .filter((event) => requestIds.includes(event.requestId))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async listPending(
    page: number,
    pageSize: number,
  ): Promise<{ items: PendingTechnicalReportRow[]; total: number }> {
    const pending = this.rows.filter(
      (row) => row.status === 'PENDING_VALIDATION' || row.status === 'UNDER_REVIEW',
    );
    return {
      total: pending.length,
      items: pending.slice((page - 1) * pageSize, page * pageSize).map((report) => {
        const submitted = this.events.find(
          (event) => event.reportId === report.id && event.eventType === 'SUBMITTED',
        );
        return {
          report,
          ticketCode: request.ticketCode,
          customerName: request.customerName,
          facilityName: request.facilityName,
          submittedAt: submitted?.createdAt ?? null,
          submittedBySub: submitted?.actorSub ?? null,
        };
      }),
    };
  }

  async requestLabel(): Promise<TechnicalReportRequestLabel> {
    return {
      ticketCode: request.ticketCode,
      customerName: request.customerName,
      facilityName: request.facilityName,
    };
  }
}

function protectedDraft(
  payload: unknown,
  findings: readonly AnalysisFinding[],
): TechnicalReportContent {
  const source = payloadRequest(payload);
  return {
    schemaVersion: 1,
    title: 'Borrador de informe técnico',
    identification: {
      ticketCode: source.ticketCode,
      requestType: source.type,
      periodStart: source.periodStart,
      periodEnd: source.periodEnd,
    },
    executiveSummary:
      'El borrador explica el análisis determinista sin modificar sus valores.',
    background: `La solicitud ${source.ticketCode} de ${source.customerName} se revisa con los datos del periodo.`,
    scope: 'El alcance se limita a explicar los hallazgos ya calculados.',
    technicalFindings: findings.map((finding) => ({
      findingType: finding.findingType,
      narrative:
        'Se conserva la medición determinista. La causa no forma parte del hallazgo.',
      measuredValue: finding.measuredValue,
      referenceValue: finding.referenceValue,
      difference: finding.difference,
      percentage: finding.percentage,
      unit: finding.unit,
      interpretation: finding.interpretation,
      periodStart: finding.periodStart,
      periodEnd: finding.periodEnd,
    })),
    contractualComparison:
      'La comparación usa únicamente los parámetros presentes en el análisis.',
    historicalAnalysis: 'El histórico acompaña el caso y no cambia la demanda medida.',
    interpretation:
      'La interpretación distingue la observación calculada de cualquier causa posible.',
    hypotheses: [
      {
        statement:
          'Una hipótesis es que la variación tenga un origen operativo todavía sin verificar.',
        basis: 'El conjunto no trae evidencia suficiente para confirmar una causa.',
      },
    ],
    financialImpact: {
      status: 'unavailable',
      narrative:
        'No hay tarifas, costos ni penalizaciones. El impacto financiero no está disponible.',
    },
    recommendations: [
      { text: 'Validar la información faltante antes de emitir el informe.' },
    ],
    evidence: findings.flatMap((finding) =>
      finding.evidence.map((item) => ({
        label: item.label,
        value: item.value,
        unit: item.unit,
        measuredAt: item.measuredAt,
        periodStart: item.periodStart,
        periodEnd: item.periodEnd,
      })),
    ),
    limitations: ['Faltan datos financieros y la causa permanece sin confirmar.'],
    conclusions:
      'El borrador mantiene los valores deterministas y deja la causa como hipótesis.',
    draftStatus: 'DRAFT',
  };
}

function payloadRequest(payload: unknown): {
  ticketCode: string;
  customerName: string;
  type: string;
  periodStart: string;
  periodEnd: string;
} {
  if (!payload || typeof payload !== 'object' || !('request' in payload)) {
    throw new Error('protected payload shape');
  }
  const requestPayload = payload.request;
  if (!requestPayload || typeof requestPayload !== 'object') {
    throw new Error('protected payload shape');
  }
  const fields = requestPayload as Record<string, unknown>;
  if (
    typeof fields.ticketCode !== 'string' ||
    typeof fields.customerName !== 'string' ||
    typeof fields.type !== 'string' ||
    typeof fields.periodStart !== 'string' ||
    typeof fields.periodEnd !== 'string'
  ) {
    throw new Error('protected payload shape');
  }
  return {
    ticketCode: fields.ticketCode,
    customerName: fields.customerName,
    type: fields.type,
    periodStart: fields.periodStart,
    periodEnd: fields.periodEnd,
  };
}
