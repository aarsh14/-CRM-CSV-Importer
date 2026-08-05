import fs from "fs";
import csvParser from "csv-parser";
import pLimit from "p-limit";
import { ImportJob } from "../models/importJob.js";
import { ImportRecord } from "../models/importRecord.js";
import { logger } from "../utils/logger.js";
import {
  inferColumnMapping,
  inferSourceValueLookup,
} from "./csvMappingService.js";
import { classifyBatchStatus } from "./aiService.js";
import { crmRecordSchema } from "../schemas/crmRecordSchema.js";

const BATCH_SIZE = 20;
const SAMPLE_ROW_COUNT = 8;
const SAMPLE_POOL_SIZE = 30; // read a wider pool, then pick the most complete rows from it
// Lowered from 5 to 2 after live testing: with a 15 RPM ceiling on the
// classification model, concurrency of 5 caused firing bursts of
// simultaneous calls that blew through the per-minute limit repeatedly —
// observed retry waits of 50+ seconds (vs. ~4s under sequential 4a
// testing), meaning higher concurrency was making total run time WORSE,
// not better. 2 stays closer to what a 15 RPM budget can actually sustain.
const BATCH_CONCURRENCY = 2;

/**
 * SUB-PHASE 4b — correctness (4a) already verified against all 4 real
 * test CSVs + the 2,000-row synthetic file. This phase adds:
 *   - concurrent batch processing (p-limit) instead of strictly sequential
 *   - atomic $inc progress updates, required now that writes can overlap
 *     (see README section 8 for the full read-modify-write race explanation)
 *
 * Overall flow per job:
 *   1. Read a wide pool of rows, pick the most complete ones as samples
 *      (guards against a mapping call being misled by a run of thin/empty
 *      rows landing at the very top of a file)
 *   2. AI Call #1: infer column mapping (once per job)
 *   3. Single full pass: count rows, collect unique data_source values,
 *      AND pre-build all batches — combined into one read instead of two
 *   4. AI Call #2: resolve unique source values to enum lookup (once per job)
 *   5. Process all batches CONCURRENTLY (bounded by BATCH_CONCURRENCY):
 *      apply mapping via JS, AI Call #3 per batch for crm_status,
 *      validate, save, atomically increment progress via $inc
 */
export async function processImportJob(jobId, filePath) {
  try {
    await ImportJob.findByIdAndUpdate(jobId, { status: "processing" });

    // --- Step 1: sample rows for AI Call #1, preferring complete ones ---
    const { headers, sampleRows } = await readSampleRows(
      filePath,
      SAMPLE_POOL_SIZE,
      SAMPLE_ROW_COUNT,
    );

    // --- Step 2: AI Call #1 — column mapping (once per job) ---
    const mapping = await inferColumnMapping(headers, sampleRows);

    // --- Step 3: single full pass — count, unique source values, AND batches ---
    const sourceColumn = mapping.data_source_column?.source ?? null;
    const { totalRows, uniqueSourceValues, batches } =
      await scanAndBuildBatches(filePath, sourceColumn, BATCH_SIZE);

    // --- Step 4: AI Call #2 — resolve unique source values (once per job) ---
    const sourceLookup = await inferSourceValueLookup(uniqueSourceValues);

    await ImportJob.findByIdAndUpdate(jobId, {
      totalRows,
      columnMapping: mapping,
      sourceValueLookup: sourceLookup,
    });

    // --- Step 5: process all batches concurrently, bounded by p-limit ---
    const limit = pLimit(BATCH_CONCURRENCY);

    await Promise.all(
      batches.map((batch) =>
        limit(() => processBatch(jobId, batch, mapping, sourceLookup)),
      ),
    );

    // Counts were built up via $inc during processing — re-read the job
    // rather than re-aggregating locally, so there's exactly one source
    // of truth for the final numbers.
    const finalJob = await ImportJob.findById(jobId);

    await ImportJob.findByIdAndUpdate(jobId, { status: "completed" });

    logger.info("Import job completed", {
      jobId,
      totalRows,
      importedCount: finalJob.importedCount,
      skippedCount: finalJob.skippedCount,
    });
  } catch (err) {
    logger.error("Import job failed", { jobId, error: err.message });
    await ImportJob.findByIdAndUpdate(jobId, {
      status: "failed",
      errorMessage: err.message,
    });
  } finally {
    fs.unlink(filePath, (err) => {
      if (err)
        logger.warn("Failed to delete temp file", {
          filePath,
          error: err.message,
        });
    });
  }
}

