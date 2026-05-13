export type CodexQuotaErrorCode =
  | "auth_missing"
  | "auth_not_chatgpt"
  | "auth_invalid"
  | "token_refresh_failed"
  | "usage_unauthorized"
  | "usage_forbidden"
  | "usage_unavailable"
  | "usage_schema_changed"
  | "network_error";

export class CodexQuotaError extends Error {
  public readonly code: CodexQuotaErrorCode;
  public readonly statusCode?: number;

  public constructor(code: CodexQuotaErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = "CodexQuotaError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function toCodexQuotaError(error: unknown): CodexQuotaError {
  if (error instanceof CodexQuotaError) {
    return error;
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return new CodexQuotaError("network_error", message);
}
