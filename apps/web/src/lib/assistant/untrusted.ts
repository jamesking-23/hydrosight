/**
 * Community report text is written by the public. It is data, never instructions.
 * Defence in depth (the tools are read-only, so injected text cannot act on its own):
 *  1. control characters and markup-like delimiters are stripped and the text is truncated;
 *  2. it is returned inside an "untrusted_text" field and the system prompt says to never obey it;
 *  3. instruction-like text is flagged so the turn log shows it;
 *  4. the answer validator still refuses advice and uncited claims whatever the model was told.
 */
const MAX = 300;

export function sanitizeUntrusted(text: unknown): string {
  const s = typeof text === "string" ? text : "";
  const cleaned = s.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g,
    "",
  );
  return cleaned
    .replace(/[<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX);
}

const INSTRUCTION_LIKE: RegExp[] = [
  /ignore (all |any |the )?(previous|prior|above|earlier)/i,
  /disregard (all |any |the )?(previous|prior|above|earlier|instructions)/i,
  /(system|developer) (prompt|message|instruction)/i,
  /you are (now|no longer)/i,
  /\b(act|behave|respond) as\b/i,
  /new instructions?/i,
  /\b(reveal|print|show|repeat) (your|the) (prompt|instructions|rules)/i,
  /\b(issue|send|publish|approve)\b.{0,30}\b(warning|alert|evacuation)/i,
  /\bevacuat/i,
  /\bcall (the )?(tool|function)\b/i,
];

export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_LIKE.some((r) => r.test(text));
}
