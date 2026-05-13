import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { normalizeOptionalPath, normalizePollInterval, resolveCodexHome } from "../src/paths";

test("normalizePollInterval clamps invalid and small values", () => {
  assert.equal(normalizePollInterval(undefined), 60);
  assert.equal(normalizePollInterval(1), 15);
  assert.equal(normalizePollInterval(42.4), 42);
});

test("resolveCodexHome prefers explicit path, then CODEX_HOME", () => {
  assert.equal(resolveCodexHome("  ./custom-codex  ", { CODEX_HOME: "./env-codex" }), path.resolve("./custom-codex"));
  assert.equal(resolveCodexHome(null, { CODEX_HOME: "./env-codex" }), path.resolve("./env-codex"));
});

test("normalizeOptionalPath trims empty values", () => {
  assert.equal(normalizeOptionalPath("  "), null);
  assert.equal(normalizeOptionalPath("  C:/codex  "), "C:/codex");
});
