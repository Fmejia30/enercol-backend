import type { AuthenticatedUser } from './authenticated-user.js';
import { UserRole } from './user-role.js';

export const ReportValidationDenial = {
  MISSING_ROLE: 'MISSING_ROLE',
  SELF_VALIDATION: 'SELF_VALIDATION',
  UNKNOWN_AUTHOR: 'UNKNOWN_AUTHOR',
} as const;

export type ReportValidationDenialReason =
  (typeof ReportValidationDenial)[keyof typeof ReportValidationDenial];

export type ReportValidationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: ReportValidationDenialReason };

export function decideReportValidation(
  user: AuthenticatedUser,
  reportAuthorUserId: string,
): ReportValidationDecision {
  if (!user.roles.includes(UserRole.VALIDATOR)) {
    return {
      allowed: false,
      reason: ReportValidationDenial.MISSING_ROLE,
    };
  }

  if (reportAuthorUserId.trim().length === 0) {
    return {
      allowed: false,
      reason: ReportValidationDenial.UNKNOWN_AUTHOR,
    };
  }

  if (user.userId === reportAuthorUserId) {
    return {
      allowed: false,
      reason: ReportValidationDenial.SELF_VALIDATION,
    };
  }

  return { allowed: true };
}
