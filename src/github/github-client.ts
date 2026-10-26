/**
 * GitHub Client
 * Implements GitHub REST API operations for PR management
 * Requirements: 9.3, 9.4
 */

import { config } from '../config/index.js';

/** GitHub API response types */
export interface GitHubPR {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  html_url: string;
  user: { login: string };
  head: { ref: string; sha: string };
  base: { ref: string };
}

export interface GitHubReview {
  id: number;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING';
  body: string;
}

export interface GitHubComment {
  id: number;
  body: string;
  path?: string;
  line?: number;
}

/** GitHub Client interface */
export interface GitHubClient {
  /** Approve a pull request */
  approvePR(owner: string, repo: string, prNumber: number, body?: string): Promise<GitHubReview>;
  
  /** Merge a pull request */
  mergePR(owner: string, repo: string, prNumber: number, commitTitle?: string): Promise<boolean>;
  
  /** Create a review comment on a PR */
  createReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
    path: string,
    line: number
  ): Promise<GitHubComment>;
  
  /** Get PR details */
  getPR(owner: string, repo: string, prNumber: number): Promise<GitHubPR>;
}

/** Default implementation using GitHub REST API */
export class DefaultGitHubClient implements GitHubClient {
  private readonly token: string;
  private readonly baseUrl = 'https://api.github.com';

  constructor(token?: string) {
    const configToken = config.GITHUB_TOKEN;
    this.token = token ?? (typeof configToken === 'function' ? configToken() : configToken) ?? '';
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    
    const response = await fetch(url, {
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

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  async approvePR(
    owner: string,
    repo: string,
    prNumber: number,
    body = 'Approved by AI DevOS'
  ): Promise<GitHubReview> {
    return this.request<GitHubReview>(
      'POST',
      `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      {
        event: 'APPROVE',
        body,
      }
    );
  }

  async mergePR(
    owner: string,
    repo: string,
    prNumber: number,
    commitTitle?: string
  ): Promise<boolean> {
    try {
      await this.request(
        'PUT',
        `/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
        {
          commit_title: commitTitle ?? `Merge PR #${prNumber}`,
          merge_method: 'squash',
        }
      );
      return true;
    } catch (error) {
      console.error('[GitHubClient] Merge failed:', error);
      return false;
    }
  }

  async createReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
    path: string,
    line: number
  ): Promise<GitHubComment> {
    // First get the PR to get the commit SHA
    const pr = await this.getPR(owner, repo, prNumber);
    
    return this.request<GitHubComment>(
      'POST',
      `/repos/${owner}/${repo}/pulls/${prNumber}/comments`,
      {
        body,
        path,
        line,
        commit_id: pr.head.sha,
      }
    );
  }

  async getPR(owner: string, repo: string, prNumber: number): Promise<GitHubPR> {
    return this.request<GitHubPR>(
      'GET',
      `/repos/${owner}/${repo}/pulls/${prNumber}`
    );
  }
}

/** Factory function */
export function createGitHubClient(token?: string): GitHubClient {
  return new DefaultGitHubClient(token);
}
