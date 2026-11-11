export enum UserRole {
  SPECIALIST = 'SPECIALIST',
  VALIDATOR = 'VALIDATOR',
  ADMINISTRATOR = 'ADMINISTRATOR',
}

export const RECOGNIZED_ROLES = [
  UserRole.SPECIALIST,
  UserRole.VALIDATOR,
  UserRole.ADMINISTRATOR,
] as const;

export function isUserRole(value: string): value is UserRole {
  return (RECOGNIZED_ROLES as readonly string[]).includes(value);
}
