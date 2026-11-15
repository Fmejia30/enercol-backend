import { describe, expect, it } from '@jest/globals';
import { analyzeTechnicalDataset } from '../../post-sale-requests/domain/technical-analysis.js';
import type { AnalysisFinding } from '../../post-sale-requests/domain/technical-analysis.js';
import type { StoredTechnicalDataset } from '../../post-sale-requests/domain/technical-dataset.js';
import {
  assertReportConsistent,
  parseTechnicalReportContent,
  reportConsistencyInput,
  type TechnicalReportContent,
} from './report-content.js';
import { ReportContentInvalidError } from './report-error.js';
import { TECHNICAL_REPORT_JSON_SCHEMA } from './report-schema.js';

const demandRequest = {
  ticketCode: 'PV-A05-001',
  type: 'VERIFICACION_DEMANDA' as const,
  periodStart: '2026-09-01',
  periodEnd: '2026-09-07',
};

const demandDataset: StoredTechnicalDataset = {
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

describe('technical report content', () => {
  const outcome = analyzeTechnicalDataset(demandRequest, demandDataset);
  const facts = reportConsistencyInput(
    demandRequest,
    demandDataset,
    outcome.findings,
  );

  it('publishes a strict object schema for the draft', () => {
    expect(TECHNICAL_REPORT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(TECHNICAL_REPORT_JSON_SCHEMA.required).toContain('financialImpact');
    expect(TECHNICAL_REPORT_JSON_SCHEMA.required).toContain('hypotheses');
  });

  it('keeps deterministic measurements and separates hypotheses from findings', () => {
    const content = draft(demandRequest, outcome.findings, 'El histórico acompaña el caso.');
    expect(content.technicalFindings[0]?.measuredValue).toBe('267.250');
    expect(content.technicalFindings[0]?.referenceValue).toBe('250.000');
    expect(content.technicalFindings[0]?.interpretation).toBe('confirmed-observation');
    expect(content.hypotheses).toHaveLength(1);
    expect(content.financialImpact.status).toBe('unavailable');
    expect(() => assertReportConsistent(content, facts)).not.toThrow();
  });

  it('rejects a rewritten measurement, invented money, and a verified cause', () => {
    const content = draft(demandRequest, outcome.findings, 'El histórico acompaña el caso.');
    const rewritten = {
      ...content,
      technicalFindings: [
        { ...content.technicalFindings[0], measuredValue: '999.000' },
      ],
    };
    expect(() => assertReportConsistent(rewritten, facts)).toThrow(
      ReportContentInvalidError,
    );
    expect(() =>
      assertReportConsistent(
        {
          ...content,
          financialImpact: {
            status: 'unavailable',
            narrative: 'La penalización estimada es Q 1500.',
          },
        },
        facts,
      ),
    ).toThrow(ReportContentInvalidError);
    expect(() =>
      parseTechnicalReportContent({
        ...content,
        financialImpact: { status: 'described', narrative: 'Hay un ahorro.' },
      }),
    ).toThrow(ReportContentInvalidError);
    expect(() =>
      assertReportConsistent(
        {
          ...content,
          technicalFindings: [
            {
              ...content.technicalFindings[0],
              narrative: 'La causa confirmada es el arranque de un equipo.',
            },
          ],
        },
        facts,
      ),
    ).toThrow(ReportContentInvalidError);
  });

  it('requires an explicit gap when history or financial data is absent', () => {
    const dataset: StoredTechnicalDataset = {
      ...demandDataset,
      historicalConsumption: [],
      evaluationConsumption: null,
    };
    const withoutHistory = analyzeTechnicalDataset(demandRequest, dataset);
    const source = reportConsistencyInput(
      demandRequest,
      dataset,
      withoutHistory.findings,
    );
    const content = draft(demandRequest, withoutHistory.findings, null);
    expect(() => assertReportConsistent(content, source)).not.toThrow();
    expect(() =>
      assertReportConsistent(
        { ...content, historicalAnalysis: 'El consumo subió 10.000 kWh.' },
        source,
      ),
    ).toThrow(ReportContentInvalidError);
  });

  it('does not turn a consumption increase into a confirmed cause', () => {
    const request = {
      ticketCode: 'PV-A05-002',
      type: 'CONSUMO_ATIPICO' as const,
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    };
    const dataset: StoredTechnicalDataset = {
      demandThreshold: null,
      demandUnit: 'kW',
      evaluationConsumption: '124800.000',
      consumptionUnit: 'kWh',
      sourceName: 'Conjunto técnico controlado Act-05',
      sourceKind: 'local-controlled-dataset',
      telemetry: [],
      historicalConsumption: [
        { periodStart: '2026-06-01', periodEnd: '2026-06-30', consumption: '98000.000' },
        { periodStart: '2026-07-01', periodEnd: '2026-07-31', consumption: '101250.000' },
        { periodStart: '2026-08-01', periodEnd: '2026-08-31', consumption: '99500.750' },
      ],
    };
    const consumption = analyzeTechnicalDataset(request, dataset);
    const content = draft(
      request,
      consumption.findings,
      'La comparación usa el promedio histórico ya calculado.',
    );
    expect(content.technicalFindings[0]?.interpretation).toBe('requires-interpretation');
    expect(content.hypotheses[0]?.statement).toMatch(/hipótesis/i);
    expect(() =>
      assertReportConsistent(
        content,
        reportConsistencyInput(request, dataset, consumption.findings),
      ),
    ).not.toThrow();
    expect(() =>
      assertReportConsistent(
        {
          ...content,
          technicalFindings: [
            {
              ...content.technicalFindings[0],
              interpretation: 'confirmed-observation',
            },
          ],
        },
        reportConsistencyInput(request, dataset, consumption.findings),
      ),
    ).toThrow(ReportContentInvalidError);
  });
});

function draft(
  request: {
    ticketCode: string;
    type: string;
    periodStart: string;
    periodEnd: string;
  },
  findings: readonly AnalysisFinding[],
  historicalAnalysis: string | null,
): TechnicalReportContent {
  return {
    schemaVersion: 1,
    title: 'Borrador de informe técnico',
    identification: {
      ticketCode: request.ticketCode,
      requestType: request.type,
      periodStart: request.periodStart,
      periodEnd: request.periodEnd,
    },
    executiveSummary:
      'El borrador explica el análisis determinista sin modificar sus valores.',
    background: `La solicitud ${request.ticketCode} se revisa con los datos del periodo.`,
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
    historicalAnalysis,
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
