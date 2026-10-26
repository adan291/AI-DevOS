/**
 * GitLab VCS Adapter
 * 
 * Implements VCSAdapter for GitLab using the REST API v4.
 * Supports: Merge Requests, Reviews, Comments, Branches.
 * 
 * Requires: GITLAB_TOKEN and optionally GITLAB_URL in env.
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

export class GitLabVCSAdapter implements VCSAdapter {
  readonly platform: VCSPlatform = 'gitlab';
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
  private baseUrl: string;

  constructor(token?: string, baseUrl?: string) {
    this.token = token ?? config.GITLAB_TOKEN?.() ?? '';
    this.baseUrl = baseUrl ?? config.GITLAB_URL?.() ?? 'https://gitlab.com';
  }

  private projectPath(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  // --- Merge Requests (GitLab's equivalent of PRs) ---

  async getPR(owner: string, repo: string, mrNumber: number): Promise<VCSPullRequest> {
    const data = await this.request('GET', `/projects/${this.projectPath(owner, repo)}/merge_requests/${mrNumber}`);
    return this.mapMR(data);
  }

  async listPRs(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<VCSPullRequest[]> {
    const glState = state === 'open' ? 'opened' : state === 'closed' ? 'closed' : 'all';
    const data = await this.request('GET', `/projects/${this.projectPath(owner, repo)}/merge_requests?state=${glState}`);
    return data.map((mr: any) => this.mapMR(mr));
  }

  async createPR(
    owner: string, repo: string, title: string, description: string,
    sourceBranch: string, targetBranch: string
  ): Promise<VCSPullRequest> {
    const data = await this.request('POST', `/projects/${this.projectPath(owner, repo)}/merge_requests`, {
      title, description, source_branch: sourceBranch, target_branch: targetBranch,
    });
    return this.mapMR(data);
  }

  async mergePR(owner: string, repo: string, mrNumber: number, commitTitle?: string): Promise<boolean> {
    try {
      await this.request('PUT', `/projects/${this.projectPath(owner, repo)}/merge_requests/${mrNumber}/merge`, {
        squash_commit_message: commitTitle,
        squash: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  // --- Reviews ---

  async approvePR(owner: string, repo: string, mrNumber: number, _body?: string): Promise<VCSReview> {
    const data = await this.request('POST', `/projects/${this.projectPath(owner, repo)}/merge_requests/${mrNumber}/approve`);
    return { id: data.id ?? 0, state: 'approved', body: '', author: '' };
  }

  async requestChanges(owner: string, repo: string, mrNumber: number, body: string): Promise<VCSReview> {
    // GitLab doesn't have a direct "request changes" - use a note instead
    const comment = await this.addComment(owner, repo, mrNumber, `⚠️ Changes Requested:\n\n${body}`);
    return { id: comment.id, state: 'changes_requested', body, author: comment.author };
  }

  async addLineComment(
    owner: string, repo: string, mrNumber: number,
    body: string, path: string, line: number
  ): Promise<VCSComment> {
    // Get the latest diff to find the position
    const mr = await this.request('GET', `/projects/${this.projectPath(owner, repo)}/merge_requests/${mrNumber}`);
    const diffRefs = mr.diff_refs;

    const data = await this.request('POST', `/projects/${this.projectPath(owner, repo)}/merge_requests/${mrNumber}/discussions`, {
      body,
      position: {
        base_sha: diffRefs?.base_sha,
        start_sha: diffRefs?.start_sha,
        head_sha: diffRefs?.head_sha,
        position_type: 'text',
        new_path: path,
        new_line: line,
      },
    });

    return {
      id: data.id ?? 0,
      body,
      path,
      line,
      author: data.notes?.[0]?.author?.username ?? '',
    };
  }

  async addComment(owner: string, repo: string, mrNumber: number, body: string): Promise<VCSComment> {
    const data = await this.request('POST', `/projects/${this.projectPath(owner, repo)}/merge_requests/${mrNumber}/notes`, { body });
    return { id: data.id, body: data.body, author: data.author?.username ?? '' };
  }

  // --- Branches ---

  async listBranches(owner: string, repo: string): Promise<VCSBranch[]> {
    const repoInfo = await this.getRepository(owner, repo);
    const data = await this.request('GET', `/projects/${this.projectPath(owner, repo)}/repository/branches`);
    return data.map((b: any) => ({
      name: b.name,
      sha: b.commit?.id ?? '',
      isDefault: b.name === repoInfo.defaultBranch,
    }));
  }

  async getRepository(owner: string, repo: string): Promise<VCSRepository> {
    const data = await this.request('GET', `/projects/${this.projectPath(owner, repo)}`);
    return {
      owner: data.namespace?.path ?? owner,
      name: data.path ?? repo,
      fullName: data.path_with_namespace ?? `${owner}/${repo}`,
      defaultBranch: data.default_branch ?? 'main',
      url: data.web_url ?? '',
    };
  }

  // --- Webhooks ---

  parseWebhook(headers: Record<string, string>, body: string): VCSWebhookEvent | null {
    const eventType = headers['x-gitlab-event'];
    if (!eventType) return null;

    try {
      const payload = JSON.parse(body);
      const event: VCSWebhookEvent = {
        platform: 'gitlab',
        action: payload.object_attributes?.action ?? eventType,
        repository: {
          owner: payload.project?.namespace ?? '',
          name: payload.project?.name ?? '',
          fullName: payload.project?.path_with_namespace ?? '',
          defaultBranch: payload.project?.default_branch ?? 'main',
          url: payload.project?.web_url ?? '',
        },
        raw: payload,
      };

      if (payload.object_attributes && eventType.includes('Merge Request')) {
        event.pullRequest = this.mapMR(payload.object_attributes);
      }

      return event;
    } catch {
      return null;
    }
  }

  // --- Private helpers ---

  private async request(method: string, path: string, body?: Record<string, any>): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/v4${path}`, {
      method,
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitLab API error: ${response.status} - ${error}`);
    }

    if (response.status === 204) return {};
    return response.json();
  }

  private mapMR(data: any): VCSPullRequest {
    const stateMap: Record<string, 'open' | 'closed' | 'merged'> = {
      'opened': 'open',
      'closed': 'closed',
      'merged': 'merged',
      'locked': 'closed',
    };
    return {
      id: data.iid ?? data.id,
      title: data.title ?? '',
      description: data.description ?? '',
      state: stateMap[data.state] ?? 'open',
      url: data.web_url ?? '',
      author: data.author?.username ?? '',
      sourceBranch: data.source_branch ?? '',
      targetBranch: data.target_branch ?? '',
      createdAt: data.created_at ?? '',
      updatedAt: data.updated_at ?? '',
    };
  }
}
