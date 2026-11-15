import type {
  AnalysisEvidence,
  AnalysisFinding,
  AnalysisInterpretation,
} from '../../post-sale-requests/domain/technical-analysis.js';
import type { TechnicalDataset } from '../../post-sale-requests/domain/technical-dataset.js';
import { wellFormedTokenPattern } from '../../privacy/domain/sensitive-category.js';
import { ReportContentInvalidError } from './report-error.js';
import { TECHNICAL_REPORT_SCHEMA_VERSION } from './report-schema.js';

const MAX_TEXT = 4_000;
const MAX_ITEMS = 20;
const VERIFIED_CAUSE =
  /causa\s+ra[ií]z\s+confirmada|causa\s+ra[ií]z\s+verificada|causa\s+confirmada|causa\s+verificada/i;
const MONEY =
  /(?:\bUSD\b|\bGTQ\b|US\$|\$\s*\d|\bQ\s*\d|\b\d[\d.,]*\s*(?:quetzales|dólares|dolares)\b)/i;

export interface ReportFinding {
  readonly findingType: string;
  readonly narrative: string;
  readonly measuredValue: string;
  readonly referenceValue: string;
  readonly difference: string;
  readonly percentage: string;
  readonly unit: string;
  readonly interpretation: AnalysisInterpretation;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface ReportHypothesis {
  readonly statement: string;
  readonly basis: string;
}

export interface ReportEvidence {
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly measuredAt: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

export interface TechnicalReportContent {
  readonly schemaVersion: number;
  readonly title: string;
  readonly identification: {
    readonly ticketCode: string;
    readonly requestType: string;
    readonly periodStart: string;
    readonly periodEnd: string;
  };
  readonly executiveSummary: string;
  readonly background: string;
  readonly scope: string;
  readonly technicalFindings: readonly ReportFinding[];
  readonly contractualComparison: string;
  readonly historicalAnalysis: string | null;
  readonly interpretation: string;
  readonly hypotheses: readonly ReportHypothesis[];
  readonly financialImpact: {
    readonly status: 'unavailable';
    readonly narrative: string;
  };
  readonly recommendations: readonly { readonly text: string }[];
  readonly evidence: readonly ReportEvidence[];
  readonly limitations: readonly string[];
  readonly conclusions: string;
  readonly draftStatus: 'DRAFT';
}

export interface ReportConsistencyInput {
  readonly ticketCode: string;
  readonly requestType: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly findings: readonly AnalysisFinding[];
  readonly hasHistory: boolean;
  readonly allowedQuantities: readonly string[];
  readonly allowedDates: readonly string[];
  readonly allowedTimestamps: readonly string[];
}

export function parseTechnicalReportContent(
  value: unknown,
): TechnicalReportContent {
  const root = record(value);
  exactKeys(root, [
    'schemaVersion',
    'title',
    'identification',
    'executiveSummary',
    'background',
    'scope',
    'technicalFindings',
    'contractualComparison',
    'historicalAnalysis',
    'interpretation',
    'hypotheses',
    'financialImpact',
    'recommendations',
    'evidence',
    'limitations',
    'conclusions',
    'draftStatus',
  ]);
  const identification = record(root.identification);
  exactKeys(identification, [
    'ticketCode',
    'requestType',
    'periodStart',
    'periodEnd',
  ]);
  const financialImpact = record(root.financialImpact);
  exactKeys(financialImpact, ['status', 'narrative']);
  const content: TechnicalReportContent = {
    schemaVersion: readSchemaVersion(root.schemaVersion),
    title: requiredText(root.title),
    identification: {
      ticketCode: requiredText(identification.ticketCode),
      requestType: requiredText(identification.requestType),
      periodStart: requiredText(identification.periodStart),
      periodEnd: requiredText(identification.periodEnd),
    },
    executiveSummary: requiredText(root.executiveSummary),
    background: requiredText(root.background),
    scope: requiredText(root.scope),
    technicalFindings: readArray(root.technicalFindings, readFinding),
    contractualComparison: requiredText(root.contractualComparison),
    historicalAnalysis: readNullable(root.historicalAnalysis),
    interpretation: requiredText(root.interpretation),
    hypotheses: readArray(root.hypotheses, readHypothesis),
    financialImpact: {
      status: readEnum(financialImpact.status, ['unavailable'] as const),
      narrative: requiredText(financialImpact.narrative),
    },
    recommendations: readArray(root.recommendations, readRecommendation),
    evidence: readArray(root.evidence, readEvidence),
    limitations: readArray(root.limitations, requiredText),
    conclusions: requiredText(root.conclusions),
    draftStatus: readEnum(root.draftStatus, ['DRAFT'] as const),
  };
  if (content.recommendations.length < 1 || content.limitations.length < 1) {
    throw new ReportContentInvalidError();
  }
  return content;
}

export function reportConsistencyInput(
  request: {
    ticketCode: string;
    type: string;
    periodStart: string;
    periodEnd: string;
  },
  dataset: Pick<
    TechnicalDataset,
    | 'demandThreshold'
    | 'evaluationConsumption'
    | 'telemetry'
    | 'historicalConsumption'
  >,
  findings: readonly AnalysisFinding[],
): ReportConsistencyInput {
  const quantities = new Set<string>();
  const dates = new Set<string>([request.periodStart, request.periodEnd]);
  const timestamps = new Set<string>();
  const addQuantity = (value: string | null | undefined) => {
    if (value) {
      quantities.add(value);
    }
  };
  addQuantity(dataset.demandThreshold);
  addQuantity(dataset.evaluationConsumption);
  for (const reading of dataset.telemetry) {
    addQuantity(reading.measuredDemand);
    timestamps.add(reading.measuredAt);
  }
  for (const row of dataset.historicalConsumption) {
    addQuantity(row.consumption);
    dates.add(row.periodStart);
    dates.add(row.periodEnd);
  }
  for (const finding of findings) {
    addQuantity(finding.measuredValue);
    addQuantity(finding.referenceValue);
    addQuantity(finding.difference);
    addQuantity(finding.percentage);
    dates.add(finding.periodStart);
    dates.add(finding.periodEnd);
    for (const quantity of finding.description.match(/\d+\.\d+/g) ?? []) {
      quantities.add(quantity);
    }
    for (const item of finding.evidence) {
      addQuantity(item.value);
      if (item.measuredAt) {
        timestamps.add(item.measuredAt);
      }
      if (item.periodStart) {
        dates.add(item.periodStart);
      }
      if (item.periodEnd) {
        dates.add(item.periodEnd);
      }
    }
  }
  return {
    ticketCode: request.ticketCode,
    requestType: request.type,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    findings,
    hasHistory:
      dataset.historicalConsumption.length > 0 ||
      dataset.evaluationConsumption !== null,
    allowedQuantities: [...quantities],
    allowedDates: [...dates],
    allowedTimestamps: [...timestamps],
  };
}

export function assertReportConsistent(
  content: TechnicalReportContent,
  source: ReportConsistencyInput,
): void {
  if (
    content.identification.ticketCode !== source.ticketCode ||
    content.identification.requestType !== source.requestType ||
    content.identification.periodStart !== source.periodStart ||
    content.identification.periodEnd !== source.periodEnd
  ) {
    throw new ReportContentInvalidError();
  }
  if (content.technicalFindings.length !== source.findings.length) {
    throw new ReportContentInvalidError();
  }
  const used = new Set<number>();
  for (const finding of content.technicalFindings) {
    const index = source.findings.findIndex(
      (item, position) =>
        !used.has(position) && item.findingType === finding.findingType,
    );
    if (index < 0) {
      throw new ReportContentInvalidError();
    }
    used.add(index);
    const original = source.findings[index];
    if (!original || !sameMeasurement(finding, original)) {
      throw new ReportContentInvalidError();
    }
  }
  if (!sameEvidence(content.evidence, source.findings.flatMap((item) => item.evidence))) {
    throw new ReportContentInvalidError();
  }
  if (source.hasHistory) {
    if (!content.historicalAnalysis?.trim()) {
      throw new ReportContentInvalidError();
    }
  } else if (content.historicalAnalysis !== null) {
    throw new ReportContentInvalidError();
  }
  const allowed = new Set(source.allowedQuantities);
  const dates = new Set(source.allowedDates);
  const timestamps = new Set(source.allowedTimestamps);
  for (const text of stringsOf(content)) {
    assertFaithfulText(text, allowed, dates, timestamps);
  }
}

function sameMeasurement(
  finding: ReportFinding,
  source: AnalysisFinding,
): boolean {
  return (
    finding.measuredValue === source.measuredValue &&
    finding.referenceValue === source.referenceValue &&
    finding.difference === source.difference &&
    finding.percentage === source.percentage &&
    finding.unit === source.unit &&
    finding.interpretation === source.interpretation &&
    finding.periodStart === source.periodStart &&
    finding.periodEnd === source.periodEnd
  );
}

function sameEvidence(
  reportEvidence: readonly ReportEvidence[],
  sourceEvidence: readonly AnalysisEvidence[],
): boolean {
  const reported = reportEvidence.map(evidenceKey).sort();
  const source = sourceEvidence.map(evidenceKey).sort();
  return (
    reported.length === source.length &&
    reported.every((item, index) => item === source[index])
  );
}

function evidenceKey(item: ReportEvidence | AnalysisEvidence): string {
  return [
    item.label,
    item.value,
    item.unit,
    item.measuredAt ?? '',
    item.periodStart ?? '',
    item.periodEnd ?? '',
  ].join('\u0000');
}

function assertFaithfulText(
  text: string,
  allowed: ReadonlySet<string>,
  dates: ReadonlySet<string>,
  timestamps: ReadonlySet<string>,
): void {
  if (VERIFIED_CAUSE.test(text) || MONEY.test(text)) {
    throw new ReportContentInvalidError();
  }
  const masked = text.replace(wellFormedTokenPattern(), ' ');
  for (const match of masked.matchAll(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g,
  )) {
    if (!timestamps.has(match[0])) {
      throw new ReportContentInvalidError();
    }
  }
  const withoutInstants = masked.replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g,
    ' ',
  );
  for (const match of withoutInstants.matchAll(/\d{4}-\d{2}-\d{2}/g)) {
    if (!dates.has(match[0])) {
      throw new ReportContentInvalidError();
    }
  }
  const withoutDates = withoutInstants.replace(/\d{4}-\d{2}-\d{2}/g, ' ');
  for (const match of withoutDates.matchAll(/\d+\.\d+/g)) {
    if (!allowed.has(match[0])) {
      throw new ReportContentInvalidError();
    }
  }
  for (const match of withoutDates.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    const number = match[1] ?? '';
    const known =
      allowed.has(number) ||
      [...allowed].some((value) => value.split('.')[0] === number);
    if (!known) {
      throw new ReportContentInvalidError();
    }
  }
}

function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => stringsOf(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap((item) => stringsOf(item));
  }
  return [];
}

