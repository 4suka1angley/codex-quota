import * as vscode from "vscode";
import { normalizeOptionalPath, normalizePollInterval, resolveCodexHome } from "./paths";

export interface CodexQuotaConfig {
  pollIntervalSeconds: number;
  codexHome: string;
  codexExecutablePath: string | null;
}

export function readConfig(): CodexQuotaConfig {
  const config = vscode.workspace.getConfiguration("codexQuota");
  const configuredHome = config.get<string | null>("codexHome", null);
  const configuredExecutable = config.get<string | null>("codexExecutablePath", null);
  const pollIntervalSeconds = config.get<number>("pollIntervalSeconds", 60);

  return {
    pollIntervalSeconds: normalizePollInterval(pollIntervalSeconds),
    codexHome: resolveCodexHome(configuredHome),
    codexExecutablePath: normalizeOptionalPath(configuredExecutable),
  };
}
