import type { PostSaleRequestStatus } from './post-sale-request.js';

export const REQUEST_ACTIVITY_EVENTS = [
  'REQUEST_REGISTERED',
  'SPECIALIST_ASSIGNED',
  'ANALYSIS_COMPLETED',
  'ANALYSIS_FAILED',
  'REPORT_GENERATED',
  'REPORT_SUBMITTED',
  'REVIEW_STARTED',
  'REPORT_APPROVED',
  'CHANGES_REQUESTED',
  'REPORT_REVISED',
  'REANALYSIS_REQUIRED',
] as const;

export type RequestActivityEvent = (typeof REQUEST_ACTIVITY_EVENTS)[number];

const EARLY_ANALYSIS = new Set<PostSaleRequestStatus>([
  'RECEIVED',
  'ABIERTA',
  'ASSIGNED',
  'EN_ANALISIS',
  'IN_ANALYSIS',
  'REANALYSIS_REQUIRED',
]);

export function nextRequestStatus(
  current: PostSaleRequestStatus,
  event: RequestActivityEvent,
): PostSaleRequestStatus {
  if (current === 'REPORT_APPROVED' && event !== 'REQUEST_REGISTERED') {
    return current;
  }
  switch (event) {
    case 'REQUEST_REGISTERED':
      return current === 'ABIERTA' || current === 'RECEIVED' ? 'RECEIVED' : current;
    case 'SPECIALIST_ASSIGNED':
      return current === 'RECEIVED' || current === 'ABIERTA' ? 'ASSIGNED' : current;
    case 'ANALYSIS_COMPLETED':
      return EARLY_ANALYSIS.has(current) ? 'IN_ANALYSIS' : current;
    case 'ANALYSIS_FAILED':
    case 'REVIEW_STARTED':
      return current;
    case 'REPORT_GENERATED':
    case 'REPORT_REVISED':
      return current === 'PENDING_VALIDATION' ? current : 'REPORT_DRAFT';
    case 'REPORT_SUBMITTED':
      return 'PENDING_VALIDATION';
    case 'REPORT_APPROVED':
      return 'REPORT_APPROVED';
    case 'CHANGES_REQUESTED':
      return 'REPORT_CHANGES_REQUESTED';
    case 'REANALYSIS_REQUIRED':
      return 'REANALYSIS_REQUIRED';
    default:
      return current;
  }
}

export function activityDescription(
  event: RequestActivityEvent,
  detail?: { readonly version?: number | null; readonly failureMessage?: string | null },
): string {
  const version = detail?.version;
  const versionText = version ? ` Versión ${version}.` : '';
  switch (event) {
    case 'REQUEST_REGISTERED':
      return 'Solicitud registrada.';
    case 'SPECIALIST_ASSIGNED':
      return 'Solicitud asignada al especialista.';
    case 'ANALYSIS_COMPLETED':
      return 'Análisis técnico completado.';
    case 'ANALYSIS_FAILED':
      return safeFailure(detail?.failureMessage);
    case 'REPORT_GENERATED':
      return `Se generó un borrador de informe.${versionText}`;
    case 'REPORT_SUBMITTED':
      return `Se envió el informe a validación.${versionText}`;
    case 'REVIEW_STARTED':
      return `El validador inició la revisión.${versionText}`;
    case 'REPORT_APPROVED':
      return `Se aprobó el informe técnico.${versionText}`;
    case 'CHANGES_REQUESTED':
      return `El validador solicitó ajustes.${versionText}`;
    case 'REPORT_REVISED':
      return `El especialista guardó una revisión del informe.${versionText}`;
    case 'REANALYSIS_REQUIRED':
      return `El validador requirió un nuevo análisis técnico.${versionText}`;
    default:
      return 'Se registró una actividad de la solicitud.';
  }
}

function safeFailure(message: string | null | undefined): string {
  const text = message?.trim() ?? '';
  if (text.length === 0 || text.length > 240 || /[\r\n]/.test(text)) {
    return 'El análisis técnico no se completó.';
  }
  return `El análisis técnico no se completó. ${text}`;
}
