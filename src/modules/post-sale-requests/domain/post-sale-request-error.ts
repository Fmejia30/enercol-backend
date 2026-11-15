export class TechnicalDatasetNotFoundError extends Error {
  constructor() {
    super('Technical dataset was not found');
    this.name = 'TechnicalDatasetNotFoundError';
  }
}

export class PostSaleRequestNotFoundError extends Error {
  constructor() {
    super('Post-sale request was not found');
    this.name = 'PostSaleRequestNotFoundError';
  }
}

export class PostSaleRequestQueryError extends Error {
  constructor() {
    super('Post-sale request query is invalid');
    this.name = 'PostSaleRequestQueryError';
  }
}

export class PostSaleRequestForbiddenError extends Error {
  constructor() {
    super('Post-sale request creation is not allowed');
    this.name = 'PostSaleRequestForbiddenError';
  }
}

export class PostSaleRequestConflictError extends Error {
  constructor() {
    super('Post-sale request identifier already exists');
    this.name = 'PostSaleRequestConflictError';
  }
}

export class PostSaleRequestPersistenceError extends Error {
  constructor() {
    super('Post-sale request could not be saved');
    this.name = 'PostSaleRequestPersistenceError';
  }
}
