import { HttpStatus } from '@nestjs/common';
import { ApiResponse } from './api-response';

export class ResponseUtil {
  static getSuccessResponse<T>(message: string, data: T): ApiResponse<T>;
  static getSuccessResponse(message: string): ApiResponse<null>;
  static getSuccessResponse<T>(message: string, data?: T): ApiResponse<T | null> {
    return new ApiResponse(true, message, data ?? null);
  }

  static getErrorResponse(message: string, status: HttpStatus): ApiResponse<null> {
    const response = new ApiResponse<null>(false, message, null);
    response.statusCode = status;
    return response;
  }
}
