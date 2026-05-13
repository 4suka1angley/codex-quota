import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { readConfig, CodexQuotaConfig } from "./config";
import { toCodexQuotaError } from "./errors";
import { CodexUsageService } from "./service";
import { CodexQuotaStatusBar } from "./statusBar";

export function activate(context: vscode.ExtensionContext): void {
  const controller = new CodexQuotaController(context);
  context.subscriptions.push(controller);
  controller.start();
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered during activation.
}

class CodexQuotaController implements vscode.Disposable {
  private config: CodexQuotaConfig = readConfig();
  private readonly statusBar = new CodexQuotaStatusBar();
  private readonly service = new CodexUsageService();
  private timer: NodeJS.Timeout | null = null;
  private authWatcher: fs.FSWatcher | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private pendingRefresh = false;
  private debounceTimer: NodeJS.Timeout | null = null;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.context.subscriptions.push(
      vscode.commands.registerCommand("codexQuota.refresh", () => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("codexQuota")) {
          return;
        }

        this.config = readConfig();
        this.restartTimer();
        this.restartAuthWatcher();
        this.refresh();
      }),
    );
  }

  public start(): void {
    this.restartTimer();
    this.restartAuthWatcher();
    this.refresh();
  }

  public dispose(): void {
    this.statusBar.dispose();
    this.stopTimer();
    this.stopAuthWatcher();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private refresh(): void {
    if (this.refreshInFlight) {
      this.pendingRefresh = true;
      return;
    }

    this.statusBar.renderLoading();

    this.refreshInFlight = this.service
      .readUsage(this.config)
      .then((snapshot) => {
        this.statusBar.renderSnapshot(snapshot);
      })
      .catch((error) => {
        this.statusBar.renderError(toCodexQuotaError(error));
      })
      .finally(() => {
        this.refreshInFlight = null;
        if (this.pendingRefresh) {
          this.pendingRefresh = false;
          this.refresh();
        }
      });
  }

  private restartTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.refresh(), this.config.pollIntervalSeconds * 1000);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private restartAuthWatcher(): void {
    this.stopAuthWatcher();

    try {
      this.authWatcher = fs.watch(path.join(this.config.codexHome, "auth.json"), () => {
        this.debounceRefresh();
      });
    } catch {
      this.authWatcher = null;
    }
  }

  private stopAuthWatcher(): void {
    if (this.authWatcher) {
      this.authWatcher.close();
      this.authWatcher = null;
    }
  }

  private debounceRefresh(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.refresh();
    }, 500);
  }
}
