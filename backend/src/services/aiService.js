import { ai, CLASSIFICATION_MODEL } from "../config/aiClient.js";
import { CRM_STATUS_VALUES } from "../schemas/crmRecordSchema.js";
import { callWithRetry } from "../utils/aiRetry.js";
import { z } from "zod";

const CALL_TIMEOUT_MS = 20000;

function withTimeout(promise, label) {
  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(`${label} timed out after ${CALL_TIMEOUT_MS}ms`)),
      CALL_TIMEOUT_MS,
    ),
  );
  return Promise.race([promise, timeout]);
}

// One classification per row in the batch, keyed by the row's position
// within this batch (0-indexed) so results can be matched back up.
const classificationResponseSchema = z.record(
  z.string(),
  z.enum([...CRM_STATUS_VALUES, ""]), // '' = no confident classification
);

function buildClassificationPrompt(notesEntries) {
  const entriesText = notesEntries
    .map(([index, note]) => `${index}: "${note || "(empty)"}"`)
    .join("\n");

  return `Classify each of the following CRM lead notes into exactly one of
these statuses:

${CRM_STATUS_VALUES.join(", ")}

If a note doesn't give enough information to confidently choose one of
these statuses, use an empty string "" instead.

NOTES (each numbered — respond using the same numbers as keys):
${entriesText}

Respond with a JSON object mapping each number (as a string) to its
classified status. Respond with ONLY this JSON object — no explanation.`;
}

/**
 * Classifies crm_status for a batch of rows based on their free-text
 * notes. This is the one AI call that genuinely must run per-batch,
 * since it requires reading and judging content that differs on every
 * row — unlike column mapping or source lookup, there's no fixed answer
 * to resolve once and reuse.
 *
 * Wrapped in callWithRetry because a real 429 (RPM limit) was hit during
 * testing at row 280/2000 — even with strictly sequential processing and
 * no concurrency, batches ran fast enough to exceed 15 requests/minute.
 * Retry-with-backoff is needed regardless of whether p-limit concurrency
 * is ever added in sub-phase 4b — this is a baseline resilience need, not
 * a concurrency-specific one.
 *
 * @param {string[]} notes - array of notes text, one per row in the batch
 * @returns {Promise<string[]>} - array of crm_status values, same order/length as input
 */
export async function classifyBatchStatus(notes) {
  if (notes.length === 0) return [];

  // build { "0": note0, "1": note1, ... } so the AI's response keys map
  // directly back to array positions
  const entries = notes.map((note, i) => [String(i), note]);
  const prompt = buildClassificationPrompt(entries);

  const response = await callWithRetry(
    () =>
      withTimeout(
        ai.models.generateContent({
          model: CLASSIFICATION_MODEL,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: "low" },
            responseMimeType: "application/json",
          },
        }),
        "Status classification AI call",
      ),
    "status classification batch",
  );

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (err) {
    throw new Error(
      `AI returned invalid JSON for status classification: ${err.message}`,
    );
  }

  const validated = classificationResponseSchema.parse(parsed);

  // Reassemble into an array matching input order/length. Any index the
  // AI didn't return (shouldn't normally happen, but don't trust blindly)
  // falls back to '' rather than throwing and failing the whole batch.
  return notes.map((_, i) => validated[String(i)] ?? "");
}
