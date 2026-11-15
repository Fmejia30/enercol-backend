export interface ReportGenerationResult {
  readonly content: unknown;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export interface ReportLanguageModel {
  generate(payload: unknown): Promise<ReportGenerationResult>;
}

export const REPORT_LANGUAGE_MODEL = Symbol('REPORT_LANGUAGE_MODEL');
