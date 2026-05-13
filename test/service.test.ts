import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { CodexQuotaConfig } from "../src/config";
import { CodexUsageService } from "../src/service";

test("CodexUsageService refreshes an expired token before requesting usage", async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-quota-"));
  await writeAuth(codexHome, makeJwt(Date.now() / 1000 - 10, "old-account"), "old-token");

  let refreshCount = 0;
  const service = new CodexUsageService(
    async (_input, init) => {
      assert.match(getAuthorization(init), /new-token/);
      return usageResponse();
    },
    async () => {
      refreshCount += 1;
      await writeAuth(codexHome, makeJwt(Date.now() / 1000 + 3600, "new-account"), "new-token");
    },
  );

  const snapshot = await service.readUsage(makeConfig(codexHome));
  assert.equal(refreshCount, 1);
  assert.equal(snapshot.fiveHour?.remainingPercent, 80);
});

test("CodexUsageService refreshes and retries after a 401 response", async () => {
  const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-quota-"));
  await writeAuth(codexHome, makeJwt(Date.now() / 1000 + 3600, "account-1"), "token-1");

  let fetchCount = 0;
  let refreshCount = 0;
  const service = new CodexUsageService(
    async (_input, init) => {
      fetchCount += 1;
      if (fetchCount === 1) {
        assert.match(getAuthorization(init), /token-1/);
        return new Response("{}", { status: 401 });
      }
      assert.match(getAuthorization(init), /token-2/);
      return usageResponse();
    },
    async () => {
      refreshCount += 1;
      await writeAuth(codexHome, makeJwt(Date.now() / 1000 + 3600, "account-2"), "token-2");
    },
  );

  const snapshot = await service.readUsage(makeConfig(codexHome));
  assert.equal(fetchCount, 2);
  assert.equal(refreshCount, 1);
  assert.equal(snapshot.weekly?.remainingPercent, 96);
});

function makeConfig(codexHome: string): CodexQuotaConfig {
  return {
    codexHome,
    pollIntervalSeconds: 60,
    codexExecutablePath: null,
  };
}

function getAuthorization(init: RequestInit | undefined): string {
  const headers = init?.headers as Record<string, string> | undefined;
  return String(headers?.Authorization ?? "");
}

async function writeAuth(codexHome: string, token: string, marker: string): Promise<void> {
  const parts = token.split(".");
  const markedToken = `${parts[0]}.${parts[1]}.${marker}`;
  await fs.writeFile(
    path.join(codexHome, "auth.json"),
    JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: markedToken,
        refresh_token: "refresh-token",
        account_id: "account-id",
      },
    }),
  );
}

function usageResponse(): Response {
  return new Response(
    JSON.stringify({
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 20, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
        secondary_window: { used_percent: 4, limit_window_seconds: 604_800, reset_at: 1_900_000_000 },
        allowed: true,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function makeJwt(exp: number, accountId: string): string {
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    exp: Math.floor(exp),
    "https://api.openai.com/auth": {
      chatgpt_account_id: accountId,
      chatgpt_plan_type: "plus",
    },
  })}.signature`;
}

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
