import Anthropic from '@anthropic-ai/sdk';

// Reads a PDF (or photo) of questions with Claude and returns question-bank rows for the
// teacher to REVIEW. Nothing is saved here: the portal shows the result as editable cards.

const MODEL = 'claude-opus-5-5';
const PRICE_PER_MTOK = { input: 4, output: 20 }; // USD, for the cost line shown to the teacher
const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const IMPORT_PATH = /^[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp)$/;
const TIME_LIMITS = [20, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1200, 1800];

let client = null;
const anthropic = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY from the environment

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The question text, without its number.' },
          kind: { type: 'string', enum: ['mcq', 'number', 'written'] },
          marks: { type: 'integer', description: 'For written questions: marks it is worth (1-20). 1 for mcq/number.' },
          options: { type: 'array', items: { type: 'string' }, description: 'Answer choices without their A)/B) labels. Empty for number questions.' },
          correct_option: { type: 'integer', description: '0-based index into options. -1 for number questions.' },
          correct_number: { type: 'string', description: 'The numeric answer as plain digits, e.g. "5" or "-2.75". Empty for mcq.' },
          tolerance: { type: 'string', description: 'Allowed ± margin for number answers, e.g. "0" or "0.01". "0" for mcq.' },
          answer_source: { type: 'string', enum: ['document', 'solved'] },
          explanation: { type: 'string' },
          topic: { type: 'string' },
          difficulty: { type: 'integer', enum: [1, 2, 3] },
          time_limit_seconds: { type: 'integer', enum: TIME_LIMITS },
          needs_diagram: { type: 'boolean' },
          page: { type: 'integer' },
          note: { type: 'string', description: 'Anything the teacher should double-check. Empty if nothing.' },
        },
        required: ['prompt', 'kind', 'marks', 'options', 'correct_option', 'correct_number', 'tolerance', 'answer_source', 'explanation', 'topic', 'difficulty', 'time_limit_seconds', 'needs_diagram', 'page', 'note'],
        additionalProperties: false,
      },
    },
    skipped: {
      type: 'array',
      items: {
        type: 'object',
        properties: { page: { type: 'integer' }, text: { type: 'string' }, reason: { type: 'string' } },
        required: ['page', 'text', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions', 'skipped'],
  additionalProperties: false,
};

function instructions({ subject, grade, topicHint }) {
  return `You are helping a Maths and Science tutor turn a question paper into an online question bank.
The attached document is a set of ${subject} questions${grade ? ` for ${grade} students` : ''}${topicHint ? `, mostly on: ${topicHint}` : ''}. It usually also contains the answers, often as an answer key at the end.

Extract every question, in the order it appears in the document.
- Multiple choice (including true/false) → kind "mcq". Keep the options' wording; drop the "A)", "(b)" labels.
- A question whose answer is one number (fill in the blank, calculate, how many…) → kind "number". Put units in the question text, e.g. "Answer in cm", never in correct_number.
- A question that needs working, an explanation, a proof, a drawing or a sentence → kind "written". Put the model answer or marking points in explanation, and the marks it is worth in marks (from the paper if shown, otherwise your best estimate).
- Only put a question in "skipped" if it cannot be answered on its own (e.g. it depends on an attached object). Do not rewrite questions into a different kind.

Rules:
- Copy each question faithfully. Only fix obvious scanning errors. Never invent questions.
- The portal shows plain text, so write maths with Unicode: x², x³, √, π, ≤, ≥, ≠, ×, ÷, °, fractions like 3/4. No LaTeX.
- Take the correct answer from the document when it is there (answer_source "document"). If the document has no answer for a question, solve it carefully and set answer_source "solved" and say so in note. If the document's answer looks wrong, keep the document's answer and explain the doubt in note.
- For number answers, set tolerance "0" for exact answers; for rounded decimals allow half of the last decimal place (e.g. 2 d.p. → "0.005").
- If the question refers to a figure, graph or diagram, set needs_diagram true and keep the question.
- topic: a short topic name such as "Fractions", "Linear equations", "Forces". Use the same name for the same topic.
- difficulty for a ${grade || 'typical school'} student: 1 = one step or recall, 2 = a few steps, 3 = multi-step reasoning or a tricky idea.
- time_limit_seconds: a fair time for that student to read and answer it (written answers usually need 300 or more).
- page: the page number the question is on (first page = 1).
- explanation: one or two short sentences on how to get the answer, from the document if it has one.`;
}

export class ImportError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function importQuestions({ admin, path, subject, grade, topicHint }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new ImportError(503, 'AI import isn’t set up yet: add ANTHROPIC_API_KEY to the backend settings.');
  const { data: blob, error } = await admin.storage.from('question-imports').download(path);
  if (error || !blob) throw new ImportError(404, 'The uploaded file could not be found. Please upload it again.');
  try {
    if (blob.size > MAX_FILE_BYTES) throw new ImportError(413, 'The file is bigger than 20 MB. Split the PDF into smaller parts and import them one by one.');
    const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64');
    const isPdf = path.endsWith('.pdf');
    const mediaType = isPdf ? 'application/pdf' : path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    const fileBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

    let message;
    try {
      const stream = anthropic().beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: QUESTION_SCHEMA } },
        messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: instructions({ subject, grade, topicHint }) }] }],
      });
      message = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new ImportError(503, 'The Anthropic API key is not valid. Check ANTHROPIC_API_KEY.');
      if (err instanceof Anthropic.RateLimitError) throw new ImportError(429, 'The AI service is busy right now. Please try again in a minute.');
      if (err instanceof Anthropic.BadRequestError) throw new ImportError(400, `The AI couldn’t read this file: ${err.message}`);
      if (err instanceof Anthropic.APIError) throw new ImportError(502, `The AI service returned an error (${err.status}). Please try again.`);
      throw err;
    }

    if (message.stop_reason === 'refusal') throw new ImportError(422, 'The AI declined to read this document.');
    if (message.stop_reason === 'max_tokens') throw new ImportError(413, 'This document has too many questions for one import. Split the PDF into smaller parts.');
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new ImportError(502, 'The AI’s answer could not be read. Please try again.'); }

    const usage = message.usage ?? {};
    const inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    const costUsd = (inputTokens * PRICE_PER_MTOK.input + (usage.output_tokens ?? 0) * PRICE_PER_MTOK.output) / 1e6;
    return { questions: (parsed.questions ?? []).map((q) => normalise(q, subject, grade)), skipped: parsed.skipped ?? [], cost_usd: Math.round(costUsd * 1000) / 1000 };
  } finally {
    await admin.storage.from('question-imports').remove([path]); // never keep the teacher's PDF around
  }
}

