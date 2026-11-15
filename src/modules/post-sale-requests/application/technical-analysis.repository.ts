import type {
  AnalysisFinding,
  AnalysisInputSnapshot,
  AnalysisStatus,
} from '../domain/technical-analysis.js';

export interface TechnicalAnalysisRecord {
  readonly id: string;
  readonly requestId: string;
  readonly status: AnalysisStatus;
  readonly executedAt: Date;
  readonly executedBySub: string;
  readonly failureMessage: string | null;
  readonly inputSnapshot: AnalysisInputSnapshot;
  readonly findings: readonly AnalysisFinding[];
}

export interface VisibleTechnicalAnalysis {
  readonly analysis: TechnicalAnalysisRecord;
  readonly ticketCode: string;
  readonly customerName: string;
  readonly facilityName: string;
  readonly requestType: string;
}

export interface TechnicalAnalysisRepository {
  insert(analysis: TechnicalAnalysisRecord): Promise<TechnicalAnalysisRecord>;
  listByRequestId(requestId: string): Promise<TechnicalAnalysisRecord[]>;
  listVisible(assignedSpecialistSub: string | null): Promise<VisibleTechnicalAnalysis[]>;
}

export const TECHNICAL_ANALYSIS_REPOSITORY = Symbol(
  'TECHNICAL_ANALYSIS_REPOSITORY',
);