function readFinding(value: unknown): ReportFinding {
  const item = record(value);
  exactKeys(item, [
    'findingType',
    'narrative',
    'measuredValue',
    'referenceValue',
    'difference',
    'percentage',
    'unit',
    'interpretation',
    'periodStart',
    'periodEnd',
  ]);
  return {
    findingType: requiredText(item.findingType),
    narrative: requiredText(item.narrative),
    measuredValue: readString(item.measuredValue),
    referenceValue: readString(item.referenceValue),
    difference: readString(item.difference),
    percentage: readString(item.percentage),
    unit: requiredText(item.unit),
    interpretation: readEnum(item.interpretation, [
      'confirmed-observation',
      'requires-interpretation',
    ] as const),
    periodStart: requiredText(item.periodStart),
    periodEnd: requiredText(item.periodEnd),
  };
}

function readHypothesis(value: unknown): ReportHypothesis {
  const item = record(value);
  exactKeys(item, ['statement', 'basis']);
  return {
    statement: requiredText(item.statement),
    basis: requiredText(item.basis),
  };
}

function readRecommendation(value: unknown): { text: string } {
  const item = record(value);
  exactKeys(item, ['text']);
  return { text: requiredText(item.text) };
}

function readEvidence(value: unknown): ReportEvidence {
  const item = record(value);
  exactKeys(item, [
    'label',
    'value',
    'unit',
    'measuredAt',
    'periodStart',
    'periodEnd',
  ]);
  return {
    label: requiredText(item.label),
    value: readString(item.value),
    unit: requiredText(item.unit),
    measuredAt: readNullable(item.measuredAt),
    periodStart: readNullable(item.periodStart),
    periodEnd: readNullable(item.periodEnd),
  };
}

function readArray<T>(value: unknown, readItem: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    throw new ReportContentInvalidError();
  }
  return value.map((item) => readItem(item));
}

function readSchemaVersion(value: unknown): number {
  if (value !== TECHNICAL_REPORT_SCHEMA_VERSION) {
    throw new ReportContentInvalidError();
  }
  return TECHNICAL_REPORT_SCHEMA_VERSION;
}

function requiredText(value: unknown): string {
  const text = readString(value);
  if (!text.trim()) {
    throw new ReportContentInvalidError();
  }
  return text;
}

function readString(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT) {
    throw new ReportContentInvalidError();
  }
  return value;
}

function readNullable(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return readString(value);
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T {
  if (
    typeof value !== 'string' ||
    !allowed.some((item) => item === value)
  ) {
    throw new ReportContentInvalidError();
  }
  return value as T;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReportContentInvalidError();
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new ReportContentInvalidError();
  }
}
