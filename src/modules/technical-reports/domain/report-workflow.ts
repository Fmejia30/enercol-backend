export const REPORT_STATUSES = [
  'DRAFT',
  'PENDING_VALIDATION',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'REANALYSIS_REQUIRED',
  'APPROVED',
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REVIEW_EVENT_TYPES = [
  'SUBMITTED',
  'REVIEW_STARTED',
  'APPROVED',
  'CHANGES_REQUESTED',
  'REANALYSIS_REQUIRED',
] as const;

export type ReviewEventType = (typeof REVIEW_EVENT_TYPES)[number];

export const REVIEW_SLOTS = ['SUBMITTED', 'STARTED', 'DECISION'] as const;

export type ReviewSlot = (typeof REVIEW_SLOTS)[number];

export type ReviewAction =
  | 'submit'
  | 'start'
  | 'approve'
  | 'request-changes'
  | 'require-reanalysis';

export function isReportStatus(value: string): value is ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(value);
}

export function isReviewEventType(value: string): value is ReviewEventType {
  return (REVIEW_EVENT_TYPES as readonly string[]).includes(value);
}

export function isReviewSlot(value: string): value is ReviewSlot {
  return (REVIEW_SLOTS as readonly string[]).includes(value);
}

export function transitionFor(action: ReviewAction): {
  from: ReportStatus;
  to: ReportStatus;
  event: ReviewEventType;
  slot: ReviewSlot;
} {
  switch (action) {
    case 'submit':
      return {
        from: 'DRAFT',
        to: 'PENDING_VALIDATION',
        event: 'SUBMITTED',
        slot: 'SUBMITTED',
      };
    case 'start':
      return {
        from: 'PENDING_VALIDATION',
        to: 'UNDER_REVIEW',
        event: 'REVIEW_STARTED',
        slot: 'STARTED',
      };
    case 'approve':
      return {
        from: 'UNDER_REVIEW',
        to: 'APPROVED',
        event: 'APPROVED',
        slot: 'DECISION',
      };
    case 'request-changes':
      return {
        from: 'UNDER_REVIEW',
        to: 'CHANGES_REQUESTED',
        event: 'CHANGES_REQUESTED',
        slot: 'DECISION',
      };
    case 'require-reanalysis':
      return {
        from: 'UNDER_REVIEW',
        to: 'REANALYSIS_REQUIRED',
        event: 'REANALYSIS_REQUIRED',
        slot: 'DECISION',
      };
  }
}

export function canRevise(status: ReportStatus): boolean {
  return status === 'DRAFT' || status === 'CHANGES_REQUESTED';
}

export function canGenerateReport(
  status: ReportStatus | null,
  sameAnalysis: boolean,
): boolean {
  if (status === null || status === 'DRAFT') return true;
  if (status === 'REANALYSIS_REQUIRED') return !sameAnalysis;
  return false;
}

export function reviewComments(value: string): string | null {
  const comments = value.trim();
  if (comments.length === 0 || comments.length > 2000) return null;
  return comments;
}

export function acceptedReviewSlot(
  existing: readonly ReviewSlot[],
  slot: ReviewSlot,
): boolean {
  if (existing.includes(slot)) return false;
  if (slot === 'STARTED' && !existing.includes('SUBMITTED')) return false;
  if (slot === 'DECISION' && !existing.includes('STARTED')) return false;
  return true;
}
