// Story pack helpers. The pack (pack.json + images/) is built by the scope engine; the app only adds reviewer notes to it.
// Same rules as the engine's own helper: verbatim, dated, capped, and empty notes do nothing.

import { readFileSync, writeFileSync } from 'node:fs';

export function appendNotes(packPath: string, notes: string, date: string, maxChars: number): void {
  const text = (notes ?? '').trim();
  if (!text) return;
  const capped = text.slice(0, maxChars);
  const pack = JSON.parse(readFileSync(packPath, 'utf8')) as { text: string; reviewer_notes?: { date: string; notes: string }[] };
  pack.text = `${pack.text}\n\nREVIEWER NOTES (${date})\n${capped}`;
  pack.reviewer_notes = [...(pack.reviewer_notes ?? []), { date, notes: capped }];
  writeFileSync(packPath, JSON.stringify(pack, null, 1));
}
