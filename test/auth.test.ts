import test from "node:test";
import assert from "node:assert/strict";
import { parseJwtInfo, tokenNeedsRefresh } from "../src/auth";

test("parseJwtInfo reads ChatGPT account claims without verifying token", () => {
  const token = makeJwt({
    exp: 2000000000,
    "https://api.openai.com/auth": {
      chatgpt_account_id: "account-1",
      chatgpt_user_id: "user-1",
      chatgpt_plan_type: "plus",
    },
    "https://api.openai.com/profile": {
      email: "user@example.com",
    },
  });

  assert.deepEqual(parseJwtInfo(token), {
    exp: 2000000000,
    accountId: "account-1",
    userId: "user-1",
    email: "user@example.com",
    planType: "plus",
  });
});

test("tokenNeedsRefresh treats missing or near-expiry exp as refreshable", () => {
  assert.equal(tokenNeedsRefresh({ exp: null, accountId: null, userId: null, email: null, planType: null }, 1000), true);
  assert.equal(
    tokenNeedsRefresh({ exp: 10, accountId: null, userId: null, email: null, planType: null }, 9_000, 2_000),
    true,
  );
  assert.equal(
    tokenNeedsRefresh({ exp: 20, accountId: null, userId: null, email: null, planType: null }, 9_000, 2_000),
    false,
  );
});

function makeJwt(payload: unknown): string {
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url(payload)}.signature`;
}

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
