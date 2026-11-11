export const USER_PROFILE_UPDATED_AUDIT_ACTION = 'users.profile.updated';
export const USER_PROFILE_SELF_UPDATED_AUDIT_ACTION =
  'users.profile.self_updated';
export const USER_ROLES_UPDATED_AUDIT_ACTION = 'users.roles.updated';
export const USER_DISABLED_AUDIT_ACTION = 'users.disabled';
export const USER_ENABLED_AUDIT_ACTION = 'users.enabled';
export const USER_ROLES_COMPENSATION_ACTION = 'users.roles.compensation_failed';

export const USER_NAME_PATTERN = /^[^\u0000-\u001F\u007F]{1,80}$/;
export const USER_PHONE_PATTERN = /^\+?[0-9][0-9\s()-]{6,18}$/;

export type CognitoGlobalSignOutResult = 'completed' | 'failed' | 'not_requested';

export class UserAdministrationQueryError extends Error {
  readonly reason: 'invalid' | 'profile_incomplete';

  constructor(reason: 'invalid' | 'profile_incomplete' = 'invalid') {
    super('User administration request is invalid');
    this.name = 'UserAdministrationQueryError';
    this.reason = reason;
  }
}

export class UserAdministrationForbiddenError extends Error {
  constructor() {
    super('The administrator cannot disable their own account');
    this.name = 'UserAdministrationForbiddenError';
  }
}

export class UserAdministrationNotFoundError extends Error {
  constructor() {
    super('User was not found');
    this.name = 'UserAdministrationNotFoundError';
  }
}

export class UserAdministrationFailedError extends Error {
  constructor() {
    super('User administration is unavailable');
    this.name = 'UserAdministrationFailedError';
  }
}
