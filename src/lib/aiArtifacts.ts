import { sendMessage } from './ai';
import type { Attachment } from './uploads';
import { createGoogleDoc, createGoogleSlides, SlideSpec } from './googleDocs';

// ── Tag parsing (shared by the AI chat and the Create page) ──────────────────

export interface CreateDocSpec { title: string; content: string }
export interface CreateSlidesSpec { title: string; slides: SlideSpec[] }

export function parseCreateDoc(content: string): CreateDocSpec | null {
  const match = content.match(/<createDoc\s+title="([^"]*)">([\s\S]*?)<\/createDoc>/);
  if (!match) return null;
  const title = match[1].trim() || 'Soma Notes';
  const body = match[2].trim();
  if (!body) return null;
  return { title, content: body };
}

export function parseCreateSlides(content: string): CreateSlidesSpec | null {
  const match = content.match(/<createSlides\s+title="([^"]*)">([\s\S]*?)<\/createSlides>/);
  if (!match) return null;
  const title = match[1].trim() || 'Soma Presentation';
  const body = match[2].trim();
  const slides: SlideSpec[] = [];
  let current: SlideSpec | null = null;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('==')) {
      if (current) slides.push(current);
      current = { title: line.replace(/^==\s*/, '').trim(), bullets: [] };
    } else if (line.startsWith('-') || line.startsWith('•') || line.startsWith('*')) {
      if (current) current.bullets.push(line.replace(/^[-•*]\s*/, '').trim());
    } else if (current) {
      current.bullets.push(line);
    }
  }
  if (current) slides.push(current);
  const cleaned = slides.filter(s => s.title || s.bullets.length > 0);
  return cleaned.length > 0 ? { title, slides: cleaned } : null;
}

export function parseCreateFlashcards(content: string): CreateFlashcardSpec | null {
  const match = content.match(/<createFlashcards\s+title="([^"]*)">([\s\S]*?)<\/createFlashcards>/);
  if (!match) return null;
  const title = match[1].trim() || 'Flashcards';
  const body = match[2].trim();
  const cards: { front: string; back: string }[] = [];
  // Each card: Q: ... / A: ...
  const cardBlocks = body.split(/\n(?=Q:\s)/);
  for (const block of cardBlocks) {
    const qMatch = block.match(/^Q:\s*(.+)/m);
    const aMatch = block.match(/^A:\s*(.+)/m);
    if (qMatch && aMatch) {
      cards.push({ front: qMatch[1].trim(), back: aMatch[1].trim() });
    }
  }
  return cards.length > 0 ? { title, cards } : null;
}

// ── Create-page templates ────────────────────────────────────────────────────

export type ArtifactKind = 'doc' | 'slides' | 'flashcards';

export interface CreateFlashcardSpec {
  title: string;
  cards: { front: string; back: string }[];
}

export interface CreateTemplate {
  id: string;
  label: string;
  description: string;
  output: ArtifactKind;
  icon: string;
  /** Template-specific guidance appended to the system prompt. */
  instruction: string;
}

const DOC_FORMAT = `Respond with ONLY a single <createDoc> block and nothing else before or after it:
<createDoc title="A short descriptive title">
The full document text. Write it out completely — this exact text becomes the Google Doc.
Use plain text with line breaks. You may use **bold** for emphasis and "- " for bullet lists.
Use clear section headings on their own lines.
</createDoc>`;

const SLIDES_FORMAT = `Respond with ONLY a single <createSlides> block and nothing else before or after it.
Use "== " to begin each slide (the text after it is the slide title) and "- " for each bullet:
<createSlides title="Deck title">
== Overview
- First point
- Second point
== Next topic
- A point
- Another point
</createSlides>`;

const FLASHCARDS_FORMAT = `Respond with ONLY a single <createFlashcards> block and nothing else before or after it.
Each card has a "Q: " line (the front) and an "A: " line (the back):
<createFlashcards title="Deck title">
Q: What is photosynthesis?
A: The process by which plants convert sunlight into chemical energy

Q: What are the two stages of photosynthesis?
A: The light-dependent reactions and the Calvin cycle (light-independent reactions)
</createFlashcards>`;

