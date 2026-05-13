import * as os from "node:os";
import * as path from "node:path";

export function normalizePollInterval(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(15, Math.round(value))
    : 60;
}

export function resolveCodexHome(configuredHome: string | null | undefined, env = process.env): string {
  const candidate = normalizeOptionalPath(configuredHome) ?? env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  return expandPath(candidate, env);
}

export function normalizeOptionalPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function expandPath(value: string, env = process.env): string {
  let expanded = value;

  if (expanded === "~" || expanded.startsWith(`~${path.sep}`) || expanded.startsWith("~/")) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  }

  expanded = expanded.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    return env[name] ?? "";
  });

  if (process.platform === "win32") {
    expanded = expanded.replace(/%([^%]+)%/g, (_match, name: string) => {
      return env[name] ?? env[name.toUpperCase()] ?? "";
    });
  }

  return path.resolve(expanded);
}
