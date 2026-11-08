import { UserRole } from './user-role.js';

export const COGNITO_GROUP_TECHNICAL_SPECIALIST = 'ESPECIALISTA_TECNICO';
export const COGNITO_GROUP_VALIDATOR = 'ESPECIALISTA_VALIDADOR';

const GROUP_TO_ROLE: Readonly<Record<string, UserRole>> = {
  [COGNITO_GROUP_TECHNICAL_SPECIALIST]: UserRole.SPECIALIST,
  [COGNITO_GROUP_VALIDATOR]: UserRole.VALIDATOR,
};

const ROLE_ORDER: readonly UserRole[] = [
  UserRole.SPECIALIST,
  UserRole.VALIDATOR,
];

export function mapCognitoGroupsToRoles(groups: unknown): UserRole[] {
  if (!Array.isArray(groups)) {
    return [];
  }

  const recognized = new Set<UserRole>();
  for (const group of groups) {
    if (typeof group !== 'string') {
      continue;
    }
    const role = GROUP_TO_ROLE[group];
    if (role) {
      recognized.add(role);
    }
  }

  return ROLE_ORDER.filter((role) => recognized.has(role));
}
