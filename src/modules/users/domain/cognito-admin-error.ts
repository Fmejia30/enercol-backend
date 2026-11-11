export type CognitoAdminErrorCode =
  | 'user_not_found'
  | 'user_already_exists'
  | 'group_not_found'
  | 'group_not_allowed'
  | 'configuration'
  | 'unavailable';

const MESSAGES: Record<CognitoAdminErrorCode, string> = {
  user_not_found: 'Cognito user was not found',
  user_already_exists: 'Cognito user already exists',
  group_not_found: 'Cognito group was not found',
  group_not_allowed: 'Cognito group is not allowed',
  configuration: 'Cognito administration is not configured',
  unavailable: 'Cognito administration is unavailable',
};

export class CognitoAdminError extends Error {
  readonly code: CognitoAdminErrorCode;

  constructor(code: CognitoAdminErrorCode) {
    super(MESSAGES[code]);
    this.name = 'CognitoAdminError';
    this.code = code;
  }
}
