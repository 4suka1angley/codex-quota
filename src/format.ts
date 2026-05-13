import { NormalizedBucket, UsageSnapshot } from "./usage";

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "-";
  }

  return `${Math.round(Math.min(Math.max(value, 0), 100))}%`;
}

export function formatPlan(planType: string | null | undefined): string {
  if (!planType) {
    return "Unknown";
  }

  return planType.replace(/_/g, " ");
}

export function formatResetTime(unixSeconds: number | null | undefined, now = new Date()): string {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) {
    return "Unknown";
  }

  const reset = new Date(unixSeconds * 1000);
  if (Number.isNaN(reset.getTime())) {
    return "Unknown";
  }

  if (
    reset.getFullYear() === now.getFullYear() &&
    reset.getMonth() === now.getMonth() &&
    reset.getDate() === now.getDate()
  ) {
    return reset.toLocaleTimeString(undefined, { timeStyle: "short" });
  }

  return reset.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatUpdatedTime(timestampMs: number, now = new Date(timestampMs)): string {
  return now.toLocaleTimeString(undefined, { timeStyle: "medium" });
}

export function formatBucket(bucket: NormalizedBucket | null | undefined): string {
  if (!bucket) {
    return "Unavailable";
  }

  const reset = formatResetTime(bucket.resetsAt);
  return `${formatPercent(bucket.remainingPercent)} remaining (${formatPercent(bucket.usedPercent)} used), resets ${reset}`;
}

export function formatCredits(snapshot: UsageSnapshot): string {
  const credits = snapshot.credits;
  if (!credits) {
    return "Unavailable";
  }

  if (credits.unlimited === true) {
    return "Unlimited";
  }

  const parts: string[] = [];
  if (credits.hasCredits != null) {
    parts.push(credits.hasCredits ? "Available" : "None");
  }
  if (credits.balance != null) {
    parts.push(`balance ${credits.balance}`);
  }

  return parts.length > 0 ? parts.join(", ") : "Unavailable";
}
