import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from '@nestjs/common';
import { Response } from 'express';
import {
  REQUEST_ID_HEADER,
  RequestWithRequestId,
  createRequestId
} from './request-id';

interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error?: string;
  requestId: string;
  timestamp: string;
  path: string;
}

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithRequestId>();
    const response = context.getResponse<Response>();
    const status = this.getStatus(exception);
    const requestId = request.requestId || createRequestId();

    request.requestId = requestId;
    if (!response.headersSent) {
      response.setHeader(REQUEST_ID_HEADER, requestId);
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logServerError(exception, request, status, requestId);
    }

    if (response.headersSent) {
      return;
    }

    response.status(status).json(this.createResponseBody(exception, request, status, requestId));
  }

  private getStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private createResponseBody(
    exception: unknown,
    request: RequestWithRequestId,
    status: number,
    requestId: string
  ): ErrorResponseBody {
    const baseBody = {
      statusCode: status,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl || request.url
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return {
        ...baseBody,
        message: 'Internal server error'
      };
    }

    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        return {
          ...baseBody,
          message: exceptionResponse
        };
      }

      if (this.isObject(exceptionResponse)) {
        const responseBody = exceptionResponse as Record<string, unknown>;
        return {
          ...baseBody,
          ...responseBody,
          statusCode: status,
          message: this.getClientErrorMessage(responseBody),
          requestId,
          timestamp: baseBody.timestamp,
          path: baseBody.path
        };
      }
    }

    return {
      ...baseBody,
      message: 'Internal server error'
    };
  }

  private logServerError(
    exception: unknown,
    request: RequestWithRequestId,
    status: number,
    requestId: string
  ): void {
    const message = exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    this.logger.error(
      `[${requestId}] ${request.method} ${request.originalUrl || request.url} failed with ${status}: ${message}`,
      stack
    );
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private getClientErrorMessage(responseBody: Record<string, unknown>): string | string[] {
    if (typeof responseBody.message === 'string' || Array.isArray(responseBody.message)) {
      return responseBody.message as string | string[];
    }

    if (typeof responseBody.error === 'string' && responseBody.error.trim()) {
      return responseBody.error;
    }

    return 'Request failed';
  }
}
