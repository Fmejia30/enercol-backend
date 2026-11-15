import { describe, expect, it } from '@jest/globals';
import {
  acceptedReviewSlot,
  canGenerateReport,
  canRevise,
  reviewComments,
  transitionFor,
} from './report-workflow.js';

describe('report workflow', () => {
  it('only allows the approval transitions', () => {
    expect(transitionFor('submit')).toMatchObject({
      from: 'DRAFT',
      to: 'PENDING_VALIDATION',
    });
    expect(transitionFor('start').from).toBe('PENDING_VALIDATION');
    expect(transitionFor('approve').to).toBe('APPROVED');
    expect(transitionFor('request-changes').to).toBe('CHANGES_REQUESTED');
    expect(transitionFor('require-reanalysis').to).toBe('REANALYSIS_REQUIRED');
    expect(transitionFor('approve').slot).toBe('DECISION');
    expect(transitionFor('request-changes').slot).toBe('DECISION');
  });

  it('keeps one decision and requires the previous slot', () => {
    expect(acceptedReviewSlot([], 'SUBMITTED')).toBe(true);
    expect(acceptedReviewSlot(['SUBMITTED'], 'SUBMITTED')).toBe(false);
    expect(acceptedReviewSlot([], 'STARTED')).toBe(false);
    expect(acceptedReviewSlot(['SUBMITTED'], 'STARTED')).toBe(true);
    expect(acceptedReviewSlot(['SUBMITTED'], 'DECISION')).toBe(false);
    expect(acceptedReviewSlot(['SUBMITTED', 'STARTED'], 'DECISION')).toBe(true);
    expect(acceptedReviewSlot(['SUBMITTED', 'STARTED', 'DECISION'], 'DECISION')).toBe(
      false,
    );
  });

  it('allows a new draft after requested changes and a new analysis after reanalysis', () => {
    expect(canRevise('DRAFT')).toBe(true);
    expect(canRevise('CHANGES_REQUESTED')).toBe(true);
    expect(canRevise('PENDING_VALIDATION')).toBe(false);
    expect(canRevise('UNDER_REVIEW')).toBe(false);
    expect(canRevise('APPROVED')).toBe(false);
    expect(canRevise('REANALYSIS_REQUIRED')).toBe(false);
    expect(canGenerateReport(null, false)).toBe(true);
    expect(canGenerateReport('DRAFT', true)).toBe(true);
    expect(canGenerateReport('CHANGES_REQUESTED', true)).toBe(false);
    expect(canGenerateReport('APPROVED', true)).toBe(false);
    expect(canGenerateReport('REANALYSIS_REQUIRED', true)).toBe(false);
    expect(canGenerateReport('REANALYSIS_REQUIRED', false)).toBe(true);
  });

  it('requires a comment within the allowed length', () => {
    expect(reviewComments('  Corregir el alcance.  ')).toBe('Corregir el alcance.');
    expect(reviewComments('   ')).toBeNull();
    expect(reviewComments('a'.repeat(2001))).toBeNull();
  });
});
