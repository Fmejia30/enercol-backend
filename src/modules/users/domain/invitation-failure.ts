export class InvitationForbiddenError extends Error {
  constructor() {
    super('User invitation is not allowed');
    this.name = 'InvitationForbiddenError';
  }
}

export class InvalidInvitationError extends Error {
  constructor() {
    super('User invitation request is invalid');
    this.name = 'InvalidInvitationError';
  }
}

export class UserAlreadyExistsError extends Error {
  constructor() {
    super('A user with this email already exists');
    this.name = 'UserAlreadyExistsError';
  }
}

export class InvitationFailedError extends Error {
  constructor() {
    super('User invitation failed');
    this.name = 'InvitationFailedError';
  }
}
