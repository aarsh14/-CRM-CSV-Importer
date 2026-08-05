# AI CSV Lead Importer — Full Project Documentation

An AI-powered CSV importer that maps arbitrary CRM lead exports (Facebook Ads,
Google Ads, real estate CRMs, manual spreadsheets) into a fixed GrowEasy CRM
schema, using an LLM for field mapping instead of hardcoded column rules.

Built as a learning project to understand real-world system design —
streaming file processing, async job queues, auth, AI prompt engineering,
and concurrency-safe database writes — not just a CRUD app. Built at a
deliberately slower pace than the original 5-day assignment deadline, since
the goal is depth of understanding over speed of submission.

---

## Table of contents

1. Tech stack and why each piece was chosen
2. Full architecture, end to end
3. Frontend — every file and its job
4. Backend — every file and its job
5. Auth system — complete flow, file to file
6. What determines CSV processing time
7. Bugs hit and fixed along the way
8. The concurrency race condition (read-modify-write vs `$inc`)
9. Current build status — what's real vs. placeholder
10. Phase 4 plan (revised — hybrid schema-mapping architecture)
    - 10a. AI batch size — a separate, tunable dial
    - 10b. Build order — sequential correctness first, concurrency second
11. Best practices discussed but deliberately deferred

---

## 1. Tech stack and why each piece was chosen

| Piece                  | Choice                                          | Why                                                                                                                                                           |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend               | React (Vite) + plain JS                         | Chose React over Next.js since backend fundamentals were already known; plain JS first, TypeScript planned as a second pass later once the whole system works |
| Backend                | Node + Express + plain JS                       | Matches the assignment's suggested stack; JS avoids stacking too many new concepts (React + streaming + AI + TS) at once                                      |
| Database               | MongoDB Atlas (free tier)                       | Already familiar; free M0 cluster (512MB) holds roughly 350,000 records at ~1-1.5KB each — enough for a learning project's test imports                       |
| File upload            | Multer (disk storage)                           | Writes uploads to a temp folder rather than holding the whole file in RAM                                                                                     |
| CSV parsing (frontend) | papaparse, `preview: 200`                       | Only reads the first 200 rows for the preview regardless of file size — keeps the browser fast and memory-flat even for huge files                            |
| CSV parsing (backend)  | csv-parser (streaming)                          | Reads the uploaded file row-by-row off disk, never loads the whole file into memory at once                                                                   |
| Auth                   | JWT in httpOnly cookies                         | Already familiar with JWT; httpOnly prevents JS from reading the token, mitigating XSS token theft                                                            |
| Validation             | Zod                                             | Runtime validation — critical because TypeScript alone can't catch bad data at runtime, which matters most once AI output needs checking                      |
| Job processing         | Simple MongoDB polling worker (no Redis/BullMQ) | Free, simpler, sufficient at this scale; documented below as "would upgrade to Redis+BullMQ at real scale"                                                    |
| HTTP client            | axios (swapped from fetch)                      | Automatic JSON parsing, automatic error-throwing on bad status codes, built-in `onUploadProgress` support                                                     |

---

## 2. Full architecture, end to end

```
Browser (React)
  → UploadStep: drag/drop or file picker, papaparse preview:200
    (first 200 rows only, instant regardless of file size, worker:true
    keeps it off the main thread)
  → PreviewStep: shows preview table, no network call yet
  → on Confirm: uploads the FULL raw file (not just the preview) via
    multipart/form-data, with onUploadProgress tracked separately from
    server-processing progress

Backend (Express)
  → Auth-gated: requireAuth middleware checks JWT cookie
  → Multer receives file, writes to temp-uploads/ (disk, not RAM)
  → Creates an ImportJob (status: pending), responds immediately with { jobId }
  → Background (not awaited by the request):
      - Pre-count pass: streams the file once just counting rows → sets totalRows
      - Main pass: streams the file again, batches 20 rows at a time
      - Each batch → currently a REGEX PLACEHOLDER (Phase 4 replaces with real AI)
      - Saves one ImportRecord per row (imported or skipped)
      - Updates ImportJob.processedRows after each batch
      - On finish: status → completed, deletes the temp file (in a finally
        block, so cleanup happens even on failure)

Frontend polls GET /api/jobs/:id every 500ms until status is completed,
then shows results
```

**Why two passes over the file (pre-count + real processing):** streaming
means we don't know the total row count in advance. Without a pre-count
pass, `totalRows` would stay 0 in the database for the entire run, and the
frontend would have nothing to calculate a percentage against — this was
an actual bug we hit and fixed (see section 7).

**Why upload progress and processing progress are tracked separately:**
uploading a file (bytes traveling browser → server) and processing it
(server streaming/batching/mapping rows) are two genuinely different
waits, bound by two different bottlenecks — the user's network speed for
the former, server/AI latency for the latter. The async job-queue pattern
only ever addressed the second one; the first has no backend-side fix,
since it's just physical data transfer time.

---

## 3. Frontend — every file and its job

**`main.jsx`** — entry point, mounts `App` into the DOM. Untouched boilerplate.

**`App.jsx`** — the orchestrator / state machine. Holds:

