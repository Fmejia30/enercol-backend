import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';

export const POST_SALE_REQUEST_STATUSES = [
  'RECEIVED',
  'ASSIGNED',
  'IN_ANALYSIS',
  'REPORT_DRAFT',
  'PENDING_VALIDATION',
  'REPORT_APPROVED',
  'REPORT_CHANGES_REQUESTED',
  'REANALYSIS_REQUIRED',
  'ABIERTA',
  'EN_ANALISIS',
  'INFORME_EMITIDO',
] as const;

export type PostSaleRequestStatus = (typeof POST_SALE_REQUEST_STATUSES)[number];

export const POST_SALE_REQUEST_TYPES = [
  'VERIFICACION_DEMANDA',
  'DESVIACION_FACTOR_POTENCIA',
  'CONSUMO_ATIPICO',
  'CALIDAD_DE_POTENCIA',
] as const;

export type PostSaleRequestType = (typeof POST_SALE_REQUEST_TYPES)[number];

export interface PostSaleRequest {
  readonly id: string;
  readonly ticketCode: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly facilityName: string;
  readonly assetId: string | null;
  readonly assignedSpecialistSub: string | null;
  readonly type: PostSaleRequestType;
  readonly description: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: PostSaleRequestStatus;
  readonly createdAt: Date;
}

export interface PostSaleRequestDraft {
  id: string;
  ticketCode: string;
  customerId: string;
  customerName: string;
  facilityName: string;
  assetId?: string | null;
  assignedSpecialistSub?: string | null;
  type: PostSaleRequestType;
  description: string;
  periodStart: string;
  periodEnd: string;
  status: PostSaleRequestStatus;
  createdAt: Date;
}

export class InvalidPostSaleRequestError extends Error {
  constructor() {
    super('Post-sale request is invalid');
    this.name = 'InvalidPostSaleRequestError';
  }
}

export class InvalidEvaluationPeriodError extends Error {
  constructor() {
    super('Evaluation period is invalid');
    this.name = 'InvalidEvaluationPeriodError';
  }
}

export type RequestVisibility =
  | { readonly kind: 'all' }
  | { readonly kind: 'assigned'; readonly specialistSub: string };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function createPostSaleRequest(
  draft: PostSaleRequestDraft,
): PostSaleRequest {
  const periodStart = dateOnly(draft.periodStart);
  const periodEnd = dateOnly(draft.periodEnd);
  if (periodStart > periodEnd) {
    throw new InvalidEvaluationPeriodError();
  }
  if (
    Number.isNaN(draft.createdAt.getTime()) ||
    !isRequestType(draft.type) ||
    !isRequestStatus(draft.status)
  ) {
    throw new InvalidPostSaleRequestError();
  }

  return {
    id: requiredText(draft.id),
    ticketCode: requiredText(draft.ticketCode),
    customerId: requiredText(draft.customerId),
    customerName: requiredText(draft.customerName),
    facilityName: requiredText(draft.facilityName),
    assetId: optionalText(draft.assetId),
    assignedSpecialistSub: optionalText(draft.assignedSpecialistSub),
    type: draft.type,
    description: requiredText(draft.description),
    periodStart,
    periodEnd,
    status: draft.status,
    createdAt: new Date(draft.createdAt.getTime()),
  };
}

export function requestVisibility(user: AuthenticatedUser): RequestVisibility {
  if (user.roles.includes(UserRole.ADMINISTRATOR)) {
    return { kind: 'all' };
  }
  return { kind: 'assigned', specialistSub: user.userId };
}

export function isRequestVisible(
  visibility: RequestVisibility,
  request: Pick<PostSaleRequest, 'assignedSpecialistSub'>,
): boolean {
  if (visibility.kind === 'all') {
    return true;
  }
  return request.assignedSpecialistSub === visibility.specialistSub;
}

function dateOnly(value: string): string {
  const match = DATE_ONLY.exec(value);
  if (!match) {
    throw new InvalidEvaluationPeriodError();
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new InvalidEvaluationPeriodError();
  }
  return value;
}

function requiredText(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new InvalidPostSaleRequestError();
  }
  return normalized;
}

function isRequestType(value: string): value is PostSaleRequestType {
  return (POST_SALE_REQUEST_TYPES as readonly string[]).includes(value);
}

function isRequestStatus(value: string): value is PostSaleRequestStatus {
  return (POST_SALE_REQUEST_STATUSES as readonly string[]).includes(value);
}

function optionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}
