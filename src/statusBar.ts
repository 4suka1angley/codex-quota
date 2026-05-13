import * as vscode from "vscode";
import { CodexQuotaError } from "./errors";
import { formatBucket, formatCredits, formatPercent, formatPlan, formatUpdatedTime } from "./format";
import { UsageSnapshot } from "./usage";

export class CodexQuotaStatusBar {
  private readonly item: vscode.StatusBarItem;

  public constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = "Codex Quota";
    this.item.command = "codexQuota.refresh";
    this.renderLoading();
    this.item.show();
  }

  public dispose(): void {
    this.item.dispose();
  }

  public renderLoading(): void {
    this.item.text = "$(sync~spin) Codex";
    this.item.color = undefined;
    this.item.tooltip = "Loading Codex usage...";
  }

  public renderSnapshot(snapshot: UsageSnapshot): void {
    const remaining = snapshot.blocked ? 0 : snapshot.tightest?.remainingPercent;
    this.item.text = `$(sparkle) Codex ${formatPercent(remaining)}`;
    this.item.color = getStatusColor(snapshot);
    this.item.tooltip = buildTooltip(snapshot);
  }

  public renderError(error: CodexQuotaError): void {
    this.item.text = "$(sparkle) Codex";
    this.item.color = new vscode.ThemeColor("statusBarItem.errorForeground");
    this.item.tooltip = buildErrorTooltip(error);
  }
}

function getStatusColor(snapshot: UsageSnapshot): vscode.ThemeColor | undefined {
  const remaining = snapshot.blocked ? 0 : snapshot.tightest?.remainingPercent;

  if (remaining == null) {
    return undefined;
  }

  if (remaining <= 0) {
    return new vscode.ThemeColor("statusBarItem.errorForeground");
  }

  if (remaining <= 10) {
    return new vscode.ThemeColor("statusBarItem.warningForeground");
  }

  return undefined;
}

function buildTooltip(snapshot: UsageSnapshot): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.supportThemeIcons = true;
  tooltip.isTrusted = false;

  tooltip.appendMarkdown("**Codex Usage**\n\n");
  tooltip.appendMarkdown(`- Plan: ${escapeMarkdown(formatPlan(snapshot.planType))}\n`);
  tooltip.appendMarkdown(`- 5-hour limit: ${escapeMarkdown(formatBucket(snapshot.fiveHour))}\n`);
  tooltip.appendMarkdown(`- Weekly limit: ${escapeMarkdown(formatBucket(snapshot.weekly))}\n`);
  tooltip.appendMarkdown(`- Credits: ${escapeMarkdown(formatCredits(snapshot))}\n`);
  tooltip.appendMarkdown(`- Last updated: ${escapeMarkdown(formatUpdatedTime(snapshot.fetchedAtMs))}\n`);

  if (snapshot.blocked) {
    tooltip.appendMarkdown(`- Status: ${escapeMarkdown(snapshot.rateLimitReachedType ?? "limit reached")}\n`);
  }

  return tooltip;
}

function buildErrorTooltip(error: CodexQuotaError): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.isTrusted = false;
  tooltip.appendMarkdown("**Codex Usage Unavailable**\n\n");
  tooltip.appendMarkdown(`- Reason: ${escapeMarkdown(error.message)}\n`);
  tooltip.appendMarkdown("- No token or account details were logged.\n");
  return tooltip;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, "\\$&");
}
