import {
  decideReportValidation,
  ReportValidationDenial,
} from './report-validation-policy.js';
import { UserRole } from './user-role.js';

describe('decideReportValidation', () => {
  const validator = {
    userId: 'validator-1',
    roles: [UserRole.VALIDATOR],
  };
  const specialist = {
    userId: 'specialist-1',
    roles: [UserRole.SPECIALIST],
  };

  it('allows a validator to review a report created by someone else', () => {
    expect(decideReportValidation(validator, 'specialist-1')).toEqual({
      allowed: true,
    });
  });

  it('rejects a specialist and a validator reviewing their own report', () => {
    expect(decideReportValidation(specialist, 'validator-1')).toEqual({
      allowed: false,
      reason: ReportValidationDenial.MISSING_ROLE,
    });
    expect(decideReportValidation(validator, validator.userId)).toEqual({
      allowed: false,
      reason: ReportValidationDenial.SELF_VALIDATION,
    });
  });

  it('rejects a report whose author cannot be identified', () => {
    expect(decideReportValidation(validator, '   ')).toEqual({
      allowed: false,
      reason: ReportValidationDenial.UNKNOWN_AUTHOR,
    });
  });

  it('allows a user who also holds the specialist role', () => {
    expect(
      decideReportValidation(
        {
          userId: 'both-1',
          roles: [UserRole.SPECIALIST, UserRole.VALIDATOR],
        },
        'specialist-1',
      ),
    ).toEqual({ allowed: true });
  });
});
