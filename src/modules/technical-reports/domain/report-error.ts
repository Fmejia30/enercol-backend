export class ReportPrerequisiteError extends Error {
  constructor() {
    super('No hay un análisis técnico exitoso para esta solicitud');
    this.name = 'ReportPrerequisiteError';
  }
}

export class ReportContentInvalidError extends Error {
  constructor() {
    super('El informe generado no cumple las reglas del análisis');
    this.name = 'ReportContentInvalidError';
  }
}

export class ReportProviderUnavailableError extends Error {
  constructor() {
    super('No fue posible generar el informe');
    this.name = 'ReportProviderUnavailableError';
  }
}

export class ReportGenerationConflictError extends Error {
  constructor() {
    super('Ya hay una generación de informe en curso para esta solicitud');
    this.name = 'ReportGenerationConflictError';
  }
}

export class ReportNotFoundError extends Error {
  constructor() {
    super('No existe un informe con ese identificador');
    this.name = 'ReportNotFoundError';
  }
}

export class ReportSaveUnavailableError extends Error {
  constructor() {
    super('No fue posible guardar el informe');
    this.name = 'ReportSaveUnavailableError';
  }
}

export class ReportRevisionConflictError extends Error {
  constructor() {
    super('El informe cambió. Vuelva a abrir la versión más reciente.');
    this.name = 'ReportRevisionConflictError';
  }
}

export class ReportWorkflowError extends Error {
  constructor(
    message: string,
    readonly kind: 'forbidden' | 'conflict' | 'invalid',
  ) {
    super(message);
    this.name = 'ReportWorkflowError';
  }
}
