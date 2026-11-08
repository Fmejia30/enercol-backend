import type { UserRole } from './user-role.js';

export interface AuthenticatedUser {
  readonly userId: string;
  readonly roles: readonly UserRole[];
}
