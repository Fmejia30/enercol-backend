export class UserDirectoryQueryError extends Error {
  constructor() {
    super('User directory query is invalid');
    this.name = 'UserDirectoryQueryError';
  }
}

export class UserDirectoryNotFoundError extends Error {
  constructor() {
    super('User was not found');
    this.name = 'UserDirectoryNotFoundError';
  }
}

export class UserDirectoryFailedError extends Error {
  constructor() {
    super('User directory is unavailable');
    this.name = 'UserDirectoryFailedError';
  }
}
