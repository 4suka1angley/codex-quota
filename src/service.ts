import { CodexChatGptAuth, readCodexChatGptAuth, tokenNeedsRefresh } from "./auth";
import type { CodexQuotaConfig } from "./config";
import { CodexQuotaError } from "./errors";
import { refreshTokenWithCodexAppServer } from "./appServer";
import { fetchUsageSnapshot, UsageSnapshot } from "./usage";

export class CodexUsageService {
  public constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly tokenRefresher: (codexExecutablePath: string | null) => Promise<void> = refreshTokenWithCodexAppServer,
  ) {}

  public async readUsage(config: CodexQuotaConfig): Promise<UsageSnapshot> {
    let auth = await readCodexChatGptAuth(config.codexHome);

    if (tokenNeedsRefresh(auth.jwt)) {
      await this.refreshToken(config);
      auth = await readCodexChatGptAuth(config.codexHome);
    }

    try {
      return await fetchUsageSnapshot(auth, this.fetchImpl);
    } catch (error) {
      if (error instanceof CodexQuotaError && error.code === "usage_unauthorized") {
        await this.refreshToken(config);
        const refreshedAuth: CodexChatGptAuth = await readCodexChatGptAuth(config.codexHome);
        return await fetchUsageSnapshot(refreshedAuth, this.fetchImpl);
      }

      throw error;
    }
  }

  private async refreshToken(config: CodexQuotaConfig): Promise<void> {
    await this.tokenRefresher(config.codexExecutablePath);
  }
}
