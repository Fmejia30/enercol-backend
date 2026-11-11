import {
  cognitoGroupForRole,
  sortRecognizedRoles,
} from '../../identity-access/domain/cognito-group-mapping.js';
import {
  isUserRole,
  type UserRole,
} from '../../identity-access/domain/user-role.js';
import type { FunctionalCognitoGroup } from './functional-cognito-group.js';
import { InvalidInvitationError } from './invitation-failure.js';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const USER_INVITE_AUDIT_ACTION = 'users.invite';

export const USER_INVITE_INTERVENTION_ACTION =
  'users.invite.intervention_required';

export interface InvitationAssignment {
  roles: UserRole[];
  groups: FunctionalCognitoGroup[];
}

export function normalizeInvitationEmail(value: string): string {
  const email = value.trim().toLowerCase();
  const [local, domain, extra] = email.split('@');
  if (
    email.length < 3 ||
    email.length > 320 ||
    extra !== undefined ||
    !local ||
    !domain ||
    !domain.includes('.') ||
    /[\s\u0000-\u001f]/.test(email)
  ) {
    throw new InvalidInvitationError();
  }
  return email;
}

export function invitationAssignment(
  roles: readonly string[],
): InvitationAssignment {
  if (roles.length === 0) {
    throw new InvalidInvitationError();
  }

  const selected = new Set<UserRole>();
  for (const role of roles) {
    if (!isUserRole(role)) {
      throw new InvalidInvitationError();
    }
    selected.add(role);
  }

  const ordered = sortRecognizedRoles([...selected]);
  return {
    roles: ordered,
    groups: ordered.map((role) => cognitoGroupForRole(role)),
  };
}
