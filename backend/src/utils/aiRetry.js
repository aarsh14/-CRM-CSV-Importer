import { logger } from "./logger.js";

/**
 * Wraps a Gemini API call with retry logic for rate-limit errors.
 *
 * This exists because even strictly SEQUENTIAL processing (no p-limit,
 * no concurrency) can exceed Gemini's free-tier RPM (requests-per-minute)
 * limit if individual calls are fast enough — confirmed by a real 429
 * during testing at row 280/2000, with the RPM chart showing 16/15.
 * This is a distinct problem from the daily RPD quota hit earlier, and
 * needed regardless of whether concurrency is ever added (sub-phase 4b).
 *
 * @param {() => Promise<any>} fn - the API call to attempt, wrapped in a function
 * @param {string} label - for logging, e.g. "status classification batch"
 * @param {number} maxRetries
 */
export async function callWithRetry(fn, label, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimited =
        err.message?.includes("RESOURCE_EXHAUSTED") ||
        err.message?.includes("429");

      if (!isRateLimited || attempt === maxRetries) {
        throw err; // not a rate-limit error, or out of retries — let it propagate
      }

      // Gemini's error response includes its own suggested wait time
      // (e.g. "Please retry in 4.95s") — honor that if present, otherwise
      // fall back to exponential backoff (2s, 4s, 8s...).
      const suggestedDelayMatch = err.message?.match(/retry in ([\d.]+)s/i);
      const waitMs = suggestedDelayMatch
        ? Math.ceil(parseFloat(suggestedDelayMatch[1]) * 1000) + 500 // small buffer
        : 2 ** attempt * 1000;

      logger.warn("Rate limited, retrying after delay", {
        label,
        attempt,
        waitMs,
      });

      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}
