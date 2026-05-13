import test from "node:test";
import assert from "node:assert/strict";
import { CodexQuotaError } from "../src/errors";
import { fetchUsageSnapshot, normalizeUsageResponse, remainingPercent } from "../src/usage";

test("remainingPercent clamps values into 0..100", () => {
  assert.equal(remainingPercent(20), 80);
  assert.equal(remainingPercent(-10), 100);
  assert.equal(remainingPercent(110), 0);
});

test("normalizeUsageResponse extracts five-hour and weekly windows", () => {
  const snapshot = normalizeUsageResponse(
    {
      plan_type: "plus",
      rate_limit: {
        primary_window: { used_percent: 20, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
        secondary_window: { used_percent: 4, limit_window_seconds: 604_800, reset_at: 1_900_000_000 },
        allowed: true,
      },
      credits: { has_credits: true, unlimited: false, balance: 12.5 },
    },
    1234,
  );

  assert.equal(snapshot.planType, "plus");
  assert.equal(snapshot.fiveHour?.remainingPercent, 80);
  assert.equal(snapshot.weekly?.remainingPercent, 96);
  assert.equal(snapshot.tightest?.key, "primary");
  assert.equal(snapshot.blocked, false);
  assert.equal(snapshot.credits?.balance, 12.5);
});

test("normalizeUsageResponse includes additional model limits", () => {
  const snapshot = normalizeUsageResponse({
    plan_type: "plus",
    rate_limit: {
      primary_window: { used_percent: 10, limit_window_seconds: 18_000, reset_at: 1_800_000_000 },
    },
    additional_rate_limits: [
      {
        limit_name: "gpt-5.3-codex-spark",
        rate_limit: {
          primary_window: { used_percent: 99, limit_window_seconds: 18_000, reset_at: 1_800_000_001 },
        },
      },
    ],
  });

  assert.equal(snapshot.buckets.length, 2);
  assert.equal(snapshot.tightest?.limitName, "gpt-5.3-codex-spark");
  assert.equal(snapshot.tightest?.remainingPercent, 1);
});

test("fetchUsageSnapshot maps forbidden status to safe error", async () => {
  const auth = {
    authFilePath: "auth.json",
    accessToken: "token",
    refreshToken: "refresh",
    accountId: "account",
    jwt: { exp: 2000000000, accountId: "account", userId: null, email: null, planType: "plus" },
  };
  const fetchImpl = async () => new Response("{}", { status: 403 });

  await assert.rejects(
    () => fetchUsageSnapshot(auth, fetchImpl as typeof fetch),
    (error) => error instanceof CodexQuotaError && error.code === "usage_forbidden",
  );
});

test("normalizeUsageResponse fails closed when schema has no usage data", () => {
  assert.throws(
    () => normalizeUsageResponse({}),
    (error) => error instanceof CodexQuotaError && error.code === "usage_schema_changed",
  );
});
