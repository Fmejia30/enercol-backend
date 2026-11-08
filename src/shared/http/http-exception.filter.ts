import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status = this.resolveStatus(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack =
        exception instanceof Error ? exception.stack : 'Unhandled exception';
      this.logger.error(stack);
    }

    const body: ErrorResponseBody = {
      statusCode: status,
      error: this.resolveError(exception, status),
      message: this.resolveMessage(exception, status),
      path: request.originalUrl || request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }

  private resolveStatus(exception: unknown): number {
    return exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveMessage(
    exception: unknown,
    status: number,
  ): string | string[] {
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return 'Internal server error';
    }

    if (!(exception instanceof HttpException)) {
      return 'Internal server error';
    }

    const exceptionBody = exception.getResponse();
    if (typeof exceptionBody === 'string') {
      return exceptionBody;
    }

    if (isRecord(exceptionBody) && 'message' in exceptionBody) {
      const message = exceptionBody.message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message) && message.every(isString)) {
        return message;
      }
    }

    return exception.message;
  }

  private resolveError(exception: unknown, status: number): string {
    if (exception instanceof HttpException) {
      const exceptionBody = exception.getResponse();
      if (isRecord(exceptionBody) && typeof exceptionBody.error === 'string') {
        return exceptionBody.error;
      }
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return 'Internal Server Error';
    }

    return exception instanceof HttpException
      ? exception.name
      : 'Internal Server Error';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
