import type { FunctionalCognitoGroup } from '../domain/functional-cognito-group.js';

export const COGNITO_USER_STATUSES = [
  'UNCONFIRMED',
  'CONFIRMED',
  'ARCHIVED',
  'COMPROMISED',
  'UNKNOWN',
  'RESET_REQUIRED',
  'FORCE_CHANGE_PASSWORD',
  'EXTERNAL_PROVIDER',
] as const;

export type CognitoUserStatus = (typeof COGNITO_USER_STATUSES)[number];

export interface CognitoManagedUser {
  sub: string;
  username: string;
  email: string | null;
  enabled: boolean;
  status: CognitoUserStatus;
  accountStatus: CognitoUserStatus | null;
  createdAt: Date | null;
  lastModifiedAt: Date | null;
}

export interface ListCognitoUsersInput {
  limit?: number;
  paginationToken?: string;
  emailPrefix?: string;
  accountStatus?: CognitoUserStatus;
}

export interface CognitoUserPage {
  users: CognitoManagedUser[];
  paginationToken: string | null;
}

export interface CognitoUserAdmin {
  createUser(email: string): Promise<CognitoManagedUser>;
  getUserByUsername(username: string): Promise<CognitoManagedUser>;
  getUserBySub(sub: string): Promise<CognitoManagedUser>;
  findUsersByEmail(email: string): Promise<CognitoManagedUser[]>;
  listGroups(username: string): Promise<FunctionalCognitoGroup[]>;
  addToGroup(username: string, group: string): Promise<void>;
  removeFromGroup(username: string, group: string): Promise<void>;
  disableUser(username: string): Promise<void>;
  enableUser(username: string): Promise<void>;
  signOutUser(username: string): Promise<void>;
  resendInvitation(username: string): Promise<void>;
  listUsers(input?: ListCognitoUsersInput): Promise<CognitoUserPage>;
}

export const COGNITO_USER_ADMIN = Symbol('COGNITO_USER_ADMIN');
