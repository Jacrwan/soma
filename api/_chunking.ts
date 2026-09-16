/// <reference types="node" />

// Character-based approximation of ~700-token chunks (no tokenizer dependency).
// Packs whole paragraphs together up to the target size, carrying a small
// overlap into the next chunk so a fact split across paragraphs isn't lost
// entirely to one side of a chunk boundary.
const TARGET_CHARS = 3_000;
const OVERLAP_CHARS = 300;
const HARD_MAX_CHARS = TARGET_CHARS * 2;

export function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  function flush() {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  }

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > TARGET_CHARS && current) {
      const overlap = current.slice(-OVERLAP_CHARS);
      chunks.push(current.trim());
      current = `${overlap}\n\n${para}`;
    } else {
      current = candidate;
    }
    // A single paragraph with no internal breaks can still blow past the
    // target on its own — hard-split it so no chunk is unbounded.
    while (current.length > HARD_MAX_CHARS) {
      chunks.push(current.slice(0, TARGET_CHARS).trim());
      current = current.slice(TARGET_CHARS - OVERLAP_CHARS);
    }
  }
  flush();

  return chunks;
}
