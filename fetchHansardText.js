/**
 * Hansard Debate Text Downloader
 *
 * Scans hansard_raw/*_metadata.json files, extracts debate UUIDs from fullUrl,
 * and downloads transcripts via the official Hansard JSON API:
 *   https://hansard-api.parliament.uk/debates/debate/{uuid}.json
 *
 * JSON responses are converted to readable plain text (title, timestamps,
 * speaker names, and speech content).
 *
 * Resumable — skips files already on disk (tracked in fetch_state.json).
 * Same debate UUID may appear under multiple search terms; each gets its own
 * file named searchTerm_UUID_slug.txt.
 *
 * Usage:
 *   node fetchHansardText.js [--inDir ./hansard_raw] [--outDir ./hansard_text]
 *                            [--term "artificial intelligence"] [--limit 2]
 *                            [--concurrency 20] [--delay 0] [--force]
 *
 * Downloads run in parallel batches (default 20 concurrent).
 */

const fs = require("fs");
const path = require("path");

const API_BASE = "https://hansard-api.parliament.uk";
const DEBATE_JSON_PATH = "/debates/debate";
const DEFAULT_CONCURRENCY = 20;
const DEFAULT_DELAY_MS = 0;
const MAX_RETRIES = 3;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    inDir: path.join(__dirname, "hansard_raw"),
    outDir: path.join(__dirname, "hansard_text"),
    term: null,
    limit: null,
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--inDir":
        parsed.inDir = path.resolve(args[++i]);
        break;
      case "--outDir":
        parsed.outDir = path.resolve(args[++i]);
        break;
      case "--term":
        parsed.term = args[++i];
        break;
      case "--limit":
        parsed.limit = parseInt(args[++i], 10);
        break;
      case "--concurrency":
        parsed.concurrency = Math.max(1, parseInt(args[++i], 10) || DEFAULT_CONCURRENCY);
        break;
      case "--delay":
        parsed.delayMs = parseInt(args[++i], 10);
        if (Number.isNaN(parsed.delayMs)) parsed.delayMs = DEFAULT_DELAY_MS;
        break;
      case "--force":
        parsed.force = true;
        break;
    }
  }
  return parsed;
}

