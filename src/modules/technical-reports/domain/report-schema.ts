const text = { type: 'string' };
const nullableText = { anyOf: [{ type: 'string' }, { type: 'null' }] };

function objectSchema(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

const findingSchema = objectSchema({
  findingType: text,
  narrative: text,
  measuredValue: text,
  referenceValue: text,
  difference: text,
  percentage: text,
  unit: text,
  interpretation: {
    type: 'string',
    enum: ['confirmed-observation', 'requires-interpretation'],
  },
  periodStart: text,
  periodEnd: text,
});

const hypothesisSchema = objectSchema({
  statement: text,
  basis: text,
});

const recommendationSchema = objectSchema({
  text,
});

const evidenceSchema = objectSchema({
  label: text,
  value: text,
  unit: text,
  measuredAt: nullableText,
  periodStart: nullableText,
  periodEnd: nullableText,
});

export const TECHNICAL_REPORT_SCHEMA_VERSION = 1;

export const TECHNICAL_REPORT_JSON_SCHEMA = objectSchema({
  schemaVersion: { type: 'integer' },
  title: text,
  identification: objectSchema({
    ticketCode: text,
    requestType: text,
    periodStart: text,
    periodEnd: text,
  }),
  executiveSummary: text,
  background: text,
  scope: text,
  technicalFindings: { type: 'array', items: findingSchema },
  contractualComparison: text,
  historicalAnalysis: nullableText,
  interpretation: text,
  hypotheses: { type: 'array', items: hypothesisSchema },
  financialImpact: objectSchema({
    status: { type: 'string', enum: ['unavailable'] },
    narrative: text,
  }),
  recommendations: { type: 'array', items: recommendationSchema },
  evidence: { type: 'array', items: evidenceSchema },
  limitations: { type: 'array', items: text },
  conclusions: text,
  draftStatus: { type: 'string', enum: ['DRAFT'] },
});
