import { activityDescription, nextRequestStatus } from './request-activity.js';

describe('estado de la solicitud a partir del evento', () => {
  it('avanza por el ciclo y no reabre un informe aprobado', () => {
    expect(nextRequestStatus('RECEIVED', 'SPECIALIST_ASSIGNED')).toBe('ASSIGNED');
    expect(nextRequestStatus('ASSIGNED', 'ANALYSIS_COMPLETED')).toBe('IN_ANALYSIS');
    expect(nextRequestStatus('ABIERTA', 'ANALYSIS_COMPLETED')).toBe('IN_ANALYSIS');
    expect(nextRequestStatus('REANALYSIS_REQUIRED', 'ANALYSIS_COMPLETED')).toBe('IN_ANALYSIS');
    expect(nextRequestStatus('IN_ANALYSIS', 'ANALYSIS_FAILED')).toBe('IN_ANALYSIS');
    expect(nextRequestStatus('ASSIGNED', 'ANALYSIS_FAILED')).toBe('ASSIGNED');
    expect(nextRequestStatus('IN_ANALYSIS', 'REPORT_GENERATED')).toBe('REPORT_DRAFT');
    expect(nextRequestStatus('REPORT_DRAFT', 'REPORT_SUBMITTED')).toBe('PENDING_VALIDATION');
    expect(nextRequestStatus('PENDING_VALIDATION', 'REVIEW_STARTED')).toBe('PENDING_VALIDATION');
    expect(nextRequestStatus('PENDING_VALIDATION', 'REPORT_APPROVED')).toBe('REPORT_APPROVED');
    expect(nextRequestStatus('PENDING_VALIDATION', 'CHANGES_REQUESTED')).toBe(
      'REPORT_CHANGES_REQUESTED',
    );
    expect(nextRequestStatus('PENDING_VALIDATION', 'REANALYSIS_REQUIRED')).toBe(
      'REANALYSIS_REQUIRED',
    );
    expect(nextRequestStatus('REPORT_CHANGES_REQUESTED', 'REPORT_REVISED')).toBe('REPORT_DRAFT');
    expect(nextRequestStatus('REPORT_APPROVED', 'ANALYSIS_COMPLETED')).toBe('REPORT_APPROVED');
    expect(nextRequestStatus('REPORT_APPROVED', 'REPORT_SUBMITTED')).toBe('REPORT_APPROVED');
    expect(nextRequestStatus('PENDING_VALIDATION', 'REPORT_GENERATED')).toBe('PENDING_VALIDATION');
  });

  it('describe el fallo sin incorporar un mensaje ilegible', () => {
    expect(activityDescription('ANALYSIS_FAILED', { failureMessage: 'La unidad de demanda debe ser kW.' })).toBe(
      'El análisis técnico no se completó. La unidad de demanda debe ser kW.',
    );
    expect(activityDescription('ANALYSIS_FAILED', { failureMessage: 'línea\notra' })).toBe(
      'El análisis técnico no se completó.',
    );
    expect(activityDescription('REPORT_APPROVED', { version: 3 })).toContain('Versión 3');
  });
});