function safeName(term) {
  return term.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stateFilePath(outDir) {
  return path.join(outDir, "fetch_state.json");
}

function loadState(outDir) {
  const fp = stateFilePath(outDir);
  if (fs.existsSync(fp)) {
    try {
      return JSON.parse(fs.readFileSync(fp, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

function saveState(outDir, state) {
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(stateFilePath(outDir), JSON.stringify(state, null, 2), "utf-8");
}

function parseDebateUrl(fullUrl) {
  if (!fullUrl || typeof fullUrl !== "string") return null;

  const match = fullUrl.match(
    /\/(?:Commons|Lords)\/\d{4}-\d{2}-\d{2}\/debates\/([0-9A-Fa-f-]{36})\/([^/?#]+)\/?$/
  );
  if (!match) return null;

  return {
    uuid: match[1].toUpperCase(),
    slug: match[2],
  };
}

function buildOutputFilename(searchTermSafe, uuid, slug) {
  return `${searchTermSafe}_${uuid}_${slug}.txt`;
}

function findMetadataFiles(inDir, termFilter) {
  if (!fs.existsSync(inDir)) {
    throw new Error(`Input directory not found: ${inDir}`);
  }

  const files = fs
    .readdirSync(inDir)
    .filter((f) => f.endsWith("_metadata.json"))
    .map((f) => path.join(inDir, f));

  if (!termFilter) return files.sort();

  const target = safeName(termFilter);
  return files.filter((f) => path.basename(f, "_metadata.json") === target);
}

function loadDebatesFromMetadata(metadataPath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
  } catch (err) {
    throw new Error(`Failed to parse ${metadataPath}: ${err.message}`);
  }

  const searchTerm = data?.searchTerm?.term;
  const results = data?.searchTerm?.results;
  if (!searchTerm || !Array.isArray(results)) {
    throw new Error(`Unexpected metadata structure in ${metadataPath}`);
  }

  const searchTermSafe = safeName(searchTerm);
  const debates = [];

  for (const entry of results) {
    const parsed = parseDebateUrl(entry.fullUrl);
    if (!parsed) {
      console.warn(`  [${searchTerm}] Skipping invalid fullUrl: ${entry.fullUrl || "(missing)"}`);
      continue;
    }

    debates.push({
      searchTerm,
      searchTermSafe,
      uuid: parsed.uuid,
      slug: parsed.slug,
      title: entry.title || "",
      fullUrl: entry.fullUrl,
      filename: buildOutputFilename(searchTermSafe, parsed.uuid, parsed.slug),
    });
  }

  return debates;
}

function initState() {
  return {
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    completedAt: null,
    summary: {
      totalPlanned: 0,
      downloaded: 0,
      skipped: 0,
      failed: 0,
    },
    files: {},
    failures: [],
  };
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n")
    .trim();
}

function shouldSkipItem(item) {
  if (item.ItemType === "Timestamp") return false;
  if (item.ItemType !== "Contribution") return true;
  const tag = (item.HRSTag || "").toLowerCase();
  return tag === "hs_columnnumber";
}

function isSpeechContribution(item) {
  if (item.ItemType !== "Contribution") return false;
  const tag = (item.HRSTag || "").toLowerCase();
  return tag === "hs_para" && !!item.AttributedTo;
}

/**
 * Convert a Hansard API debate JSON object to plain text.
 *
 * Structure:
 *   Overview  — debate metadata (Title, Date, House, Location)
 *   Navigator — hierarchy breadcrumbs
 *   Items     — ordered contributions (speeches, timestamps, procedural lines)
 *   ChildDebates — nested sub-debates (empty for most debates in this dataset)
 */
function debateJsonToText(data) {
  const lines = [];
  const title = (data.Overview?.Title || "").trim();
  if (title) {
    lines.push(` ${title}`, "");
  }

  const items = Array.isArray(data.Items) ? data.Items : [];
  for (const item of items) {
    if (shouldSkipItem(item)) continue;

    if (item.ItemType === "Timestamp") {
      const time = (item.Value || "").trim();
      if (time) {
        if (lines.length && lines[lines.length - 1] !== "") lines.push("");
        lines.push(time);
        lines.push("");
      }
      continue;
    }

    const text = stripHtml(item.Value);
    if (!text) continue;

    if (isSpeechContribution(item) || item.AttributedTo) {
      lines.push(item.AttributedTo.trim());
      lines.push(text);
      lines.push("");
    } else {
      lines.push(text);
      lines.push("");
    }
  }

  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}

function buildApiUrl(uuid) {
  return `${API_BASE}${DEBATE_JSON_PATH}/${uuid}.json`;
}

function buildFetchHeaders() {
  return {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
    "Accept-Language": "en-GB,en;q=0.9",
  };
}

async function fetchDebateJson(debate) {
  const url = buildApiUrl(debate.uuid);
  try {
    const response = await fetch(url, {
      headers: buildFetchHeaders(),
      redirect: "follow",
    });
    const body = await response.text();
    return { uuid: debate.uuid, status: response.status, body, error: null };
  } catch (err) {
    return { uuid: debate.uuid, status: 0, body: "", error: err.message };
  }
}

async function fetchDebateJsonBatch(debates) {
  return Promise.all(debates.map((debate) => fetchDebateJson(debate)));
}

function classifyFetchResult(res) {
  if (res.error) {
    return { kind: "retryable", error: res.error };
  }
  if (res.status === 200) {
    let data;
    try {
      data = JSON.parse(res.body);
    } catch (err) {
      return { kind: "failed", error: `Invalid JSON: ${err.message}` };
    }
    const text = debateJsonToText(data);
    if (!text.trim()) {
      return { kind: "failed", error: "Empty debate text after conversion" };
    }
    return { kind: "ok", body: text };
  }
  if (res.status === 404) {
    return { kind: "failed", error: "Not found (HTTP 404)" };
  }
  if (res.status === 429 || res.status >= 500) {
    return { kind: "retryable", error: `HTTP ${res.status}` };
  }
  return { kind: "failed", error: `HTTP ${res.status}` };
}

function recordSuccess(state, debate, bytes) {
  state.files[debate.filename] = {
    status: "completed",
    searchTerm: debate.searchTerm,
    uuid: debate.uuid,
    slug: debate.slug,
    fullUrl: debate.fullUrl,
    bytes,
    downloadedAt: new Date().toISOString(),
  };
  state.summary.downloaded++;
  state.failures = state.failures.filter((f) => f.filename !== debate.filename);
}

function recordFailure(state, debate, error) {
  console.error(`    FAILED [${debate.filename}]: ${error}`);
  state.files[debate.filename] = {
    status: "failed",
    searchTerm: debate.searchTerm,
    uuid: debate.uuid,
    slug: debate.slug,
    fullUrl: debate.fullUrl,
    error,
    failedAt: new Date().toISOString(),
  };
  state.summary.failed++;
  state.failures.push({
    filename: debate.filename,
    uuid: debate.uuid,
    searchTerm: debate.searchTerm,
    error,
  });
}

async function downloadBatch(debates, outDir, state) {
  for (const debate of debates) {
    console.log(`DOWNLOAD: ${debate.filename}`);
    console.log(`    ${debate.title}`);
    console.log(`    ${buildApiUrl(debate.uuid)}`);
  }

  let pending = [...debates];

  for (let attempt = 1; attempt <= MAX_RETRIES && pending.length > 0; attempt++) {
    if (attempt > 1) {
      const backoff = (attempt - 1) * 3000;
      console.warn(
        `    Retrying ${pending.length} debate(s) (attempt ${attempt}/${MAX_RETRIES}, waiting ${backoff}ms)...`
      );
      await sleep(backoff);
    }

    const results = await fetchDebateJsonBatch(pending);
    const resultByUuid = new Map(results.map((r) => [r.uuid, r]));
    const nextPending = [];

    for (const debate of pending) {
      const res = resultByUuid.get(debate.uuid);
      if (!res) {
        nextPending.push(debate);
        continue;
      }

      const outcome = classifyFetchResult(res);
      if (outcome.kind === "ok") {
        const outPath = path.join(outDir, debate.filename);
        fs.writeFileSync(outPath, outcome.body, "utf-8");
        const bytes = Buffer.byteLength(outcome.body, "utf-8");
        console.log(`    Saved ${bytes} bytes -> ${debate.filename}`);
        recordSuccess(state, debate, bytes);
      } else if (outcome.kind === "retryable" && attempt < MAX_RETRIES) {
        nextPending.push(debate);
      } else {
        recordFailure(state, debate, outcome.error);
      }
    }

    pending = nextPending;
  }
}

async function main() {
  const CONFIG = parseArgs();
  const startedAt = Date.now();

  if (!fs.existsSync(CONFIG.outDir)) {
    fs.mkdirSync(CONFIG.outDir, { recursive: true });
  }

  const metadataFiles = findMetadataFiles(CONFIG.inDir, CONFIG.term);
  if (metadataFiles.length === 0) {
    console.log(
      CONFIG.term
        ? `No metadata file found for term "${CONFIG.term}" in ${CONFIG.inDir}`
        : `No *_metadata.json files found in ${CONFIG.inDir}`
    );
    return;
  }

  let state = loadState(CONFIG.outDir) || initState();
  if (!state.files) state.files = {};
  if (!state.failures) state.failures = [];
  if (!state.summary) state.summary = initState().summary;

  state.summary.downloaded = 0;
  state.summary.failed = 0;
  state.summary.skipped = 0;
  state.failures = [];

  const allDebates = [];
  for (const metadataPath of metadataFiles) {
    const debates = loadDebatesFromMetadata(metadataPath);
    console.log(`[${path.basename(metadataPath)}] ${debates.length} debates`);
    allDebates.push(...debates);
  }

  let queue = allDebates;
  if (CONFIG.limit != null && CONFIG.limit > 0) {
    queue = queue.slice(0, CONFIG.limit);
    console.log(`Limiting to first ${queue.length} debate(s).`);
  }

  state.summary.totalPlanned = queue.length;
  console.log(
    `\nProcessing ${queue.length} debate(s) -> ${CONFIG.outDir} (concurrency: ${CONFIG.concurrency})\n`
  );

  const pending = [];
  let skipped = 0;

  for (const debate of queue) {
    const outPath = path.join(CONFIG.outDir, debate.filename);
    if (!CONFIG.force && fs.existsSync(outPath)) {
      skipped++;
      state.files[debate.filename] = {
        status: "completed",
        searchTerm: debate.searchTerm,
        uuid: debate.uuid,
        slug: debate.slug,
        fullUrl: debate.fullUrl,
        downloadedAt: state.files[debate.filename]?.downloadedAt || new Date().toISOString(),
        resumed: true,
      };
      continue;
    }
    pending.push(debate);
  }

  state.summary.skipped = skipped;
  if (skipped > 0) {
    console.log(`Skipping ${skipped} already-downloaded file(s).`);
    saveState(CONFIG.outDir, state);
  }

  if (pending.length === 0) {
    console.log("Nothing to download.");
  } else {
    for (let offset = 0; offset < pending.length; offset += CONFIG.concurrency) {
      const batch = pending.slice(offset, offset + CONFIG.concurrency);
      const batchNum = Math.floor(offset / CONFIG.concurrency) + 1;
      const totalBatches = Math.ceil(pending.length / CONFIG.concurrency);

      console.log(
        `\nBatch ${batchNum}/${totalBatches}: downloading ${batch.length} debate(s) in parallel...`
      );

      await downloadBatch(batch, CONFIG.outDir, state);
      saveState(CONFIG.outDir, state);

      const hasMore = offset + CONFIG.concurrency < pending.length;
      if (hasMore && CONFIG.delayMs > 0) {
        await sleep(CONFIG.delayMs);
      }
    }
  }

  state.completedAt = new Date().toISOString();
  saveState(CONFIG.outDir, state);

  const elapsedMs = Date.now() - startedAt;
  const { downloaded, skipped: skippedTotal, failed, totalPlanned } = state.summary;
  console.log(`\n${"=".repeat(60)}`);
  console.log("HANSARD TEXT FETCH SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`Mode:       api`);
  console.log(`Planned:    ${totalPlanned}`);
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Skipped:    ${skippedTotal}`);
  console.log(`Failed:     ${failed}`);
  console.log(`Elapsed:    ${(elapsedMs / 1000).toFixed(1)}s`);
  console.log(`Output:     ${CONFIG.outDir}`);
  console.log(`State:      ${stateFilePath(CONFIG.outDir)}`);

  if (state.failures.length > 0) {
    console.log(`\nFailures:`);
    state.failures.forEach((f) => {
      console.log(`  - ${f.filename}: ${f.error}`);
    });
  }

  console.log(
    `__RESULT__${JSON.stringify({
      mode: "api",
      planned: totalPlanned,
      downloaded,
      skipped: skippedTotal,
      failed,
      elapsedMs,
      outDir: CONFIG.outDir,
    })}`
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
