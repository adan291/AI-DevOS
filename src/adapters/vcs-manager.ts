/**
 * VCS Manager
 * 
 * Manages multiple VCS adapters and routes operations to the correct platform.
 * Supports working with multiple repositories across different platforms simultaneously.
 */

import type {
  VCSAdapter,
  VCSPlatform,
  VCSPullRequest,
  VCSReview,
  VCSComment,
  VCSBranch,
  VCSRepository,
  VCSWebhookEvent,
  VCSWebhookHandler,
} from './vcs-adapter.js';

/** Repository identifier with platform */
export interface RepoRef {
  platform: VCSPlatform;
  owner: string;
  repo: string;
}

/**
 * VCS Manager - unified interface for multiple VCS platforms
 */
export class VCSManager {
  private adapters: Map<VCSPlatform, VCSAdapter> = new Map();
  private defaultPlatform: VCSPlatform = 'github';
  private webhookHandler: VCSWebhookHandler | null = null;

  /**
   * Register a VCS adapter
   */
  registerAdapter(adapter: VCSAdapter, isDefault = false): void {
    this.adapters.set(adapter.platform, adapter);
    if (isDefault) {
      this.defaultPlatform = adapter.platform;
    }
  }

  /**
   * Get adapter for a platform
   */
  getAdapter(platform?: VCSPlatform): VCSAdapter {
    const p = platform ?? this.defaultPlatform;
    const adapter = this.adapters.get(p);
    if (!adapter) {
      throw new Error(`No VCS adapter registered for platform: ${p}`);
    }
    return adapter;
  }

  /**
   * Set webhook handler for all platforms
   */
  onWebhook(handler: VCSWebhookHandler): void {
    this.webhookHandler = handler;
  }

  /**
   * Process an incoming webhook from any platform
   */
  async processWebhook(headers: Record<string, string>, body: string): Promise<VCSWebhookEvent | null> {
    // Try each adapter to parse the webhook
    for (const adapter of this.adapters.values()) {
      const event = adapter.parseWebhook(headers, body);
      if (event) {
        if (this.webhookHandler) {
          await this.webhookHandler(event);
        }
        return event;
      }
    }
    return null;
  }

  // --- Convenience methods that auto-detect platform ---

  async getPR(ref: RepoRef, prNumber: number): Promise<VCSPullRequest> {
    return this.getAdapter(ref.platform).getPR(ref.owner, ref.repo, prNumber);
  }

  async listPRs(ref: RepoRef, state?: 'open' | 'closed' | 'all'): Promise<VCSPullRequest[]> {
    return this.getAdapter(ref.platform).listPRs(ref.owner, ref.repo, state);
  }

  async createPR(
    ref: RepoRef, title: string, description: string,
    sourceBranch: string, targetBranch: string
  ): Promise<VCSPullRequest> {
    return this.getAdapter(ref.platform).createPR(ref.owner, ref.repo, title, description, sourceBranch, targetBranch);
  }

  async mergePR(ref: RepoRef, prNumber: number, commitTitle?: string): Promise<boolean> {
    return this.getAdapter(ref.platform).mergePR(ref.owner, ref.repo, prNumber, commitTitle);
  }

  async approvePR(ref: RepoRef, prNumber: number, body?: string): Promise<VCSReview> {
    return this.getAdapter(ref.platform).approvePR(ref.owner, ref.repo, prNumber, body);
  }

  async addComment(ref: RepoRef, prNumber: number, body: string): Promise<VCSComment> {
    return this.getAdapter(ref.platform).addComment(ref.owner, ref.repo, prNumber, body);
  }

  async listBranches(ref: RepoRef): Promise<VCSBranch[]> {
    return this.getAdapter(ref.platform).listBranches(ref.owner, ref.repo);
  }

  async getRepository(ref: RepoRef): Promise<VCSRepository> {
    return this.getAdapter(ref.platform).getRepository(ref.owner, ref.repo);
  }

  /**
   * Parse a repo URL into a RepoRef
   * Supports: github.com, gitlab.com, bitbucket.org
   */
  static parseRepoUrl(url: string): RepoRef | null {
    try {
      const parsed = new URL(url.replace(/\.git$/, ''));
      const parts = parsed.pathname.split('/').filter(Boolean);
      
      if (parts.length < 2) return null;

      let platform: VCSPlatform = 'github';
      if (parsed.hostname.includes('gitlab')) platform = 'gitlab';
      else if (parsed.hostname.includes('bitbucket')) platform = 'bitbucket';
      else if (parsed.hostname.includes('gitea')) platform = 'gitea';

      return { platform, owner: parts[0], repo: parts[1] };
    } catch {
      // Try SSH format: git@github.com:owner/repo.git
      const sshMatch = url.match(/git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
      if (sshMatch) {
        let platform: VCSPlatform = 'github';
        if (sshMatch[1].includes('gitlab')) platform = 'gitlab';
        else if (sshMatch[1].includes('bitbucket')) platform = 'bitbucket';
        return { platform, owner: sshMatch[2], repo: sshMatch[3] };
      }
      return null;
    }
  }

  /**
   * Get all registered platforms
   */
  getPlatforms(): VCSPlatform[] {
    return Array.from(this.adapters.keys());
  }
}

/**
 * Factory function
 */
export function createVCSManager(): VCSManager {
  return new VCSManager();
}
