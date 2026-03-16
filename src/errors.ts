/**
 * Base error class.
 */
export class GeneralError extends Error {
  code: number | string;

  constructor(message: string) {
    super(message);
    this.code = 500;
    Object.defineProperty(this, "name", {
      value: this.constructor.name,
      enumerable: true,
    });
    Object.defineProperty(this, "message", {
      value: message,
      enumerable: true,
    });
  }
}

/**
 * SMTP response error with code and enhanced status.
 */
export class SMTPResponseError extends GeneralError {
  override code: string;
  enhancedCode: string | null;

  constructor(
    message: string,
    code: string = "500",
    enhancedCode: string | null = null,
  ) {
    super(message);
    this.code = code;
    this.enhancedCode = enhancedCode;
    Object.defineProperty(this, "name", {
      value: this.constructor.name,
      enumerable: true,
    });
    Object.defineProperty(this, "message", {
      value: message,
      enumerable: true,
    });
  }
}