export const CREATE_TEMPLATES: CreateTemplate[] = [
  {
    id: 'flashcards',
    label: 'Flashcards',
    description: 'A study deck generated from your material',
    output: 'flashcards',
    icon: 'Fc',
    instruction: `Produce a set of 15-25 flashcards that cover the key concepts, definitions, and facts.
- Each card should test ONE concept.
- Keep the front (question) clear and specific.
- Keep the back (answer) concise but complete — one or two sentences max.
- Cover the material thoroughly, from basics to important details.
- Order the cards so that foundational concepts come first.
${FLASHCARDS_FORMAT}`,
  },
  {
    id: 'notes',
    label: 'Study Notes',
    description: 'Clean, organized notes on a topic or file',
    output: 'doc',
    icon: 'Sn',
    instruction: `Produce thorough but well-organized study notes.
- Open with a one-line overview of the topic.
- Break the material into clear sections, each with a heading.
- Use concise bullet points; bold the key terms and give a short definition for each.
- Include concrete examples where they aid understanding.
- End with a short "Key takeaways" section.
${DOC_FORMAT}`,
  },
  {
    id: 'slides',
    label: 'Slide Deck',
    description: 'A presentation you can edit in Google Slides',
    output: 'slides',
    icon: 'Sd',
    instruction: `Produce a clear, well-structured slide deck of about 6–12 slides.
- Start with an "Overview" or agenda slide.
- Give each slide a focused title and 3–6 concise bullets (not full paragraphs).
- Build the topic logically from basics to detail.
- End with a "Key takeaways" or "Summary" slide.
${SLIDES_FORMAT}`,
  },
  {
    id: 'studyguide',
    label: 'Study Guide',
    description: 'Exam-focused review with key concepts',
    output: 'doc',
    icon: 'Sg',
    instruction: `Produce an exam-focused study guide.
- List the key concepts and definitions a student must know.
- Include important formulas, dates, or rules where relevant.
- Add a "Likely exam questions" section with brief model answers.
- Add a "Common mistakes to avoid" section.
${DOC_FORMAT}`,
  },
  {
    id: 'quiz',
    label: 'Practice Quiz',
    description: 'Self-test questions with an answer key',
    output: 'doc',
    icon: 'Qz',
    instruction: `Produce a practice quiz that tests real understanding.
- Write 10–15 questions mixing multiple choice and short answer.
- Number the questions and keep them clear.
- After all questions, add a clearly separated "Answer Key" with the correct answer and a one-line explanation for each.
${DOC_FORMAT}`,
  },
  {
    id: 'outline',
    label: 'Essay Outline',
    description: 'Thesis, structure, and evidence points',
    output: 'doc',
    icon: 'Eo',
    instruction: `Produce a structured essay outline.
- State a clear, arguable thesis at the top.
- Provide 3–5 body sections, each with a topic sentence and 2–4 supporting evidence points or examples.
- Note where citations or sources would strengthen each point.
- End with a direction for the conclusion.
- If a specific prompt or assignment is provided, address it directly.
${DOC_FORMAT}`,
  },
  {
    id: 'summary',
    label: 'Summarize',
    description: 'Condense an assignment or file into the essentials',
    output: 'doc',
    icon: 'Sm',
    instruction: `Produce a faithful, concise summary of the provided material.
- Begin with a 2–3 sentence high-level overview.
- Follow with the main points as bullets, in the source's logical order.
- End with a short "Key takeaways" section.
- Do not invent information that is not supported by the source.
${DOC_FORMAT}`,
  },
];

// ── Generation ───────────────────────────────────────────────────────────────

export interface GenerateInput {
  template: CreateTemplate;
  sourceLabel: string;
  sourceContext: string;
  instructions?: string;
  attachments?: Attachment[];
  driveToken: string;
}

export interface GenerateResult {
  kind: ArtifactKind;
  title: string;
  url: string;
}

export interface PreviewResult {
  kind: ArtifactKind;
  title: string;
  rawContent: string;
  docSpec?: CreateDocSpec;
  slidesSpec?: CreateSlidesSpec;
  flashcardsSpec?: CreateFlashcardSpec;
}

export async function generatePreview(input: Omit<GenerateInput, 'driveToken'>): Promise<PreviewResult> {
  const { template, sourceLabel, sourceContext, instructions, attachments } = input;

  const systemPrompt = `You are Soma, a study assistant that generates polished study materials for a student.
You write directly and substantively — never ask follow-up questions, never add commentary outside the required block.
Always produce real, complete content based on the material provided.

${template.instruction}`;

  const userParts = [
    `Create a ${template.label.toLowerCase()} about: ${sourceLabel}`,
    sourceContext ? `\nSource material:\n${sourceContext}` : '',
    attachments && attachments.length > 0
      ? `\nBase it on the attached ${attachments.length > 1 ? 'files' : 'file'} (e.g. lecture slide or reading). Read ${attachments.length > 1 ? 'them' : 'it'} carefully and use only what they contain.`
      : '',
    instructions?.trim() ? `\nAdditional instructions from the student:\n${instructions.trim()}` : '',
  ].filter(Boolean);

  const response = await sendMessage(
    [{ role: 'user', content: userParts.join('\n') }],
    systemPrompt,
    'sonnet',
    attachments,
  );

  if (template.output === 'flashcards') {
    const spec = parseCreateFlashcards(response);
    if (!spec) throw new Error('generation_failed');
    return { kind: 'flashcards', title: spec.title, rawContent: response, flashcardsSpec: spec };
  }

  if (template.output === 'slides') {
    const spec = parseCreateSlides(response);
    if (!spec) throw new Error('generation_failed');
    return { kind: 'slides', title: spec.title, rawContent: response, slidesSpec: spec };
  }

  const spec = parseCreateDoc(response);
  if (!spec) throw new Error('generation_failed');
  return { kind: 'doc', title: spec.title, rawContent: response, docSpec: spec };
}

export async function savePreviewToDrive(
  preview: PreviewResult,
  driveToken: string,
): Promise<GenerateResult> {
  if (preview.kind === 'slides' && preview.slidesSpec) {
    try {
      const { presentationUrl } = await createGoogleSlides(driveToken, preview.slidesSpec.title, preview.slidesSpec.slides);
      return { kind: 'slides', title: preview.title, url: presentationUrl };
    } catch (err: unknown) {
      const e = err as Error & { presentationUrl?: string };
      if (e.presentationUrl) return { kind: 'slides', title: preview.title, url: e.presentationUrl };
      throw err;
    }
  }
  if (preview.docSpec) {
    const { docUrl } = await createGoogleDoc(driveToken, preview.docSpec.title, preview.docSpec.content);
    return { kind: 'doc', title: preview.title, url: docUrl };
  }
  throw new Error('generation_failed');
}

export async function generateArtifact(input: GenerateInput): Promise<GenerateResult> {
  const preview = await generatePreview(input);
  return savePreviewToDrive(preview, input.driveToken);
}
