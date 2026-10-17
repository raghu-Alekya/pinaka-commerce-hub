/**
 * Standard envelope for every merchant-service API response.
 * `data` is one object, a list, or null.
 */
export class ApiResponse<T> {
  success: boolean;
  message: string;
  data: T | null;
  timestamp: Date;
  /** Set by error responses so callers can map the body back to an HTTP status. */
  statusCode?: number;

  constructor(success: boolean, message: string, data: T | null = null) {
    this.success = success;
    this.message = message;
    this.data = data;
    this.timestamp = new Date();
  }
}
