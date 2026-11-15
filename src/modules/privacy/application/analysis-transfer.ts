import type {
  AnalysisFinding,
  AnalysisInputSnapshot,
} from '../../post-sale-requests/domain/technical-analysis.js';
import type { PostSaleRequest } from '../../post-sale-requests/domain/post-sale-request.js';
import type {
  HistoricalConsumption,
  TelemetryReading,
} from '../../post-sale-requests/domain/technical-dataset.js';
import { classifyField } from '../domain/field-classification.js';
import type { SensitiveCategory } from '../domain/sensitive-category.js';

export interface AnalysisProtectionSource {
  readonly request: PostSaleRequest;
  readonly assignedSpecialist: {
    readonly firstName: string | null;
    readonly lastName: string | null;
  } | null;
  readonly dataset: {
    readonly demandThreshold: string | null;
    readonly demandUnit: string;
    readonly evaluationConsumption: string | null;
    readonly consumptionUnit: string;
    readonly sourceName: string;
    readonly sourceKind: string;
    readonly telemetry: readonly TelemetryReading[];
    readonly historicalConsumption: readonly HistoricalConsumption[];
  };
  readonly analysis: {
    readonly id: string;
    readonly status: string;
    readonly executedAt: string;
    readonly executedBySub: string;
    readonly failureMessage: string | null;
    readonly findings: readonly AnalysisFinding[];
    readonly inputSnapshot: AnalysisInputSnapshot;
  };
}

export interface AnalysisTransfer {
  readonly payload: {
    readonly request: {
      readonly requestId: string;
      readonly ticketCode: string;
      readonly customerId: string;
      readonly customerName: string;
      readonly facilityName: string;
      readonly assetId: string | null;
      readonly description: string;
      readonly type: string;
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly status: string;
    };
    readonly assignedSpecialist: {
      readonly firstName: string | null;
      readonly lastName: string | null;
    } | null;
    readonly technical: {
      readonly demandThreshold: string | null;
      readonly demandUnit: string;
      readonly evaluationConsumption: string | null;
      readonly consumptionUnit: string;
      readonly sourceName: string;
      readonly sourceKind: string;
      readonly telemetry: readonly TelemetryReading[];
      readonly historicalConsumption: readonly HistoricalConsumption[];
      readonly status: string;
      readonly executedAt: string;
      readonly failureMessage: string | null;
      readonly findings: readonly AnalysisFinding[];
      readonly inputSnapshot: AnalysisInputSnapshot;
    };
  };
  readonly secrets: readonly { value: string; category: SensitiveCategory }[];
  readonly redactions: readonly string[];
  readonly prohibited: readonly string[];
}

export function allowlistedAnalysisTransfer(
  source: AnalysisProtectionSource,
): AnalysisTransfer {
  const payload: AnalysisTransfer['payload'] = {
    request: {
      requestId: source.request.id,
      ticketCode: source.request.ticketCode,
      customerId: source.request.customerId,
      customerName: source.request.customerName,
      facilityName: source.request.facilityName,
      assetId: source.request.assetId,
      description: source.request.description,
      type: source.request.type,
      periodStart: source.request.periodStart,
      periodEnd: source.request.periodEnd,
      status: source.request.status,
    },
    assignedSpecialist: source.assignedSpecialist
      ? {
          firstName: source.assignedSpecialist.firstName,
          lastName: source.assignedSpecialist.lastName,
        }
      : null,
    technical: {
      demandThreshold: source.dataset.demandThreshold,
      demandUnit: source.dataset.demandUnit,
      evaluationConsumption: source.dataset.evaluationConsumption,
      consumptionUnit: source.dataset.consumptionUnit,
      sourceName: source.dataset.sourceName,
      sourceKind: source.dataset.sourceKind,
      telemetry: source.dataset.telemetry,
      historicalConsumption: source.dataset.historicalConsumption,
      status: source.analysis.status,
      executedAt: source.analysis.executedAt,
      failureMessage: source.analysis.failureMessage,
      findings: source.analysis.findings,
      inputSnapshot: source.analysis.inputSnapshot,
    },
  };
  const secrets = fieldSecrets(payload);
  const redactions = [
    source.request.assignedSpecialistSub,
    source.analysis.executedBySub,
  ].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return {
    payload,
    secrets,
    redactions,
    prohibited: [...secrets.map((secret) => secret.value), ...redactions],
  };
}

function fieldSecrets(
  value: unknown,
): { value: string; category: SensitiveCategory }[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => fieldSecrets(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => {
      const category = classifyField(key);
      const own =
        category && typeof child === 'string' && child.length > 0
          ? [{ value: child, category }]
          : [];
      return [...own, ...fieldSecrets(child)];
    });
  }
  return [];
}