// Reads a wider POOL of rows (not just the first `sampleCount`), scores
// each by how many non-empty fields it has, and returns the most complete
// `sampleCount` rows. Guards against a mapping call being misled if the
// file happens to have several thin/empty rows clustered near the top —
// a real, observed pattern in messy CRM exports (walk-ins, test rows).
function readSampleRows(filePath, poolSize, sampleCount) {
  return new Promise((resolve, reject) => {
    const pool = [];
    let headers = [];
    const stream = fs.createReadStream(filePath).pipe(csvParser());

    stream.on("headers", (h) => {
      headers = h;
    });
    stream.on("data", (row) => {
      pool.push(row);
      if (pool.length >= poolSize) stream.destroy(); // stop reading early
    });

    const finish = () => {
      const scored = pool
        .map((row) => ({
          row,
          completeness: Object.values(row).filter((v) => v && String(v).trim())
            .length,
        }))
        .sort((a, b) => b.completeness - a.completeness);

      const sampleRows = scored.slice(0, sampleCount).map((s) => s.row);
      resolve({ headers, sampleRows });
    };

    stream.on("close", finish);
    stream.on("end", finish);
    stream.on("error", reject);
  });
}

// Combines what used to be two full-file passes (count+unique-values,
// and batch-building) into one. Batches are collected into memory as raw
// row objects (not yet AI-processed) — bounded by the 50MB file size cap,
// so this stays within acceptable memory usage for this project's scale.
function scanAndBuildBatches(filePath, sourceColumn, batchSize) {
  return new Promise((resolve, reject) => {
    let count = 0;
    const uniqueValues = new Set();
    const batches = [];
    let currentBatch = [];

    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on("data", (row) => {
        count++;
        if (sourceColumn && row[sourceColumn]) {
          uniqueValues.add(row[sourceColumn].trim());
        }
        currentBatch.push(row);
        if (currentBatch.length === batchSize) {
          batches.push(currentBatch);
          currentBatch = [];
        }
      })
      .on("end", () => {
        if (currentBatch.length > 0) batches.push(currentBatch);
        resolve({
          totalRows: count,
          uniqueSourceValues: [...uniqueValues],
          batches,
        });
      })
      .on("error", reject);
  });
}

// Applies the AI-inferred mapping to one raw row using plain JS —
// no AI call happens here, this is pure lookup/transform logic.
function applyMapping(row, mapping) {
  const getValue = (fieldMapping) => {
    if (!fieldMapping || !fieldMapping.source) return null;
    if (Array.isArray(fieldMapping.source)) {
      const parts = fieldMapping.source.map((col) => row[col]).filter(Boolean);
      if (parts.length === 0) return null;
      return parts.join(
        fieldMapping.combine === "concat_with_comma" ? ", " : " ",
      );
    }
    return row[fieldMapping.source] || null;
  };

  const extraNotes = [];

  const rawEmail = getValue(mapping.email);
  const { first: email, rest: extraEmails } = splitFirstAndRest(
    rawEmail,
    /[/,;]/,
  );
  if (extraEmails.length)
    extraNotes.push(`Additional email(s): ${extraEmails.join(", ")}`);

  const rawPhone = getValue(mapping.phone_raw);
  const { first: firstPhone, rest: extraPhones } = splitFirstAndRest(
    rawPhone,
    /[/,;]/,
  );
  if (extraPhones.length)
    extraNotes.push(`Additional phone(s): ${extraPhones.join(", ")}`);
  const { countryCode, mobile } = splitPhone(firstPhone);

  const crmNote =
    [getValue(mapping.crm_note), ...extraNotes].filter(Boolean).join(" | ") ||
    null;

  return {
    name: getValue(mapping.name),
    email,
    country_code: countryCode,
    mobile_without_country_code: mobile,
    company: getValue(mapping.company),
    city: getValue(mapping.city),
    state: getValue(mapping.state),
    country: getValue(mapping.country),
    lead_owner: getValue(mapping.lead_owner),
    crm_note: crmNote,
    created_at: getValue(mapping.created_at),
    possession_time: getValue(mapping.possession_time),
    description: getValue(mapping.description),
    _rawSourceValue: getValue(mapping.data_source_column), // resolved to enum later, not saved to CRM record directly
  };
}

