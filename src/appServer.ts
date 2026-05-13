import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { CodexQuotaError } from "./errors";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface JsonRpcMessage {
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: {
    message?: string;
  };
}

export async function refreshTokenWithCodexAppServer(codexExecutablePath: string | null): Promise<void> {
  const executable = await resolveCodexExecutable(codexExecutablePath);

  if (!executable) {
    throw new CodexQuotaError("token_refresh_failed", "Unable to locate Codex executable for token refresh.");
  }

  const client = new AppServerProcess(executable);

  try {
    await client.start();
    await client.request("initialize", {
      clientInfo: {
        name: "codex_quota_vscode",
        title: "Codex Quota VS Code Extension",
        version: "0.0.1",
      },
    });
    client.notify("initialized", {});
    await client.request("account/read", { refreshToken: true });
  } catch (error) {
    if (error instanceof CodexQuotaError) {
      throw error;
    }

    throw new CodexQuotaError("token_refresh_failed", "Codex app-server could not refresh ChatGPT auth.");
  } finally {
    client.dispose();
  }
}

export async function resolveCodexExecutable(configuredPath: string | null): Promise<string | null> {
  if (configuredPath) {
    return configuredPath;
  }

  const bundled = await findBundledCodexExecutable();
  return bundled ?? "codex";
}

async function findBundledCodexExecutable(): Promise<string | null> {
  const extensionsDir = path.join(os.homedir(), ".vscode", "extensions");
  let entries: string[];

  try {
    entries = await fs.readdir(extensionsDir);
  } catch {
    return null;
  }

  const platformDirs = getCodexPlatformDirs();
  const candidates: Array<{ path: string; mtimeMs: number }> = [];

  for (const entry of entries) {
    if (!entry.startsWith("openai.chatgpt-")) {
      continue;
    }

    for (const platformDir of platformDirs) {
      const executable = path.join(extensionsDir, entry, "bin", platformDir, process.platform === "win32" ? "codex.exe" : "codex");
      try {
        const stat = await fs.stat(executable);
        if (stat.isFile()) {
          candidates.push({ path: executable, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // Ignore stale or partial extension installs.
      }
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path ?? null;
}

function getCodexPlatformDirs(): string[] {
  if (process.platform === "win32") {
    return ["windows-x86_64"];
  }

  if (process.platform === "linux") {
    return ["linux-x86_64", "linux-aarch64"];
  }

  if (process.platform === "darwin") {
    return ["darwin-aarch64", "darwin-x86_64"];
  }

  return [];
}

class AppServerProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = "";
  private readonly pending = new Map<number | string, PendingRequest>();

  public constructor(private readonly executable: string) {}

  public async start(): Promise<void> {
    if (this.child) {
      return;
    }

    try {
      this.child = spawn(this.executable, ["app-server", "--listen", "stdio://"], {
        stdio: "pipe",
        windowsHide: true,
      });
    } catch {
      throw new CodexQuotaError("token_refresh_failed", "Unable to start Codex app-server.");
    }

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.on("error", () => this.rejectAll(new CodexQuotaError("token_refresh_failed", "Codex app-server failed to start.")));
    this.child.on("exit", () => this.rejectAll(new CodexQuotaError("token_refresh_failed", "Codex app-server exited before responding.")));

    // Give spawn errors a short chance to surface.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  public request(method: string, params?: unknown, timeoutMs = 20_000): Promise<unknown> {
    if (!this.child) {
      return Promise.reject(new CodexQuotaError("token_refresh_failed", "Codex app-server is not running."));
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params }) + "\n";

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexQuotaError("token_refresh_failed", "Codex app-server token refresh timed out."));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.child?.stdin.write(payload, "utf8", (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timeout);
          reject(new CodexQuotaError("token_refresh_failed", "Unable to write to Codex app-server."));
        }
      });
    });
  }

  public notify(method: string, params?: unknown): void {
    if (!this.child) {
      return;
    }

    this.child.stdin.write(JSON.stringify({ method, params }) + "\n");
  }

  public dispose(): void {
    for (const pending of this.pending.values()) {
      pending.reject(new CodexQuotaError("token_refresh_failed", "Codex app-server request was cancelled."));
    }
    this.pending.clear();

    if (!this.child) {
      return;
    }

    this.child.stdin.end();
    this.child.kill();
    this.child = null;
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf("\n");

      if (!line) {
        continue;
      }

      this.handleMessage(line);
    }
  }

  private handleMessage(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }

    if (message.id == null) {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new CodexQuotaError("token_refresh_failed", message.error.message ?? "Codex app-server returned an error."));
      return;
    }

    pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
