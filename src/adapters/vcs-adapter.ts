/**
 * VCS (Version Control System) Adapter Interface
 * 
 * Abstract interface for any VCS platform (GitHub, GitLab, Bitbucket, Gitea, etc.).
 * Each platform implements this interface for unified PR/MR management.
 */

/** Supported VCS platforms */
export type VCSPlatform = 'github' | 'gitlab' | 'bitbucket' | 'gitea';

/** Repository info */
export interface VCSRepository {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  url: string;
}

/** Branch info */
export interface VCSBranch {
  name: string;
  sha: string;
  isDefault: boolean;
}

/** Pull/Merge Request */
export interface VCSPullRequest {
  id: number;
  title: string;
  description: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  createdAt: string;
  updatedAt: string;
}

/** Review on a PR/MR */
export interface VCSReview {
  id: number;
  state: 'approved' | 'changes_requested' | 'commented' | 'pending';
  body: string;
  author: string;
}

/** Comment on a PR/MR */
export interface VCSComment {
  id: number;
  body: string;
  path?: string;
  line?: number;
  author: string;
}

/** Webhook event from VCS */
export interface VCSWebhookEvent {
  platform: VCSPlatform;
  action: string;
  repository: VCSRepository;
  pullRequest?: VCSPullRequest;
  review?: VCSReview;
  comment?: VCSComment;
  raw: Record<string, any>;
}

/** Capabilities of a VCS adapter */
export interface VCSCapabilities {
  pullRequests: boolean;
  reviews: boolean;
  lineComments: boolean;
  merging: boolean;
  branches: boolean;
  webhooks: boolean;
  statusChecks: boolean;
}

/** VCS webhook handler */
export type VCSWebhookHandler = (event: VCSWebhookEvent) => Promise<void>;

/**
 * VCS Adapter Interface
 * 
 * Any VCS platform must implement this interface.
 */
export interface VCSAdapter {
  /** Platform identifier */
  readonly platform: VCSPlatform;
  
  /** What this adapter can do */
  readonly capabilities: VCSCapabilities;

  // --- Pull Requests ---
  
  /** Get a pull/merge request */
  getPR(owner: string, repo: string, prNumber: number): Promise<VCSPullRequest>;
  
  /** List open pull/merge requests */
  listPRs(owner: string, repo: string, state?: 'open' | 'closed' | 'all'): Promise<VCSPullRequest[]>;
  
  /** Create a pull/merge request */
  createPR(
    owner: string,
    repo: string,
    title: string,
    description: string,
    sourceBranch: string,
    targetBranch: string
  ): Promise<VCSPullRequest>;
  
  /** Merge a pull/merge request */
  mergePR(owner: string, repo: string, prNumber: number, commitTitle?: string): Promise<boolean>;

  // --- Reviews ---
  
  /** Approve a PR/MR */
  approvePR(owner: string, repo: string, prNumber: number, body?: string): Promise<VCSReview>;
  
  /** Request changes on a PR/MR */
  requestChanges(owner: string, repo: string, prNumber: number, body: string): Promise<VCSReview>;
  
  /** Add a line comment on a PR/MR */
  addLineComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
    path: string,
    line: number
  ): Promise<VCSComment>;
  
  /** Add a general comment on a PR/MR */
  addComment(owner: string, repo: string, prNumber: number, body: string): Promise<VCSComment>;

  // --- Branches ---
  
  /** List branches */
  listBranches(owner: string, repo: string): Promise<VCSBranch[]>;
  
  /** Get repository info */
  getRepository(owner: string, repo: string): Promise<VCSRepository>;

  // --- Webhooks ---
  
  /** Parse an incoming webhook payload into a normalized event */
  parseWebhook(headers: Record<string, string>, body: string): VCSWebhookEvent | null;
}