// "first@x.com / second@x.com" -> { first: "first@x.com", rest: ["second@x.com"] }
// Per the assignment rule: use the first, append remaining to crm_note.
function splitFirstAndRest(rawValue, splitPattern) {
  if (!rawValue) return { first: null, rest: [] };
  const parts = rawValue
    .split(splitPattern)
    .map((s) => s.trim())
    .filter(Boolean);
  return { first: parts[0] || null, rest: parts.slice(1) };
}

// Heuristic phone splitter — this project's sample data is India-only
// (+91), so this assumes a 2-digit country code prefixed with "+" when
// present, defaulting to "+91" otherwise. A more general version would
// need a proper phone-number library (e.g. libphonenumber) for other
// countries — noted as a limitation, not solved here.
function splitPhone(rawPhone) {
  if (!rawPhone) return { countryCode: null, mobile: null };
  const digitsOnly = rawPhone.replace(/[^\d+]/g, "");
  const match = digitsOnly.match(/^\+?(\d{1,3})(\d{10})$/);
  if (match) return { countryCode: `+${match[1]}`, mobile: match[2] };
  if (/^\d{10}$/.test(digitsOnly))
    return { countryCode: "+91", mobile: digitsOnly };
  return { countryCode: null, mobile: digitsOnly || null };
}

// Processes one batch: applies mapping, calls AI for crm_status, validates,
// saves, and atomically updates job progress.
//
// Uses $inc instead of computing an absolute value and writing it back —
// this is REQUIRED now that batches run concurrently (BATCH_CONCURRENCY
// batches in flight at once via p-limit). A read-then-write pattern would
// race: two batches could both read the same stale count before either
// writes, and the slower one would silently overwrite the faster one's
// progress. $inc has no separate read step in application code — the
// increment happens atomically inside MongoDB itself, so arrival order
// never matters and the running total can never go backward.
// See README section 8 for the full worked example of this race.
async function processBatch(jobId, batch, mapping, sourceLookup) {
  const mappedRows = batch.map((row) => ({
    raw: row,
    mapped: applyMapping(row, mapping),
  }));

  // AI Call #3 — once per batch, only for the genuinely per-row field
  const notesTexts = mappedRows.map((r) => r.mapped.crm_note || "");
  const statuses = await classifyBatchStatus(notesTexts);

  let imported = 0;
  let skipped = 0;

  const records = mappedRows.map(({ raw, mapped }, i) => {
    const dataSource = mapped._rawSourceValue
      ? (sourceLookup[mapped._rawSourceValue] ?? null)
      : null;

    const hasEmail = Boolean(mapped.email);
    const hasPhone = Boolean(mapped.mobile_without_country_code);

    if (!hasEmail && !hasPhone) {
      skipped++;
      return {
        job: jobId,
        rawRow: raw,
        status: "skipped",
        skipReason: "No email or mobile number present",
        crmRecord: null,
      };
    }

    const candidateRecord = {
      ...mapped,
      data_source: dataSource,
      // statuses[i] can legitimately be '' (AI had no confident
      // classification) — must convert to null here, since crmRecordSchema
      // accepts the 4 enum values or null, but not ''. Using `||` instead
      // of `??` specifically because `??` only replaces null/undefined,
      // not an empty string, which was silently causing valid rows (with
      // real email/phone) to fail validation and get skipped — found via
      // live testing where "Failed CRM record validation" showed up on
      // rows that clearly had both contact fields present.
      crm_status: statuses[i] || null,
    };
    delete candidateRecord._rawSourceValue;

    const validation = crmRecordSchema.safeParse(candidateRecord);
    if (!validation.success) {
      skipped++;
      return {
        job: jobId,
        rawRow: raw,
        status: "skipped",
        skipReason: "Failed CRM record validation",
        crmRecord: null,
      };
    }

    imported++;
    return {
      job: jobId,
      rawRow: raw,
      status: "imported",
      crmRecord: validation.data,
    };
  });

  await ImportRecord.insertMany(records);

  // Atomic increment — see comment above the function for why this is
  // required now, not just a nice-to-have.
  await ImportJob.findByIdAndUpdate(jobId, {
    $inc: {
      processedRows: batch.length,
      importedCount: imported,
      skippedCount: skipped,
    },
  });

  return { imported, skipped };
}
