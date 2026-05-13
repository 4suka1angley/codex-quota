import { CodexChatGptAuth } from "./auth";
import { CodexQuotaError } from "./errors";

export const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";

export interface RawRateLimitWindow {
  used_percent?: unknown;
  limit_window_seconds?: unknown;
  reset_at?: unknown;
}

export interface RawUsageResponse {
  plan_type?: unknown;
  rate_limit_name?: unknown;
  rate_limit_reached_type?: unknown;
  rate_limit?: {
    primary_window?: RawRateLimitWindow | null;
    secondary_window?: RawRateLimitWindow | null;
    limit_reached?: unknown;
    allowed?: unknown;
  } | null;
  additional_rate_limits?: unknown;
  credits?: RawCredits | null;
  spend_control?: {
    reached?: unknown;
  } | null;
}

export interface RawCredits {
  has_credits?: unknown;
  unlimited?: unknown;
  balance?: unknown;
}

export interface NormalizedCredits {
  hasCredits: boolean | null;
  unlimited: boolean | null;
  balance: number | null;
}

export interface NormalizedBucket {
  key: string;
  label: string;
  limitName: string | null;
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface UsageSnapshot {
  planType: string | null;
  credits: NormalizedCredits | null;
  buckets: NormalizedBucket[];
  fiveHour: NormalizedBucket | null;
  weekly: NormalizedBucket | null;
  tightest: NormalizedBucket | null;
  blocked: boolean;
  rateLimitReachedType: string | null;
  fetchedAtMs: number;
}

export async function fetchUsageSnapshot(
  auth: CodexChatGptAuth,
  fetchImpl: typeof fetch = fetch,
): Promise<UsageSnapshot> {
  if (!auth.accountId) {
    throw new CodexQuotaError("auth_invalid", "Codex ChatGPT auth is missing an account ID.");
  }

  let response: Response;
  try {
    response = await fetchImpl(USAGE_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "ChatGPT-Account-Id": auth.accountId,
        originator: "codex_vscode",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reach Codex usage endpoint.";
    throw new CodexQuotaError("network_error", message);
  }

  if (response.status === 401) {
    throw new CodexQuotaError("usage_unauthorized", "Codex usage request was unauthorized.", response.status);
  }

  if (response.status === 403 || response.status === 404) {
    throw new CodexQuotaError(
      response.status === 403 ? "usage_forbidden" : "usage_unavailable",
      "Codex usage data is not available for this account.",
      response.status,
    );
  }

  if (!response.ok) {
    throw new CodexQuotaError("usage_unavailable", "Codex usage endpoint returned an error.", response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CodexQuotaError("usage_schema_changed", "Codex usage response was not valid JSON.");
  }

  return normalizeUsageResponse(body, Date.now());
}

export function normalizeUsageResponse(body: unknown, fetchedAtMs = Date.now()): UsageSnapshot {
  const raw = asRecord(body);
  if (!raw) {
    throw new CodexQuotaError("usage_schema_changed", "Codex usage response shape changed.");
  }

  const usage = raw as RawUsageResponse;
  const primary = normalizeWindow(usage.rate_limit?.primary_window, "primary", null);
  const secondary = normalizeWindow(usage.rate_limit?.secondary_window, "secondary", null);
  const buckets = [primary, secondary].filter((bucket): bucket is NormalizedBucket => bucket != null);
  const additionalLimits = Array.isArray(usage.additional_rate_limits) ? usage.additional_rate_limits : [];

  additionalLimits.forEach((entry, index) => {
    const normalizedEntry = normalizeAdditionalLimit(entry, index);
    buckets.push(...normalizedEntry);
  });

  if (buckets.length === 0 && usage.rate_limit == null && usage.credits == null) {
    throw new CodexQuotaError("usage_schema_changed", "Codex usage response did not contain rate limit data.");
  }

  const fiveHour = selectWindowBucket(
    buckets.filter((bucket) => bucket.windowDurationMins != null && bucket.windowDurationMins < 1440),
    300,
  );
  const weekly = selectWindowBucket(
    buckets.filter((bucket) => bucket !== fiveHour && bucket.windowDurationMins != null && bucket.windowDurationMins >= 1440),
    10080,
  );
  const tightest = selectTightestBucket(buckets);
  const rateLimitReachedType = asNonEmptyString(usage.rate_limit_reached_type);
  const blocked =
    rateLimitReachedType != null ||
    usage.rate_limit?.limit_reached === true ||
    usage.rate_limit?.allowed === false ||
    usage.spend_control?.reached === true ||
    tightest?.remainingPercent === 0;

  return {
    planType: asNonEmptyString(usage.plan_type),
    credits: normalizeCredits(usage.credits),
    buckets,
    fiveHour,
    weekly,
    tightest,
    blocked,
    rateLimitReachedType,
    fetchedAtMs,
  };
}

export function remainingPercent(usedPercent: number): number {
  return clamp(100 - usedPercent, 0, 100);
}

function normalizeAdditionalLimit(entry: unknown, index: number): NormalizedBucket[] {
  const raw = asRecord(entry);
  const rateLimit = asRecord(raw?.rate_limit);
  if (!rateLimit) {
    return [];
  }

  const limitName = asNonEmptyString(raw?.limit_name);
  const primary = normalizeWindow(rateLimit.primary_window, `additional-${index}-primary`, limitName);
  const secondary = normalizeWindow(rateLimit.secondary_window, `additional-${index}-secondary`, limitName);
  return [primary, secondary].filter((bucket): bucket is NormalizedBucket => bucket != null);
}

function normalizeWindow(value: unknown, key: string, limitName: string | null): NormalizedBucket | null {
  const raw = asRecord(value);
  if (!raw) {
    return null;
  }

  const usedPercent = clamp(asNumber(raw.used_percent) ?? 0, 0, 100);
  const windowDurationMins = asNumber(raw.limit_window_seconds) == null
    ? null
    : (asNumber(raw.limit_window_seconds) as number) / 60;
  const resetsAt = asNumber(raw.reset_at);

  return {
    key,
    label: describeWindow(windowDurationMins),
    limitName,
    usedPercent,
    remainingPercent: remainingPercent(usedPercent),
    windowDurationMins,
    resetsAt,
  };
}

function normalizeCredits(value: RawCredits | null | undefined): NormalizedCredits | null {
  if (value == null || typeof value !== "object") {
    return null;
  }

  return {
    hasCredits: typeof value.has_credits === "boolean" ? value.has_credits : null,
    unlimited: typeof value.unlimited === "boolean" ? value.unlimited : null,
    balance: asNumber(value.balance),
  };
}

function selectWindowBucket(buckets: NormalizedBucket[], targetMinutes: number): NormalizedBucket | null {
  if (buckets.length === 0) {
    return null;
  }

  return buckets.reduce((best, candidate) => {
    const bestDistance = Math.abs((best.windowDurationMins ?? targetMinutes) - targetMinutes);
    const candidateDistance = Math.abs((candidate.windowDurationMins ?? targetMinutes) - targetMinutes);
    if (candidateDistance < bestDistance) {
      return candidate;
    }
    if (candidateDistance > bestDistance) {
      return best;
    }
    return (candidate.windowDurationMins ?? 0) > (best.windowDurationMins ?? 0) ? candidate : best;
  });
}

function selectTightestBucket(buckets: NormalizedBucket[]): NormalizedBucket | null {
  if (buckets.length === 0) {
    return null;
  }

  return buckets.reduce((best, candidate) => {
    if (candidate.remainingPercent < best.remainingPercent) {
      return candidate;
    }
    if (candidate.remainingPercent > best.remainingPercent) {
      return best;
    }
    return (candidate.windowDurationMins ?? 0) > (best.windowDurationMins ?? 0) ? candidate : best;
  });
}

function describeWindow(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) {
    return "Usage limit";
  }

  if (minutes >= 10079) {
    const weeks = Math.ceil(minutes / 10080);
    return weeks <= 1 ? "Weekly usage limit" : `${weeks}-week usage limit`;
  }

  if (minutes >= 1439) {
    const days = Math.ceil(minutes / 1440);
    return `${days}-day usage limit`;
  }

  if (minutes >= 60) {
    const hours = Math.ceil(minutes / 60);
    return `${hours}-hour usage limit`;
  }

  return `${Math.ceil(minutes)}-minute usage limit`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
