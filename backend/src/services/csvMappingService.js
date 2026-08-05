import { ai, MAPPING_MODEL } from "../config/aiClient.js";
import {
  CRM_FIELD_DESCRIPTIONS,
  mappingResponseSchema,
  mappingJsonSchema,
  sourceLookupSchema,
} from "../schemas/mappingSchema.js";
import { DATA_SOURCE_VALUES } from "../schemas/crmRecordSchema.js";
import { callWithRetry } from "../utils/aiRetry.js";
import { logger } from "../utils/logger.js";

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

// ------------------------------------------------------------
// AI Call #1: column mapping — called ONCE per file, using only
// headers + a small sample of rows, not the full dataset.
// ------------------------------------------------------------
function buildMappingPrompt(headers, sampleRows) {
  const sampleRowsText = sampleRows
    .map((row) => headers.map((h) => `${h}: ${row[h] ?? ""}`).join(" | "))
    .join("\n");

  const fieldDescriptions = Object.entries(CRM_FIELD_DESCRIPTIONS)
    .map(([field, description]) => `- ${field}: ${description}`)
    .join("\n");

  return `You are analyzing an uploaded CSV file to map its columns to a fixed CRM schema.

CSV COLUMN HEADERS:
${headers.join(", ")}

SAMPLE ROWS (for understanding what kind of data each column actually holds):
${sampleRowsText}

TARGET CRM FIELDS you must map (a field may have no match), with what each one means:
${fieldDescriptions}

For each CRM field, determine how it should be filled using ONLY these patterns:

1. DIRECT COPY — one CSV column corresponds directly to this field.
   Example: source: "Email Address"

2. COMBINE — this field's value must be assembled from MULTIPLE CSV columns
   (for example, a first name column and a last name column both feeding
   into a single "name" field). Return source as an array of column names
   in the order they should be joined, and specify a combine strategy.
   Example: source: ["First Name", "Last Name"], combine: "concat_with_space"

3. NO MATCH — no CSV column reasonably corresponds to this field.
   Example: source: null


Rules:
- Use header text AND sample values together — a column's actual data
  (e.g. values containing "@") is often more reliable than its header name.
- Include a confidence score from 0 to 1 for every field.
- Respond with ONLY the structured mapping — no explanation text.`;
}

/**
 * Calls the AI once to determine which CSV column(s) map to which CRM
 * fields. Returns a validated mapping object, or throws if the AI
 * response fails structural validation.
 */
export async function inferColumnMapping(headers, sampleRows) {
  const prompt = buildMappingPrompt(headers, sampleRows);

  const response = await callWithRetry(
    () =>
      withTimeout(
        ai.models.generateContent({
          model: MAPPING_MODEL,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: "low" },
            responseMimeType: "application/json",
            responseSchema: mappingJsonSchema,
          },
        }),
        "Column mapping AI call",
      ),
    "column mapping",
  );

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (err) {
    throw new Error(
      `AI returned invalid JSON for column mapping: ${err.message}`,
    );
  }

  // Structural validation — did the AI return the shape we asked for?
  const validated = mappingResponseSchema.parse(parsed);

  // Sanity validation — does every mapped column actually exist in the
  // real CSV headers? Guards against a hallucinated but plausible-looking
  // column name.
  for (const [field, mapping] of Object.entries(validated)) {
    if (!mapping.source) continue;
    const sources = Array.isArray(mapping.source)
      ? mapping.source
      : [mapping.source];
    for (const col of sources) {
      if (!headers.includes(col)) {
        logger.warn(
          "AI mapped to a column that does not exist in the CSV — discarding",
          {
            field,
            claimedColumn: col,
          },
        );
        mapping.source = null;
        mapping.confidence = 0;
      }
    }
  }

  return validated;
}

// ------------------------------------------------------------
// AI Call #2: source/campaign value lookup — called ONCE per file,
// on the DEDUPLICATED distinct values only, not per row.
// ------------------------------------------------------------
function buildSourceLookupPrompt(uniqueValues) {
  return `Match each of the following source/campaign strings to the closest
allowed CRM data_source value. If a string doesn't confidently match any
allowed value, map it to an empty string "".

ALLOWED DATA_SOURCE VALUES:
${DATA_SOURCE_VALUES.join(", ")}

SOURCE STRINGS TO MATCH:
${uniqueValues.join("\n")}

Respond with a JSON object where each key is one of the exact source
strings above, and each value is the matched data_source value (or "").
Respond with ONLY this JSON object — no explanation text.`;
}

/**
 * Given a list of distinct source/campaign strings found in a file,
 * returns a lookup table mapping each to one of the fixed data_source
 * enum values (or '' if no confident match). Called once per file, not
 * once per row — the number of distinct values in a file is usually
 * small even when the row count is large.
 */
export async function inferSourceValueLookup(uniqueValues) {
  if (uniqueValues.length === 0) return {};

  const prompt = buildSourceLookupPrompt(uniqueValues);

  const response = await callWithRetry(
    () =>
      withTimeout(
        ai.models.generateContent({
          model: MAPPING_MODEL,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: "low" },
            responseMimeType: "application/json",
          },
        }),
        "Source lookup AI call",
      ),
    "source value lookup",
  );

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch (err) {
    throw new Error(
      `AI returned invalid JSON for source lookup: ${err.message}`,
    );
  }

  const validated = sourceLookupSchema.parse(parsed);

  // Discard any value the AI invented that isn't actually one of our
  // allowed enums (or blank) — same "don't blindly trust AI output"
  // principle as the column mapping validation above.
  for (const [key, value] of Object.entries(validated)) {
    if (value !== "" && !DATA_SOURCE_VALUES.includes(value)) {
      logger.warn(
        "AI returned a data_source value outside the allowed enum — clearing",
        {
          sourceString: key,
          invalidValue: value,
        },
      );
      validated[key] = "";
    }
  }

  return validated;
}
