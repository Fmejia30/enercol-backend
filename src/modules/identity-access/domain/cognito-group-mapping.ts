import { UserRole } from './user-role.js';

export const COGNITO_GROUP_TECHNICAL_SPECIALIST = 'ESPECIALISTA_TECNICO';
export const COGNITO_GROUP_VALIDATOR = 'ESPECIALISTA_VALIDADOR';
export const COGNITO_GROUP_ADMINISTRATOR = 'ADMINISTRADOR';

const ROLE_TO_GROUP = {
  [UserRole.SPECIALIST]: COGNITO_GROUP_TECHNICAL_SPECIALIST,
  [UserRole.VALIDATOR]: COGNITO_GROUP_VALIDATOR,
  [UserRole.ADMINISTRATOR]: COGNITO_GROUP_ADMINISTRATOR,
} as const;

const GROUP_TO_ROLE: Readonly<Record<string, UserRole>> = {
  [ROLE_TO_GROUP[UserRole.SPECIALIST]]: UserRole.SPECIALIST,
  [ROLE_TO_GROUP[UserRole.VALIDATOR]]: UserRole.VALIDATOR,
  [ROLE_TO_GROUP[UserRole.ADMINISTRATOR]]: UserRole.ADMINISTRATOR,
};

const ROLE_ORDER: readonly UserRole[] = [
  UserRole.SPECIALIST,
  UserRole.VALIDATOR,
  UserRole.ADMINISTRATOR,
];

export type MappedCognitoGroup = (typeof ROLE_TO_GROUP)[UserRole];

export function cognitoGroupForRole(role: UserRole): MappedCognitoGroup {
  return ROLE_TO_GROUP[role];
}

export function sortRecognizedRoles(roles: readonly UserRole[]): UserRole[] {
  const present = new Set(roles);
  return ROLE_ORDER.filter((role) => present.has(role));
}

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
