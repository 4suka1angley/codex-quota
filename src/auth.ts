import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CodexQuotaError } from "./errors";

export interface CodexAuthFile {
  auth_mode?: unknown;
  tokens?: {
    id_token?: unknown;
    access_token?: unknown;
    refresh_token?: unknown;
    account_id?: unknown;
  };
  last_refresh?: unknown;
}

export interface JwtInfo {
  exp: number | null;
  accountId: string | null;
  userId: string | null;
  email: string | null;
  planType: string | null;
}

export interface CodexChatGptAuth {
  authFilePath: string;
  accessToken: string;
  refreshToken: string | null;
  accountId: string | null;
  jwt: JwtInfo;
}

export async function readCodexChatGptAuth(codexHome: string): Promise<CodexChatGptAuth> {
  const authFilePath = path.join(codexHome, "auth.json");
  let parsed: CodexAuthFile;

  try {
    parsed = JSON.parse(await fs.readFile(authFilePath, "utf8")) as CodexAuthFile;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new CodexQuotaError("auth_missing", `Codex auth file not found at ${authFilePath}.`);
    }

    throw new CodexQuotaError("auth_invalid", "Codex auth file could not be read.");
  }

  if (parsed.auth_mode !== "chatgpt") {
    throw new CodexQuotaError("auth_not_chatgpt", "Codex is not signed in with a ChatGPT account.");
  }

  const tokens = parsed.tokens;
  const accessToken = typeof tokens?.access_token === "string" ? tokens.access_token.trim() : "";
  const refreshToken = typeof tokens?.refresh_token === "string" ? tokens.refresh_token.trim() : null;
  const accountIdFromFile = typeof tokens?.account_id === "string" ? tokens.account_id.trim() : null;

  if (!accessToken) {
    throw new CodexQuotaError("auth_invalid", "Codex ChatGPT auth is missing an access token.");
  }

  const jwt = parseJwtInfo(accessToken) ?? parseJwtInfo(typeof tokens?.id_token === "string" ? tokens.id_token : "");

  return {
    authFilePath,
    accessToken,
    refreshToken,
    accountId: accountIdFromFile || jwt?.accountId || null,
    jwt: jwt ?? emptyJwtInfo(),
  };
}

export function tokenNeedsRefresh(jwt: JwtInfo, nowMs = Date.now(), skewMs = 5 * 60 * 1000): boolean {
  if (jwt.exp == null || !Number.isFinite(jwt.exp)) {
    return true;
  }

  return jwt.exp * 1000 <= nowMs + skewMs;
}

export function parseJwtInfo(token: string): JwtInfo | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    const auth = getObject(payload["https://api.openai.com/auth"]);
    const profile = getObject(payload["https://api.openai.com/profile"]);
    const exp = typeof payload.exp === "number" ? payload.exp : null;

    return {
      exp,
      accountId: getString(auth?.chatgpt_account_id) ?? getString(auth?.account_id),
      userId: getString(auth?.chatgpt_user_id) ?? getString(auth?.user_id),
      email: getString(profile?.email) ?? getString(payload.email),
      planType: getString(auth?.chatgpt_plan_type),
    };
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function emptyJwtInfo(): JwtInfo {
  return {
    exp: null,
    accountId: null,
    userId: null,
    email: null,
    planType: null,
  };
}
