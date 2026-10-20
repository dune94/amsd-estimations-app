// ── Domain types for the PI-Estimation engine ────────────────────────────────
// Mirrors the rule set in pi-estimation-api/manifest.md (Domain Rules section).

export interface IssueSignals {
  key: string;
  issueType: string;
  summary: string;
  description: string;
  /** Parsed acceptance criteria lines, if any could be extracted. Empty = missing. */
  acceptanceCriteria: string[];
  labels: string[];
  priority: string;
  /** Raw value of the Requesting Business Unit field (customfield_10669), or null/empty. */
  rbuValue: string | null;
  linkedIssuesCount: number;
  subtasksCount: number;
  /** SP already recorded on sub-tasks, if any — used as a SpecKit bottom-up sum input. */
  subtaskEstimatesSp: number[];
  components: string[];
  /** Previously resolved SP via the sp-field-priority fallback chain, or null if none found. */
  previousSp: number | null;
}

export type EffortTier = 'Easy' | 'Medium' | 'Hard';
export type AcStatus = 'complete' | 'ambiguous' | 'missing';

export interface EffortClassification {
  tier: EffortTier;
  acStatus: AcStatus;
  reasons: string[];
}

export interface PertLensResult {
  value: number;
  rationale: string[];
}

export interface ConvergenceResult {
  converged: boolean;
  gapPct: number;
  basis: 'openspec-vs-speckit';
}

export interface PertResult {
  optimistic: PertLensResult;
  mostLikely: PertLensResult;
  pessimistic: PertLensResult;
  pertSp: number;
  sd: number;
  ci68: [number, number];
  ci95: [number, number];
  convergence: ConvergenceResult;
}

export interface EscalationResult {
  flagged: boolean;
  reasons: string[];
}

export type RbuCategory = 'Marketing' | 'Operations' | 'Community Engagement';

export interface RbuClassification {
  category: RbuCategory;
  matchedValue: string | null;
}

export interface BaselineComparator {
  key: string;
  sp: number;
  description: string;
  similarityScore: number;
}

export interface OpenSpecAnalysis {
  /** Refined ACs — complete, ordered, testable rewrites of the originals. */
  elaboratedAcs: string[];
  splitSuggested: boolean;
  splitRationale: string | null;
}

export interface SpecKitAnalysis {
  /** AC gaps not present in the original Jira story. */
  missingAcs: string[];
  /** System-level coverage or regression risks. */
  coverageRisks: string[];
  /** Interface / contract dependencies that need validation before dev. */
  interfaceContracts: string[];
}

export interface LlmPertEstimate {
  optimistic: number;
  mostLikely: number;
  pessimistic: number;
  pertSp: number;
  rationale: string[];
  /** Reference stories (real tickets with actual SP) the model sized against. */
  anchors?: string[];
  /** One-sentence plain-English framing of the estimate. */
  summary?: string;
  model: string;
  thinkingSummary: string | null;
  /** OpenSpec phase: elaborated ACs and split recommendation. */
  openSpec?: OpenSpecAnalysis;
  /** SpecKit phase: coverage gaps, risks, and interface contracts. */
  specKit?: SpecKitAnalysis;
}

export interface CodeFinding {
  /** Short label for the finding, e.g. "Missing ARIA live region". */
  title: string;
  /** Which WCAG success criterion or accessibility/quality standard this maps to, if any. */
  standard: string | null;
  /** One-sentence description of the gap or risk found in the source. */
  detail: string;
  /** Severity in terms of estimation impact: high = likely moves P up, low = note only. */
  severity: 'high' | 'medium' | 'low';
}

export interface CodeAssessment {
  /** Plain-English summary of the component(s) reviewed. */
  componentSummary: string;
  /** Number of call sites found across all brand repos, or null if not determinable. */
  callSiteCount: number | null;
  /** Concrete implementation gaps that affect the effort estimate. */
  findings: CodeFinding[];
  /**
   * How the findings affect the PERT scenarios. Expressed as signed SP deltas
   * the caller should consider applying to the pessimistic value.
   */
  pertImpact: {
    pessimisticDeltaSp: number;
    rationale: string;
  };
  model: string;
}

export interface AttachmentFinding {
  filename: string;
  /** Brief description of what was observed in the attachment. */
  observation: string;
  /** How this attachment bears on the effort estimate. */
  estimationRelevance: string;
  severity: 'high' | 'medium' | 'low';
}

export interface AttachmentAssessment {
  findings: AttachmentFinding[];
  pertImpact: {
    pessimisticDeltaSp: number;
    rationale: string;
  };
  model: string;
}

export interface EstimateResult {
  issueKey: string;
  summary: string;
  issueType: string;
  priority: string;
  effort: EffortClassification;
  rbu: RbuClassification;
  pert: PertResult;
  tshirt: string;
  baselineComparator: BaselineComparator | null;
  escalation: EscalationResult;
  previousSp: number | null;
  deltaSp: number | null;
  generatedAt: string;
  /** Present when LLM_MODE=enabled, withLlm=true, and the story was escalated. */
  llmEstimate?: LlmPertEstimate;
  /** Confidence-weighted blend: (llmSp × 0.4) + (deterministicSp × 0.6). Present when llmEstimate is set. */
  blendedSp?: number;
  /** Set when withLlm was requested and the LLM call failed (deterministic result returned). */
  llmError?: string;
  /** Present when withCodeAssessment=true. LLM-driven analysis of the component source. */
  codeAssessment?: CodeAssessment;
  /** Set when withCodeAssessment was requested and the assessment call failed. */
  codeAssessmentError?: string;
  /** Present when withAttachments=true. LLM-driven analysis of Jira attachments. */
  attachmentAssessment?: AttachmentAssessment;
  /** Set when withAttachments was requested and the assessment call failed. */
  attachmentAssessmentError?: string;
}
