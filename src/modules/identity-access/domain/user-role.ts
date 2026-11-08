export enum UserRole {
  SPECIALIST = 'SPECIALIST',
  VALIDATOR = 'VALIDATOR',
}

export const RECOGNIZED_ROLES = [
  UserRole.SPECIALIST,
  UserRole.VALIDATOR,
] as const;
