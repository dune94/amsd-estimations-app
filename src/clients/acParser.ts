// ── Acceptance-criteria extraction ──────────────────────────────────────────
// Best-effort, deterministic parse of an "Acceptance Criteria" section out of
// a plain-text issue description. No AC field is assumed to exist in Jira.
// Returns an empty array (treated as AC-missing by the effort classifier) if
// no such section is found — an honest default rather than a guess.

// Allow an optional numbered/bulleted prefix and trailing words after the
// keyword so headings like "5. Acceptance Criteria & Expected Outcome" match.
// \b prevents matching mid-sentence ("Acceptance criteria are still TBD…").
const HEADING_PATTERN = /^\s*(?:\d+[.)]\s*)?(acceptance criteria|acs?)\b[^.]{0,60}$/i;

export function parseAcceptanceCriteria(descriptionText: string): string[] {
  if (!descriptionText) return [];

  const lines = descriptionText.split(/\r?\n/);
  const headingIndex = lines.findIndex(line => HEADING_PATTERN.test(line.trim()));
  if (headingIndex === -1) return [];

  const criteria: string[] = [];
  let blankRun = 0;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') {
      // FIX (2026-09-16): Jira renders each bullet as <li><p>…</p></li>, so
      // stripHtml yields a blank line BETWEEN every bullet - the old "first
      // blank ends the section" rule captured only the first AC (PRJ-1:
      // 1 of 4). End the section on two consecutive blank lines instead.
      blankRun += 1;
      continue;
    }
    // After a blank line, only a further bullet character continues the section.
    // Numbered items (e.g. "6. Designs & Assets") end it — they are next-section
    // headings, not list continuations. Jira's bullet-blank-bullet pattern uses
    // "-" bullets, so this preserves AC extraction while stopping at section breaks.
    if (criteria.length > 0 && blankRun > 0 && !/^[-*•]\s+/.test(line)) break;
    blankRun = 0;
    // Stop at the next markdown-style heading.
    if (/^#{1,6}\s/.test(line) || /^[A-Z][A-Za-z ]{2,40}:$/.test(line)) break;
    const cleaned = line.replace(/^[-*•]\s*/, '').trim();
    if (cleaned) criteria.push(cleaned);
  }

  return criteria;
}
