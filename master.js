/**
 * Master Scraper Orchestrator
 *
 * Runs scrapeHansard.js for each term in searchTerms.js.
 * Tracks progress, time elapsed, and results per term.
 * Fully resumable — reads/writes master_state.json.
 *
 * Usage:
 *   node master.js [--startDate 2020-01-01] [--endDate 2026-07-13] [--outDir ./hansard_raw] [--concurrency 1]
 *
 * Resumability:
 *   - master_state.json tracks which terms are done/pending/failed
 *   - Each worker's own _state.json tracks page-level progress
 *   - Re-run `node master.js` to resume from where it left off
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const SEARCH_TERMS = require("./searchTerms.js");

// --- Parse CLI args ---
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    startDate: "2020-01-01",
    endDate: "2026-07-13",
    outDir: path.join(__dirname, "hansard_raw"),
    concurrency: 1, // sequential by default to be polite
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--startDate":
        parsed.startDate = args[++i];
        break;
      case "--endDate":
        parsed.endDate = args[++i];
        break;
      case "--outDir":
        parsed.outDir = args[++i];
        break;
      case "--concurrency":
        parsed.concurrency = parseInt(args[++i], 10) || 1;
        break;
    }
  }
  return parsed;
}

const CONFIG = parseArgs();
const STATE_FILE = path.join(CONFIG.outDir, "master_state.json");
const SCRAPER_SCRIPT = path.join(__dirname, "scrapeHansard.js");

function safeName(term) {
  return term.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

// --- State management ---
function loadMasterState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

function saveMasterState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function initMasterState() {
  return {
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    config: {
      startDate: CONFIG.startDate,
      endDate: CONFIG.endDate,
      outDir: CONFIG.outDir,
    },
    summary: {
      totalTerms: SEARCH_TERMS.length,
      completed: 0,
      failed: 0,
      pending: SEARCH_TERMS.length,
      totalResultsFound: 0,
      totalTimeMs: 0,
    },
    terms: SEARCH_TERMS.map((term) => ({
      term,
      safeName: safeName(term),
      status: "pending", // pending | in_progress | completed | failed
      totalResults: null,
      totalPages: null,
      timeMs: null,
      startedAt: null,
      completedAt: null,
      error: null,
    })),
  };
}

// Merge saved state with current terms list (handles added/removed terms)
function mergeMasterState(saved) {
  const existing = new Map(saved.terms.map((t) => [t.term, t]));

  const terms = SEARCH_TERMS.map((term) => {
    if (existing.has(term)) return existing.get(term);
    return {
      term,
      safeName: safeName(term),
      status: "pending",
      totalResults: null,
      totalPages: null,
      timeMs: null,
      startedAt: null,
      completedAt: null,
      error: null,
    };
  });

  saved.terms = terms;
  saved.summary.totalTerms = terms.length;
  saved.summary.pending = terms.filter((t) => t.status === "pending" || t.status === "in_progress").length;
  saved.summary.completed = terms.filter((t) => t.status === "completed").length;
  saved.summary.failed = terms.filter((t) => t.status === "failed").length;
  saved.lastUpdated = new Date().toISOString();
  return saved;
}

// --- Run a single scraper ---
function runScraper(term) {
  return new Promise((resolve) => {
    const args = [
      SCRAPER_SCRIPT,
      "--term", term,
      "--startDate", CONFIG.startDate,
      "--endDate", CONFIG.endDate,
      "--outDir", CONFIG.outDir,
    ];

    let stdout = "";
    let stderr = "";

    const child = spawn("node", args, { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      // Stream worker output with prefix
      text.split("\n").filter(Boolean).forEach((line) => {
        if (!line.startsWith("__RESULT__")) {
          console.log(line);
        }
      });
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      // Parse __RESULT__ line from stdout
      let result = null;
      const resultMatch = stdout.match(/__RESULT__(.+)/);
      if (resultMatch) {
        try {
          result = JSON.parse(resultMatch[1]);
        } catch {}
      }

      resolve({
        code,
        result,
        stderr: stderr.trim(),
      });
    });

    child.on("error", (err) => {
      resolve({
        code: 1,
        result: null,
        stderr: err.message,
      });
    });
  });
}

// --- Main ---
async function main() {
  if (!fs.existsSync(CONFIG.outDir)) {
    fs.mkdirSync(CONFIG.outDir, { recursive: true });
  }

  // Load or init state
  let state = loadMasterState();
  if (state) {
    console.log("Resuming from saved state...");
    state = mergeMasterState(state);
  } else {
    console.log("Starting fresh run...");
    state = initMasterState();
  }
  saveMasterState(state);

  // Get pending terms
  const pending = state.terms.filter((t) => t.status === "pending" || t.status === "in_progress");
  console.log(`\n${pending.length} terms remaining out of ${state.terms.length} total.\n`);

  if (pending.length === 0) {
    console.log("All terms already completed!");
    printSummary(state);
    return;
  }

  const masterStart = Date.now();
  const concurrency = CONFIG.concurrency;
  let completedCount = 0;

  console.log(`Running with concurrency: ${concurrency}\n`);

  // Process a single term — returns when done
  async function processTerm(termEntry) {
    const termIndex = state.terms.findIndex((t) => t.term === termEntry.term);
    completedCount++;
    const label = `[${completedCount}/${pending.length}]`;

    console.log(`${label} Starting: "${termEntry.term}"`);

    state.terms[termIndex].status = "in_progress";
    state.terms[termIndex].startedAt = new Date().toISOString();
    saveMasterState(state);

    const termStart = Date.now();
    const { code, result, stderr } = await runScraper(termEntry.term);
    const elapsed = Date.now() - termStart;

    if (code === 0 && result) {
      state.terms[termIndex].status = "completed";
      state.terms[termIndex].totalResults = result.totalResults || 0;
      state.terms[termIndex].totalPages = result.totalPages || 0;
      state.terms[termIndex].timeMs = elapsed;
      state.terms[termIndex].completedAt = new Date().toISOString();
      state.terms[termIndex].error = null;

      state.summary.completed++;
      state.summary.pending--;
      state.summary.totalResultsFound += result.totalResults || 0;

      console.log(`${label} Done: "${termEntry.term}" — ${result.totalResults} results in ${(elapsed / 1000).toFixed(1)}s`);
    } else {
      state.terms[termIndex].status = "failed";
      state.terms[termIndex].timeMs = elapsed;
      state.terms[termIndex].completedAt = new Date().toISOString();
      state.terms[termIndex].error = stderr || `Exit code ${code}`;

      state.summary.failed++;
      state.summary.pending--;

      console.log(`${label} FAILED: "${termEntry.term}" (exit ${code}) in ${(elapsed / 1000).toFixed(1)}s`);
      if (stderr) console.log(`  Error: ${stderr.substring(0, 200)}`);
    }

    state.summary.totalTimeMs = Date.now() - masterStart;
    state.lastUpdated = new Date().toISOString();
    saveMasterState(state);
  }

  // --- Worker pool: run up to `concurrency` terms in parallel ---
  const queue = [...pending];

  async function worker(workerId) {
    while (queue.length > 0) {
      const termEntry = queue.shift();
      if (!termEntry) break;
      await processTerm(termEntry);
      // Small stagger between finishing one and starting the next
      if (queue.length > 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // Launch worker pool
  const workers = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push(worker(w));
    // Stagger worker launches so they don't all hit the server at the same instant
    if (w < concurrency - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await Promise.all(workers);

  state.completedAt = new Date().toISOString();
  saveMasterState(state);

  printSummary(state);
}

function printSummary(state) {
  console.log(`\n${"=".repeat(60)}`);
  console.log("MASTER SCRAPE SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`Total terms:     ${state.summary.totalTerms}`);
  console.log(`Completed:       ${state.summary.completed}`);
  console.log(`Failed:          ${state.summary.failed}`);
  console.log(`Total results:   ${state.summary.totalResultsFound}`);
  console.log(`Total time:      ${(state.summary.totalTimeMs / 1000 / 60).toFixed(1)} minutes`);

  // Top terms by result count
  const topTerms = [...state.terms]
    .filter((t) => t.totalResults > 0)
    .sort((a, b) => b.totalResults - a.totalResults)
    .slice(0, 15);

  if (topTerms.length > 0) {
    console.log(`\nTop terms by results:`);
    topTerms.forEach((t, i) => {
      console.log(`  ${i + 1}. "${t.term}" — ${t.totalResults} results (${t.totalPages} pages)`);
    });
  }

  const failed = state.terms.filter((t) => t.status === "failed");
  if (failed.length > 0) {
    console.log(`\nFailed terms:`);
    failed.forEach((t) => console.log(`  - "${t.term}": ${t.error}`));
  }

  console.log(`\nState saved to: ${STATE_FILE}`);
}

main().catch((err) => {
  console.error("Master fatal error:", err);
  process.exit(1);
});