// Make each extracted question match the question bank's rules; problems become notes for review.
function normalise(q, subject, grade) {
  const notes = q.note ? [q.note] : [];
  const out = {
    subject, grade: grade || null, topic: String(q.topic || 'General').slice(0, 100), prompt: String(q.prompt || '').slice(0, 2000),
    difficulty: [1, 2, 3].includes(q.difficulty) ? q.difficulty : 2, kind: ['mcq', 'number', 'written'].includes(q.kind) ? q.kind : 'mcq', marks: Number.isInteger(q.marks) && q.marks >= 1 && q.marks <= 20 ? q.marks : 1,
    time_limit_seconds: TIME_LIMITS.includes(q.time_limit_seconds) ? q.time_limit_seconds : 60,
    explanation: String(q.explanation || '').slice(0, 2000), options: [], correct_option: 0, correct_number: '', tolerance: '0',
    answer_source: q.answer_source === 'solved' ? 'solved' : 'document', needs_diagram: Boolean(q.needs_diagram), page: q.page ?? null, notes,
  };
  if (out.kind === 'mcq') {
    out.options = (q.options ?? []).map((o) => String(o).slice(0, 300)).filter(Boolean).slice(0, 6);
    out.correct_option = Number.isInteger(q.correct_option) && q.correct_option >= 0 && q.correct_option < out.options.length ? q.correct_option : -1;
    if (out.options.length < 2) notes.push('Fewer than 2 options were found.');
    if (out.correct_option < 0) notes.push('No correct option was identified.');
  } else if (out.kind === 'number') {
    out.correct_number = String(q.correct_number ?? '').trim();
    out.tolerance = String(q.tolerance ?? '0').trim() || '0';
    if (out.correct_number === '' || Number.isNaN(Number(out.correct_number))) notes.push('The numeric answer is missing or not a number.');
  }
  return out;
}