- `authStatus` (`checking` → `authenticated`/`unauthenticated`), checked on
  load via `GET /api/auth/me`
- `step` (`upload` → `preview` → `progress` → `results`)
- `fileData`, `jobId`, `uploadPercent`, `results`, error states

Renders Login/Signup if not authenticated; otherwise renders the 4-step
flow plus a top bar showing the user's email and a logout button.

**`components/Login.jsx` / `Signup.jsx`** — forms calling the auth API.
Added after discovering the app had no way to actually log in from the
browser — it had only ever been tested via curl/Postman directly against
the backend.

**`components/UploadStep.jsx`** — drag & drop + file picker. Uses papaparse
with `preview: 200` + `worker: true` (parses on a background thread so
even reading 200 rows doesn't block the UI). Passes the **original full
File object** up to the parent, not just the preview data, since the full
file is what eventually gets uploaded.

**`components/PreviewStep.jsx`** — generic table; columns are derived from
whatever `fields` papaparse detected, not hardcoded — this is what makes
it work for any CSV layout. Sticky header, scrollable. Shows upload errors
if the confirm step's upload call fails.

**`components/ProgressStep.jsx`** — two distinct phases:

- Phase A "Uploading": tracks `uploadPercent` via axios's
  `onUploadProgress` (bytes transferred, browser → server). No `jobId`
  exists yet during this phase.
- Phase B "Processing": tracks `processedRows/totalRows` via
  `useJobPolling` (server-side row processing), once `jobId` is set.

**`components/ResultsStep.jsx`** — shows imported/skipped counts and
tables. Had to be rewritten once real backend data arrived, since it
originally expected flat CSV rows (matching a `fields` prop) but the real
API returns full `ImportRecord` documents (`{ rawRow, crmRecord,
skipReason }`) — columns are now derived from `rawRow`'s own keys.

**`hooks/useJobPolling.js`** — polls `GET /api/jobs/:id` on an interval
(currently 500ms, tightened from an initial 2000ms default — see section 7
for why). Stops polling once status is `completed` or `failed`.

**`api/client.js`** — axios instance (`withCredentials: true` so cookies
are sent automatically) plus `signup`, `login`, `logout`, `getCurrentUser`,
`uploadCsvFile` (with a progress callback), `fetchJobStatus`.

**`App.css`** — design system: teal accent color, Space Grotesk (headings)

- Inter (body) + JetBrains Mono (data tables), all defined as CSS
  variables so the palette/fonts only need to change in one place.

---

## 4. Backend — every file and its job

**`server.js`** — entry point: loads env vars, connects to MongoDB, starts
the Express server.

**`src/app.js`** — Express setup: CORS (configured with `credentials:
true` so cross-origin cookies work), JSON body parsing, cookie parsing,
mounts all routes under `/api`, registers error handling last.

**`src/config/db.js`** — MongoDB connection via Mongoose; exits the
process if the connection fails, since there's no point running a
database-dependent server without one.

**`src/schemas/crmRecordSchema.js`** — the single source of truth for CRM
enums (`CRM_STATUS_VALUES`, `DATA_SOURCE_VALUES`) and the Zod schema that
will validate AI output in Phase 4. Both the Mongoose model and the future
AI-output validator import from here, so the two can never drift out of
sync with each other.

**`src/models/User.js`** — email + bcrypt password hash.

**`src/models/ImportJob.js`** — one document per upload/file: status,
totalRows, processedRows, importedCount, skippedCount, errorMessage.
Represents the _whole operation's_ progress.

**`src/models/ImportRecord.js`** — one document per CSV row: rawRow
(untouched original data, kept for debugging/auditing), status
(imported/skipped), skipReason, crmRecord (the AI-mapped output).
References the shared enum lists from `crmRecordSchema.js`.

_Why split into two models instead of one:_ a job's status changes over
time as a whole ("40% done"); each record's outcome is decided once and
doesn't change afterward. This mirrors how most real bulk-processing
systems (bank statement imports, bulk email sends, payroll runs) separate
"the operation" from "each line item within it," and it means the
frequently-polled progress endpoint only ever needs to read one small
document, not thousands of row-level ones.

**`src/controllers/authController.js`** — `signup` (bcrypt hash + issues a
JWT cookie), `login` (bcrypt compare + issues a JWT cookie), `logout`
(clears the cookie), `getMe` (looks up and returns `{ id, email }` for
the currently authenticated user).

**`src/controllers/importController.js`** — `uploadImport` (creates the
job, responds immediately with `{ jobId }`, then fires off background
processing without awaiting it), `getJobStatus` (looks up the job scoped
to `req.userId` so users can't see each other's jobs; only fetches the
full row-level records once the job is `completed`).

**`src/services/csvStreamService.js`** — the core pipeline: pre-count
pass, streaming batch processing, progress updates, temp file cleanup.
Currently uses a **regex placeholder** (skip if no `@` and no 6+ digit
number found anywhere in the row) instead of real AI — this was
deliberate, to prove the pipeline mechanics work in isolation before
adding AI complexity on top (see sections 9 and 10).

**`src/middleware/authMiddleware.js`** — `requireAuth`: reads the JWT
cookie, verifies its signature and expiry, attaches `req.userId` for
downstream use, or returns 401 if missing/invalid.

**`src/middleware/errorHandler.js`** — centralized error formatting:
Mongoose validation errors, duplicate key errors, Multer file-size (413)
and file-type (400) errors, server disk-full `ENOSPC` (507), and a
generic fallback (500) that never leaks internal error details.

**`src/routes/`** — `authRoutes.js`, `importRoutes.js` (Multer configured
with a 50MB cap and `.csv`-only filter), `index.js` (mounts both under
`/api` — see the route-stacking note below).

**`src/utils/logger.js`** — simple structured JSON console logging.

### How route paths actually stack up

Express routers only define paths _relative to where they're mounted_ —
the full URL is built by concatenating every `.use()` prefix a request
passes through:

```
app.js:          app.use('/api', routes)
routes/index.js: router.use('/auth', authRoutes)
authRoutes.js:   router.post('/signup', signup)

Final path: /api + /auth + /signup = /api/auth/signup
```

This is why `authRoutes.js` never needs to know it'll eventually live
under `/api/auth` — routing decisions are separated from route
definitions, so e.g. adding API versioning later only requires changing
one line in `app.js`, not touching every route file.

### Default exports vs. named exports (a real point of confusion hit while building this)

`authRoutes.js` ends with `export default router;` — this is why
`import authRoutes from './authRoutes.js'` works even though nothing in
that file is literally named `authRoutes`. Default exports can be
imported under **any name the importing file chooses**, unlike named
exports (`export { signup, login }`), which must be imported using their
exact original names wrapped in curly braces. `authController.js` uses
named exports (multiple distinct functions to pull out by name);
`authRoutes.js` uses a default export (only one thing to export: the
fully configured router).

---

## 5. Auth system — complete flow, file to file

### Signup

1. `Signup.jsx` calls `signup(email, password)` from `client.js`
2. `client.js` → `POST /api/auth/signup`
3. `authRoutes.js` routes to the `signup` controller
4. `authController.js`: checks `User.js` model for an existing email →
   `bcrypt.hash(password, 10)` (never stores the raw password) →
   `User.create(...)` → `jwt.sign({ userId }, JWT_SECRET, { expiresIn:
'7d' })` → `res.cookie(...)` with `httpOnly: true` (JS on the browser
   can never read this cookie directly, mitigating XSS token theft) →
   responds with `{ id, email }` (never the raw token itself)
5. `App.jsx`'s `handleAuthSuccess` flips `authStatus` to `authenticated`

### Login

Same shape as signup, minus account creation: `bcrypt.compare(...)`
against the stored hash, deliberately identical error message ("Invalid
email or password") whether the email doesn't exist or the password is
wrong — prevents user enumeration attacks.

### Checking "am I already logged in?" (on every page load)

1. `App.jsx`, on mount: calls `getCurrentUser()` → `GET /api/auth/me`
2. Because `withCredentials: true` is set, the browser automatically
   attaches the httpOnly cookie — no manual token handling anywhere in
   frontend code
3. `authRoutes.js`: `requireAuth` middleware runs _before_ `getMe`
4. `authMiddleware.js`: reads `req.cookies.token` (only populated because
   `cookie-parser` middleware already parsed it earlier in `app.js`),
   verifies it with `jwt.verify`, attaches `req.userId`, calls `next()`
   — or returns 401 if missing/invalid/expired
5. `authController.js`'s `getMe`: looks up the user by `req.userId`,
   returns `{ id, email }`
6. `App.jsx`: success → `authenticated`; failure → `unauthenticated`,
   Login screen renders

_Note: a 401 on `/api/auth/me` every time the page loads while logged out
is expected, correct behavior — not a bug._

### Logout

`res.clearCookie(...)` — must use the exact same options (`httpOnly`,
`sameSite`, etc.) used when the cookie was originally set, or the browser
won't recognize it as the same cookie to clear. That's why `COOKIE_OPTIONS`
is a single shared constant reused across signup/login/logout.

### Why any of this matters for the actual CSV import feature

`requireAuth` populates `req.userId`, which `uploadImport` uses to create
`ImportJob({ user: req.userId, ... })` — this is what lets `getJobStatus`
correctly filter `{ _id: jobId, user: req.userId }`, preventing one user
from viewing another user's import jobs by guessing/incrementing an ID.

---

## 6. What determines CSV processing time

Ranked by actual impact, given the current architecture:

1. **(Phase 4, will dominate)** AI API latency × number of batches ÷
   concurrency level — once real AI calls replace the placeholder, this
   will outweigh everything else below combined
2. Number of rows (linear driver of everything else)
3. Batch size (`BATCH_SIZE = 20`) — fewer, bigger batches means fewer
   round trips but larger payloads per call
4. MongoDB round-trip latency — region distance between server and Atlas
   cluster, plus free tier's shared/lower-powered infrastructure
5. Whether batches run sequentially (current) or concurrently (Phase 4
   plan, via `p-limit`)
6. The redundant pre-count pass — reads the file twice; negligible for
   small/medium files, more noticeable on very large ones
7. Server's own CPU/RAM allocation (Render free tier: 512MB RAM, 0.1 CPU)

With the current placeholder regex logic, processing a 2,000-row file
takes a few seconds — mostly factors 2-7. Once Phase 4 adds real AI calls,
factor 1 will dominate by an order of magnitude, which is exactly why
concurrency and retry logic aren't optional polish — they're what keeps
processing time reasonable once genuine AI latency is in the loop.

---

## 7. Bugs hit and fixed along the way

1. **`Cannot POST /signup`** — wrong URL; missing the `/api/auth` prefix
   from route stacking (see section 4).

2. **Progress bar stuck at "0 of ?"** — `totalRows` was only ever written
   to the database _after_ the job finished, so the frontend had nothing
   to calculate a percentage against during the run. Fixed with a
   pre-count streaming pass before the real processing pass begins.

3. **`OverwriteModelError: Cannot overwrite ImportJob model once
compiled`** — Windows-specific bug. `importJob.js` and `ImportJob.js`
   are the same file on Windows' case-insensitive filesystem, but Node's
   ES module loader treats differently-cased import paths as separate
   modules — causing the file (and its `mongoose.model(...)` call) to run
   twice, which Mongoose rejects. Fixed by making every import match the
   actual filename casing exactly.

4. **`401 Unauthorized` on upload, with no way to log in** — there was no
   frontend login UI at all; the app had only been tested via curl.
   Fixed by building real `Login`/`Signup` components and gating the
   whole app behind an auth check on load, rather than temporarily
   removing auth from the import routes as a workaround.

5. **Wrong `VITE_API_BASE_URL`** — `.env` had the frontend's own port
   (5173) instead of the backend's port (4000), so API calls were
   silently resolving to the frontend's own dev server and 404ing.

6. **Progress bar "0 → jump straight to results," even after the
   totalRows fix** — for tiny test files (5-10 rows), the entire job
   (pre-count + processing) finishes faster than the polling interval, so
   no poll ever lands mid-progress. Not a bug in the traditional sense —
   mitigated by polling every 500ms instead of 2000ms, and confirmed by
   testing against a 2,000-row synthetic CSV where the bar visibly moves.

7. **Missing feedback during file upload transfer itself** — originally,
   the UI sat silently until the _entire_ file finished uploading, then
   jumped straight to a processing progress bar — looked broken on a
   slow connection with a large file. Fixed by tracking upload progress
   (`onUploadProgress`) and processing progress (`useJobPolling`) as two
   separate, sequential phases in `ProgressStep.jsx`.

---

## 8. The concurrency race condition (read-modify-write vs `$inc`)

**Not yet present in the codebase** — this is a bug that would appear the
moment Phase 4 introduces concurrent batch processing (via `p-limit`),
caught and designed around _before_ writing that code, rather than
discovered after shipping it.

### The problem, concretely

If two batches run concurrently and each does "read current count →
add my amount → write the new total back," both can read the _same_
stale value before either has written anything:

```
DB starts at: importedCount = 20

Batch 1 reads 20, calculates 20 + 15 = 35
Batch 2 reads 20 (before Batch 1 has written anything), calculates 20 + 18 = 38

Batch 1 writes 35
Batch 2 writes 38   <- overwrites Batch 1's work entirely

Final value: 38
Correct value should have been: 20 + 15 + 18 = 53
```

This is a genuine, classic read-modify-write race condition — it doesn't
matter how "fast" either batch is; the bug is structural, caused by the
gap in time between reading a value and writing a new one back, during
which another operation can read the same now-stale value.

### The fix — MongoDB's atomic `$inc`

```javascript
// Unsafe under concurrency (current code — only safe because
// processing is still sequential, not concurrent, today):
await ImportJob.findByIdAndUpdate(jobId, {
  processedRows,
  importedCount,
  skippedCount, // absolute values computed in JS
});

// Safe under concurrency (the Phase 4 fix):
await ImportJob.findByIdAndUpdate(jobId, {
  $inc: {
    processedRows: batch.length,
    importedCount: imported,
    skippedCount: skipped,
  },
});
```

`$inc` has no separate "read" step in application code at all — the
entire "read current value, add, write result" sequence happens as one
atomic, indivisible operation _inside MongoDB's storage engine_. Two
concurrent `$inc` calls never truly execute simultaneously at the storage
level; they're queued and applied one after another, each seeing the
true latest value left by whichever one ran just before it. Addition is
commutative, so the arrival order never matters and the running total
can never go backward or get silently overwritten.

### Why the current code is safe today, but won't be after Phase 4

Right now, batches are processed strictly sequentially (one `for await`
loop, each batch fully awaited before the next begins) — so there's
never actually two writes in flight at once, and the read-modify-write
pattern happens to be safe purely because concurrency doesn't exist yet.
The moment `p-limit` is introduced to run multiple batches simultaneously,
this stops being true — so switching to `$inc` is not a separate task,
it's simply part of correctly implementing concurrent batching in the
first place.

---

## 9. Current build status — what's real vs. placeholder

**Fully real and working:**

- Auth (signup/login/logout/session persistence via httpOnly JWT cookie)
- File upload with real two-phase progress tracking (upload transfer +
  server processing, tracked separately)
- Streaming CSV parsing (frontend preview-only via papaparse, backend
  full-file streaming via csv-parser)
- Job creation, background processing, live polling, results display
- The "skip if truly no contact info anywhere in the row" rule (crude
  regex version)

**Explicitly placeholder, waiting for Phase 4:**

- `crmRecord` is just `{ description: 'Pending AI mapping (Phase 4)' }` —
  no real field mapping happens yet
- The skip rule is a rough regex (`@` symbol or 6+ digit number anywhere
  in the row), not the precise "no email column AND no phone column"
  logic from the assignment spec
- No `crm_status` or `data_source` enum assignment
- No multi-email/multi-phone handling (append extras to `crm_note`)
- No date format normalization
- Batches are processed sequentially — no concurrency, no `$inc` yet
  (not needed until concurrency is introduced)

---

## 10. Phase 4 plan (revised — hybrid schema-mapping architecture)

### Why the original "send every batch to AI for everything" plan was wrong

The initial plan was to send each 20-row batch to AI and ask it to map
every field for every row. This has a real, serious flaw once you think
about _why_ CSV mapping is hard: most of the assignment's CRM fields
(`name`, `email`, `mobile_without_country_code`, `company`, `city`,
`state`, `country`, `lead_owner`) are **structural** — a given CSV
column means the same thing for every row in that file. "Full Name"
maps to `name` on row 1 the same way it does on row 5,000. Asking AI to
re-derive that mapping on every single batch is:

- **Wasteful** — for a 100,000-row file at batch size 20, that's 5,000
  redundant AI calls all answering the same underlying question
- **Risky for consistency** — nothing guarantees batch 1's AI call and
  batch 200's AI call map the same ambiguous column the same way;
  "Primary Contact" could be classified as `email` in one batch and
  `phone` in another, silently corrupting data within a single import

### The corrected insight: separate "map the schema once" from "classify per-row content"

Not every CRM field has the same nature. Splitting them by what kind of
problem each one actually is:

| Field type                          | Example fields                                                                              | Nature of the problem                                                                                                                          | How often AI needs to run                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Structural (column-level)**       | name, email, mobile, company, city, state, country, lead_owner, created_at, possession_time | "Which CSV column holds this?" — same answer for every row in the file                                                                         | **Once per file**                                              |
| **Value-level (small cardinality)** | data_source                                                                                 | "Which of 5 fixed enums does this specific string match?" — but the _set of distinct strings_ in a file is usually tiny (a few, not thousands) | **Once per file**, on the deduplicated unique values only      |
| **Semantic (row-level)**            | crm_status                                                                                  | "What does this specific row's free-text notes actually mean?" — genuinely different for every row, no fixed lookup possible                   | **Once per batch** (the only piece that can't be pre-resolved) |

This gives three distinct AI touchpoints instead of one repeated one —
each called at the frequency that actually matches the nature of the
problem it's solving, rather than treating every field as if it needed
fresh per-row judgment.

### The full flow, start to finish

1. User uploads CSV (unchanged — auth, upload, `ImportJob` created, job
   ID returned immediately, background processing begins)
2. **NEW:** read just the header row plus a small sample of rows (5-10),
   not the full file yet
3. **NEW — AI Call #1 (once per file): column mapping.** Send the
   headers, the sample rows (so ambiguous headers like "Primary Contact"
   can be disambiguated by looking at actual sample values — an
   email-shaped string vs. a phone-shaped string), and the fixed CRM
   field list. AI returns a structured mapping (ideally with a confidence
   score per field) — which column holds `name`, `email`, `mobile`,
   which column holds free-text notes, which holds the source/campaign
   name, etc.
4. **NEW — validate the mapping, two ways:** (a) structural validation
   via Zod — did AI return the expected shape, not a prose explanation
   or malformed JSON; (b) sanity validation — does every column name AI
   claims to have mapped actually exist in the real CSV headers (guards
   against a hallucinated but plausible-sounding column name)
5. **NEW — save the validated mapping onto the `ImportJob` document** —
   not just used and discarded. Enables debugging later ("why did
   'Contact' end up mapped to email?") and keeps each job's mapping
   independent, since two different CSVs in two different jobs may map
   the same target field from entirely different source columns
6. **NEW — AI Call #2 (once per file): source/campaign value lookup.**
   Using the column mapping from step 3, collect the **distinct** values
   in whichever column was mapped to "source" — a 2,000-row file might
   only have 5-10 unique campaign names, not 2,000. Send just this small,
   deduplicated list to AI once, asking it to match each to one of the 5
   fixed `data_source` enum values (or blank if no confident match). The
   result is a small lookup table: campaign string → enum value
7. Full streaming pass begins — unchanged from the existing pipeline:
   pre-count pass for `totalRows`, then the real pass, grouped into
   batches
8. **Per batch — apply the column mapping and source lookup using plain
   JavaScript, no AI call needed:** look up each CRM field's value using
   the saved mapping from step 3 (pure object lookups); look up the
   row's source/campaign string in the lookup table from step 6; split
   multiple emails/phones in a single cell via simple string/regex logic
   (not AI), keeping the first and appending the rest to `crm_note`;
   normalize the date format
9. **NEW — AI Call #3 (once per batch, the one genuinely per-row-content
   operation): classify `crm_status`.** Send this batch's free-text
   notes values in one call, get back a status classification for each,
   matching one of the 4 fixed enum values. This is the only field that
   can't be resolved by a one-time lookup, since it requires judging
   actual, different text content on every row
10. Validate each fully-assembled CRM record against the existing
    `crmRecordSchema.js` (Zod) before saving
11. Apply the real skip rule from the assignment — skip only if there's
    genuinely no email **and** no mobile after mapping — replacing
    today's crude regex placeholder
12. Save the batch (`ImportRecord.insertMany`), update progress
    (`ImportJob.processedRows`/`importedCount`/`skippedCount`), repeat
    for all batches
13. Mark the job completed, delete the temp file — unchanged
14. Frontend polls and displays results — **completely unchanged**, since
    `ResultsStep.jsx` already renders whatever `crmRecord` shape comes
    back

### Where the AI code lives

```
controllers/importController.js   → HTTP request/response only (unchanged)
services/csvStreamService.js      → streaming, batching, orchestration (unchanged responsibility)
services/csvMappingService.js     → NEW: AI calls #1 and #2 (schema + source-value mapping)
services/aiService.js             → NEW: AI call #3 (per-batch status classification) + retry/backoff logic
models/ImportJob.js               → gains a field to store the validated column mapping per job
models/ImportRecord.js            → unchanged
schemas/crmRecordSchema.js        → unchanged (still validates final CRM records)
schemas/mappingSchema.js          → NEW: Zod schema validating AI Call #1's structural output
```

`csvStreamService.js` calls into `csvMappingService.js` once at the start
of a job (steps 3-6), then calls into `aiService.js` once per batch
during the streaming pass (step 9) — the controller never talks to AI
directly, keeping HTTP concerns and AI concerns separated.

### AI call volume, for a 100,000-row file, batch size 20

Roughly `2 + (100,000 ÷ 20) = 5,002` calls total — but only the status
classification batches (5,000 of them) are doing genuine per-row work;
the other 2 calls resolve the column mapping and source lookup for the
_entire file_ in one shot each. This is a large reduction from the
original "map everything, every batch" design, but 5,000 calls for the
classification piece alone is still a meaningful number worth optimizing
further — see the batch-size tradeoffs below.

---

## 10a. AI batch size — a separate, tunable dial (not the same as DB batch size)

A natural instinct is to just increase the batch size to cut down the
number of AI calls — e.g., if `crm_status` classification happens once
per batch, using batches of 100 instead of 20 cuts 5,000 calls down to
1,000. This is a real, valid lever — but it is **not** a free win, and it
should not be assumed to be the same number as the database write batch
size.

**`DB_BATCH_SIZE` and `AI_STATUS_BATCH_SIZE` are two independent knobs:**

```
100 rows' worth of notes text
        ↓
1 AI classification call
        ↓
100 statuses returned
        ↓
split back into smaller DB write batches
        ↓
20 → insertMany
20 → insertMany
20 → insertMany
20 → insertMany
20 → insertMany
```

This decoupling gets the best of both: fewer, more efficient AI calls,
while still keeping MongoDB writes small, frequent, and progress-bar
updates smooth — rather than assuming one constant has to serve both
purposes, which is what a single shared `BATCH_SIZE` would silently
conflate.

**Concretely, for a 100,000-row file:**

```
AI batch 20  → 5,000 status calls
AI batch 100 → 1,000 status calls
AI batch 200 →   500 status calls
```

### Why bigger AI batches aren't automatically better — the real tradeoffs

1. **Per-call latency rises with batch size** — a call processing 100
   rows' worth of text takes meaningfully longer to respond than one
   processing 20 rows. Cutting call _count_ by 5x doesn't yield a 5x
   reduction in total wall-clock time, since each surviving call is
   individually slower.
2. **Failure blast radius grows** — if a 100-row batch's AI call fails
   (rate limit, timeout, malformed response) and needs a retry, that's
   100 rows of work being redone, versus 20.
3. **Structured JSON reliability degrades with larger outputs** — asking
   an LLM for correctly-shaped JSON covering 20 items is more reliable
   than asking for 100; longer outputs have a higher chance of subtly
   malformed JSON, truncation, or the model losing consistency partway
   through a long response.
4. **Output token limits are a hard ceiling** — push batch size too far
   and a response can get cut off mid-JSON, which is worse than a clean
   error, since a truncated response might partially parse before
   failing.
5. **Rate limits are often token-based, not just request-based** — a
   bigger batch doesn't necessarily dodge rate limits, since the total
   amount of text processed per minute is roughly similar either way.

**Conclusion:** the right AI batch size is something to tune empirically
against the actual model and actual notes-field length once Phase 4 is
running — a reasonable starting range for a structured classification
task like this is often in the 10-50 rows per call territory, but this
is a dial to test, not a number to maximize blindly.

---

## 10b. Build order within Phase 4 — sequential correctness first, concurrency second

Building all three AI operations _and_ `p-limit` concurrency _and_ `$inc`
atomic updates simultaneously would make debugging extremely difficult —
if something goes wrong (e.g. a wrong `crm_status`), there would be no
clean way to tell whether the cause is a bad prompt, malformed/truncated
structured output, a wrong column mapping, a race condition in concurrent
processing, or a silent rate-limit failure. That's five different bug
categories entangled together.

This mirrors a principle already applied once in this project: Phase 3
deliberately built the entire streaming/batching/job-tracking pipeline
with a crude regex placeholder _before_ touching AI at all, specifically
so that if something broke, it was clear whether the bug was in the
pipeline or the (not-yet-built) AI logic. Phase 4 applies the same
isolation principle one layer deeper.

**Sub-phase 4a — correctness first, strictly sequential, no concurrency:**

- Build AI Call #1 (column mapping), verify manually against real test
  CSVs that the mapping is actually correct
- Build AI Call #2 (source value lookup), verify against known campaign
  names in the test CSVs
- Build AI Call #3 (status classification), sequential batches, verify
  against known cases (e.g. "Not interested in our services" should
  classify as `BAD_LEAD`)
- Run the entire chain against all real test CSVs (Facebook Ads, Google
  Ads, real estate CRM, manual spreadsheet, 2,000-row synthetic file)
  with zero concurrency anywhere — confirm mapping, enum assignment,
  multi-email/phone handling, and skip behavior are all correct first

**Sub-phase 4b — performance, only after 4a is verified correct:**

- Introduce `p-limit` for the status-classification batches specifically
  (the only batches that repeat per file, so the only place concurrency
  meaningfully helps)
- Switch `processedRows`/`importedCount`/`skippedCount` writes to `$inc`
  at the same time, since this is exactly when the race condition
  described in section 8 becomes real rather than theoretical
- Re-test the same CSVs, now specifically checking for
  concurrency-introduced issues (progress bar correctness, no
  duplicate/missing records) — since AI-mapping correctness was already
  confirmed in 4a, any new bug at this stage is very likely
  concurrency-related, not AI-quality-related

**Deliberately not in Phase 4:** embeddings/vector similarity as a
_replacement_ for the source-value AI lookup (optional future
enhancement — see section 11); no frontend changes needed, since
`ResultsStep.jsx` already renders whatever `crmRecord` shape comes back.

---

**\*\***\*\*\***\*\***Understand CRM-Status**\*\*\*\***\*\*\***\*\*\*\***

Every other field is a "where does this value live" problem — crm_status is a "what does this text mean" problem
Every other field we handle with plain JavaScript is fundamentally a lookup:

name — copy whatever's in the mapped column
email — copy the mapped column, split on / if multiple
data_source — look up a string in a small pre-built table

All of these have one thing in common: once you know which column holds the answer, applying it to every row is mechanical. The column mapping AI call only needed to run once per file precisely because the relationship between columns and fields doesn't change row to row.
crm_status doesn't have this property. Look at real values from your own test data:
"Client is asking to reschedule demo" -> should be GOOD_LEAD_FOLLOW_UP
"Person was busy, will try again next week" -> should be DID_NOT_CONNECT
"Not interested in our services" -> should be BAD_LEAD
"Deal closed, onboarding in progress" -> should be SALE_DONE
There's no column to point at here — the answer isn't sitting in a specific place, it's encoded in the meaning of free-form English text, and that meaning is genuinely different for every single row. Row 1's notes and row 500's notes say completely different things; there's no fixed lookup table that could contain "the answer" the way sourceLookup does, because the number of possible sentences is effectively infinite, unlike the handful of distinct campaign names in data_source.
Why plain JavaScript genuinely can't do this
You could imagine trying keyword matching instead of AI — e.g., if (note.includes("not interested")) return "BAD_LEAD". This breaks almost immediately in practice:

"Not interested right now, but call back next quarter" — contains "not interested" but is actually closer to DID_NOT_CONNECT or even GOOD_LEAD_FOLLOW_UP
"Client said he's definitely NOT going to walk away from this deal" — contains "not" near negative-sounding words but means the opposite
Sarcasm, negation, context, and phrasing variety break simple keyword rules constantly — this is genuinely the kind of task language models exist to solve, because it requires actual language understanding, not pattern matching on specific words

This is the real distinction between structural/value-level fields (solvable by lookup, because the space of possible values is small and fixed) and semantic fields (require judgment on open-ended text, because the space of possible sentences is unbounded).

## 11. Best practices discussed but deliberately deferred

### Storage & data retention

- **Current approach:** `ImportRecord` stores both `rawRow` and
  `crmRecord` for every row, forever.
- **Why it's fine for now:** at ~1-1.5KB per record, the 512MB free tier
  holds roughly 350,000 records — far more than this project's test
  imports will produce.
- **What a production version should add:** TTL indexes to auto-delete
  old completed jobs after N days; consider only storing full `rawRow`
  for skipped records (needed for debugging) and dropping/minimizing it
  for successfully imported ones, to cut storage roughly in half at
  scale; at real scale, archive historical data to cheaper object storage
  (S3) instead of the primary database.

### Job processing

- **Current approach:** simple MongoDB-based polling worker loop, no
  Redis.
- **What a production version should add:** BullMQ + Redis once
  throughput/concurrency needs exceed what a single polling loop can
  handle reliably (retries, dead-letter queues, priority).

### File handling

- **Current approach:** raw uploaded file written to a temp local disk
  folder (`temp-uploads/`), streamed row-by-row, then deleted in a
  `finally` block regardless of success or failure.
- **What a production version should add:** for multi-instance
  deployments, temp storage would need to be shared (e.g. S3) rather than
  local disk, since a file uploaded to one server instance isn't visible
  to another.

### Server disk space (upload writes)

- **Current approach:** `errorHandler.js` catches `ENOSPC` (server disk
  full while writing an uploaded file) and returns a clear `507
Insufficient Storage` instead of a generic 500.
- **Why unlikely to trigger in practice:** the 50MB file cap plus
  immediate cleanup after every job (success or failure) means
  `temp-uploads/` shouldn't accumulate leftover files under normal
  operation.
- **What a production version would add:** disk space monitoring/
  alerting, a periodic sweep of `temp-uploads/` for anything older than
  an hour (a safety net in case a crash skips the `finally` cleanup), and
  eventually direct-to-S3 uploads to remove server disk from the equation
  entirely.

### Large file limits

- **Current approach:** Multer caps uploads at 50MB; anything larger is
  rejected immediately with a clear `413`.
- **Why this specific cap:** the real ceiling in this stack isn't
  processing (streaming keeps memory flat regardless of file size) —
  it's MongoDB Atlas's 512MB free tier. A single very large CSV could
  produce enough `ImportRecord` documents to exceed the entire free
  tier's storage on its own.
- **What a production version handling genuinely large files would add:**
  direct-to-cloud-storage uploads (browser → S3 via a pre-signed URL,
  bypassing the app server for the transfer itself); resumable/chunked
  uploads (e.g. the `tus` protocol); a row-count cap per job; a paid
  database tier at real scale.

### Field mapping for `data_source`

- **Current approach (Phase 4):** rather than classifying every row, the
  distinct/deduplicated source values in a file (usually a handful, not
  thousands) are sent to the LLM **once per file** to build a lookup
  table, which is then applied to every row via plain JavaScript — see
  section 10, AI Call #2. This avoids both per-row AI cost and the risk
  of the same value being classified inconsistently across different
  batches.
- **Possible further optional enhancement:** pre-compute embeddings for
  the 5 allowed enum values once, embed each distinct incoming source
  string, and use cosine similarity with a threshold as an even cheaper,
  fully deterministic pre-filter — only falling back to the LLM lookup
  for genuinely ambiguous values. Not implemented because the AI-based
  deduplicated lookup already solves the redundant-work problem; this
  would only shave the remaining, already-small number of calls further.
- **Explicitly rejected:** a full RAG pipeline / vector database. There's
  no external knowledge corpus being retrieved from in this project — the
  AI task is structured extraction and small-scale classification from
  data already in the prompt, not knowledge retrieval. Adding
  Pinecone/Weaviate/pgvector here would be complexity for its own sake.

### Type safety

- **Current approach:** plain JavaScript throughout, with Zod for runtime
  validation at API/AI boundaries.
- **Why:** learning React, streaming, job queues, and AI integration
  simultaneously is already a lot of new surface area — adding
  TypeScript's learning curve on top would slow down understanding the
  concepts that actually matter here.
- **What a production version should add:** TypeScript across both
  frontend and backend, recommended as a second pass once the whole
  system works in JS — converting becomes "describe what already exists"
  rather than "guess the right type while also building."

### Concurrency-safe progress tracking

- See section 8 in full. Summary: switch from absolute-value writes to
  MongoDB's atomic `$inc` operator the moment concurrent batch processing
  is introduced in Phase 4 — not before, since sequential processing has
  no race condition to guard against yet.

************\*\*\*************What if in first parse where we need to map headers and we send some sample rows to ai , the rows are malformed, empty or any other issue with rows************\*\*************

Instead of taking one continuous block, take samples from different parts of the file:

10 valid rows near the beginning
10 valid rows from the middle
10 valid rows near the end

This protects against cases where the start of the file is unusual (metadata, blank rows, or corruption). It's more complex to implement in a streamed read because you don't know the middle or end until you've processed the file, so for a first version it's usually unnecessary.

---

## Free tools used

| Purpose          | Tool                                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database         | MongoDB Atlas (free M0 cluster)                                                                                                                    |
| AI               | Google Gemini API (free tier)                                                                                                                      |
| Frontend hosting | Vercel                                                                                                                                             |
| Backend hosting  | Render (free tier — 750 instance hours/month, 512MB RAM, 0.1 CPU per free web service; free web services spin down after 15 minutes of inactivity) |
| Job queue        | Simple Mongo-based polling worker (no Redis needed at this scale)                                                                                  |
