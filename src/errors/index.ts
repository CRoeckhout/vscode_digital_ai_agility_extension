/**
 * Custom error classes for the Agility extension.
 * Provides structured error handling with meaningful messages.
 */

/**
 * Base error class for all Agility-related errors.
 */
export class AgilityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AgilityError';
    Object.setPrototypeOf(this, AgilityError.prototype);
  }

  /**
   * Formats the error for display to the user.
   */
  toUserMessage(): string {
    return this.message;
  }
}

/**
 * Error thrown when the extension is not properly configured.
 */
export class ConfigurationError extends AgilityError {
  constructor(message: string, cause?: unknown) {
    super(message, 'CONFIGURATION_ERROR', cause);
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Error thrown when an API request fails.
 */
export class ApiError extends AgilityError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: unknown,
    cause?: unknown
  ) {
    super(message, 'API_ERROR', cause);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  toUserMessage(): string {
    if (this.statusCode) {
      return `${this.message} (HTTP ${this.statusCode})`;
    }
    return this.message;
  }
}

/**
 * Error thrown when a required resource is not found.
 */
export class NotFoundError extends AgilityError {
  constructor(resourceType: string, identifier: string, cause?: unknown) {
    super(`${resourceType} not found: ${identifier}`, 'NOT_FOUND', cause);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Error thrown when a Git operation fails.
 */
export class GitError extends AgilityError {
  constructor(message: string, cause?: unknown) {
    super(message, 'GIT_ERROR', cause);
    this.name = 'GitError';
    Object.setPrototypeOf(this, GitError.prototype);
  }
}

/**
 * Extracts a user-friendly error message from any error type.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof AgilityError) {
    return error.toUserMessage();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Wraps an unknown error into an AgilityError if it isn't already one.
 */
export function wrapError(error: unknown, defaultMessage: string): AgilityError {
  if (error instanceof AgilityError) {
    return error;
  }
  if (error instanceof Error) {
    return new AgilityError(error.message || defaultMessage, 'UNKNOWN', error);
  }
  return new AgilityError(String(error) || defaultMessage, 'UNKNOWN', error);
}
