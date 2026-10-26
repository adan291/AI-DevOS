/**
 * GitHub VCS Adapter
 * 
 * Implements VCSAdapter for GitHub using the REST API.
 * Wraps and extends the existing GitHubClient functionality.
 */

import type {
  VCSAdapter,
  VCSPlatform,
  VCSCapabilities,
  VCSPullRequest,
  VCSReview,
  VCSComment,
  VCSBranch,
  VCSRepository,
  VCSWebhookEvent,
} from './vcs-adapter.js';
import { config } from '../config/index.js';

export class GitHubVCSAdapter implements VCSAdapter {
  readonly platform: VCSPlatform = 'github';
  readonly capabilities: VCSCapabilities = {
    pullRequests: true,
    reviews: true,
    lineComments: true,
    merging: true,
    branches: true,
    webhooks: true,
    statusChecks: true,
  };

  private token: string;
  private readonly baseUrl = 'https://api.github.com';

  constructor(token?: string) {
    const configToken = config.GITHUB_TOKEN;
    this.token = token ?? (typeof configToken === 'function' ? configToken() : configToken) ?? '';
  }

  // --- Pull Requests ---

  async getPR(owner: string, repo: string, prNumber: number): Promise<VCSPullRequest> {
    const data = await this.request('GET', `/repos/${owner}/${repo}/pulls/${prNumber}`);
    return this.mapPR(data);
  }

  async listPRs(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<VCSPullRequest[]> {
    const data = await this.request('GET', `/repos/${owner}/${repo}/pulls?state=${state}`);
    return data.map((pr: any) => this.mapPR(pr));
  }

  async createPR(
    owner: string, repo: string, title: string, description: string,
    sourceBranch: string, targetBranch: string
  ): Promise<VCSPullRequest> {
    const data = await this.request('POST', `/repos/${owner}/${repo}/pulls`, {
      title, body: description, head: sourceBranch, base: targetBranch,
    });
    return this.mapPR(data);
  }

  async mergePR(owner: string, repo: string, prNumber: number, commitTitle?: string): Promise<boolean> {
    try {
      await this.request('PUT', `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
        commit_title: commitTitle ?? `Merge PR #${prNumber}`,
        merge_method: 'squash',
      });
      return true;
    } catch {
      return false;
    }
  }

  // --- Reviews ---

  async approvePR(owner: string, repo: string, prNumber: number, body = 'Approved by AI DevOS'): Promise<VCSReview> {
    const data = await this.request('POST', `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      event: 'APPROVE', body,
    });
    return this.mapReview(data);
  }

  async requestChanges(owner: string, repo: string, prNumber: number, body: string): Promise<VCSReview> {
    const data = await this.request('POST', `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
      event: 'REQUEST_CHANGES', body,
    });
    return this.mapReview(data);
  }

  async addLineComment(
    owner: string, repo: string, prNumber: number,
    body: string, path: string, line: number
  ): Promise<VCSComment> {
    const pr = await this.getPR(owner, repo, prNumber);
    const data = await this.request('POST', `/repos/${owner}/${repo}/pulls/${prNumber}/comments`, {
      body, path, line, commit_id: (pr as any).headSha,
    });
    return { id: data.id, body: data.body, path: data.path, line: data.line, author: data.user?.login ?? '' };
  }

  async addComment(owner: string, repo: string, prNumber: number, body: string): Promise<VCSComment> {
    const data = await this.request('POST', `/repos/${owner}/${repo}/issues/${prNumber}/comments`, { body });
    return { id: data.id, body: data.body, author: data.user?.login ?? '' };
  }

  // --- Branches ---

  async listBranches(owner: string, repo: string): Promise<VCSBranch[]> {
    const repoInfo = await this.getRepository(owner, repo);
    const data = await this.request('GET', `/repos/${owner}/${repo}/branches`);
    return data.map((b: any) => ({
      name: b.name,
      sha: b.commit?.sha ?? '',
      isDefault: b.name === repoInfo.defaultBranch,
    }));
  }

  async getRepository(owner: string, repo: string): Promise<VCSRepository> {
    const data = await this.request('GET', `/repos/${owner}/${repo}`);
    return {
      owner: data.owner?.login ?? owner,
      name: data.name ?? repo,
      fullName: data.full_name ?? `${owner}/${repo}`,
      defaultBranch: data.default_branch ?? 'main',
      url: data.html_url ?? '',
    };
  }

  // --- Webhooks ---

  parseWebhook(headers: Record<string, string>, body: string): VCSWebhookEvent | null {
    const eventType = headers['x-github-event'];
    if (!eventType) return null;

    try {
      const payload = JSON.parse(body);
      const event: VCSWebhookEvent = {
        platform: 'github',
        action: payload.action ?? eventType,
        repository: {
          owner: payload.repository?.owner?.login ?? '',
          name: payload.repository?.name ?? '',
          fullName: payload.repository?.full_name ?? '',
          defaultBranch: payload.repository?.default_branch ?? 'main',
          url: payload.repository?.html_url ?? '',
        },
        raw: payload,
      };

      if (payload.pull_request) {
        event.pullRequest = this.mapPR(payload.pull_request);
      }

      if (payload.review) {
        event.review = this.mapReview(payload.review);
      }

      return event;
    } catch {
      return null;
    }
  }

  // --- Private helpers ---

  private async request(method: string, path: string, body?: Record<string, any>): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${response.status} - ${error}`);
    }

    if (response.status === 204) return {};
    return response.json();
  }

  private mapPR(data: any): VCSPullRequest {
    return {
      id: data.number,
      title: data.title ?? '',
      description: data.body ?? '',
      state: data.merged ? 'merged' : data.state === 'closed' ? 'closed' : 'open',
      url: data.html_url ?? '',
      author: data.user?.login ?? '',
      sourceBranch: data.head?.ref ?? '',
      targetBranch: data.base?.ref ?? '',
      createdAt: data.created_at ?? '',
      updatedAt: data.updated_at ?? '',
    };
  }

  private mapReview(data: any): VCSReview {
    const stateMap: Record<string, VCSReview['state']> = {
      'APPROVED': 'approved',
      'CHANGES_REQUESTED': 'changes_requested',
      'COMMENTED': 'commented',
      'PENDING': 'pending',
    };
    return {
      id: data.id,
      state: stateMap[data.state] ?? 'commented',
      body: data.body ?? '',
      author: data.user?.login ?? '',
    };
  }
}
