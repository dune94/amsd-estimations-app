// ── Client interfaces & shared raw-issue shape ──────────────────────────────
// Both Jira and Confluence get a mock (in-memory fixtures) and a live (real
// REST) implementation behind these interfaces, so the app is fully
// buildable/testable without real credentials, per the manifest's
// credentials-handling requirement.

export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Download URL returned by the Jira API — requires auth to fetch. */
  contentUrl: string;
}

export interface RawJiraIssue {
  key: string;
  fields: {
    summary?: string;
    descriptionText?: string; // plain-text-extracted description (ADF/HTML already stripped by the client)
    issuetype?: { name?: string };
    labels?: string[];
    priority?: { name?: string };
    /** Requesting Business Unit — customfield_10669 */
    rbu?: string | null;
    /** Linked issue keys (any link type) */
    linkedIssueKeys?: string[];
    /** Sub-task SP estimates already resolved by the caller, if any */
    subtaskEstimatesSp?: number[];
    /** Component/file names named on the issue */
    components?: string[];
    /** Original Estimate — customfield_10410 */
    originalEstimateSp?: number | null;
    /** T-Shirt Size — customfield_10409 */
    tshirtSize?: string | null;
    /** Story Points — customfield_10052 (last-resort fallback only) */
    storyPointsFallback?: number | null;
    attachments?: JiraAttachment[];
  };
}

export interface JiraClient {
  getIssue(key: string): Promise<RawJiraIssue>;
  /** Posts a comment. Never writes to a Story Points or estimate field — see manifest hard gate 1. */
  addComment(key: string, bodyText: string): Promise<void>;
  searchByJql(jql: string, maxResults?: number): Promise<RawJiraIssue[]>;
  /**
   * Fetches the raw bytes of a Jira attachment. The URL is the `contentUrl` from a JiraAttachment.
   * Returns a Buffer — callers decide how to encode it (base64, temp file, etc.).
   */
  getAttachmentContent(url: string): Promise<Buffer>;
}

export interface ConfluencePageResult {
  pageId: string;
  url: string;
}

export interface ConfluenceClient {
  /** Creates the estimate page for an issue if none exists, otherwise updates it in place (versioned). */
  upsertEstimatePage(issueKey: string, title: string, htmlBody: string): Promise<ConfluencePageResult>;
}
