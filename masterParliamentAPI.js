/**
 * Master Parliament API Orchestrator
 *
 * Runs scrapeParliamentAPI.js for every term in searchTerms.js.
 * Uses ALL terms (not just unsearched) since this is a different data source.
 * Tracks progress, results, and timing in parliament_api_master_state.json.
 * Fully resumable — re-run to pick up where it left off.
 *
 * Usage:
 *   node masterParliamentAPI.js [options]
 *
 * Options:
 *   --startDate     From date (default: 2020-01-01)
 *   --endDate       To date (default: 2026-07-13)
 *   --house         Commons | Lords | Bicameral (default: Bicameral)
 *   --outDir        Output directory (default: ./parliament_api_data)
 *   --concurrency   Parallel term scrapes (default: 5)
 *   --detailConc    Parallel detail fetches per term (default: 10)
 *   --type          questions | statements | both (default: both)
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Import ALL terms — both searched and unsearched from Hansard
const searchTermsModule = require("./searchTerms.js");
const ALL_TERMS = [
  ...(searchTermsModule.SEARCHED_WITH_RESULTS || []).map((t) => t.term),
  ...(searchTermsModule.SEARCHED_ZERO_RESULTS || []),
  ...(searchTermsModule.YET_TO_SEARCH || []),
  ...(searchTermsModule.FAILED || []),
];

// Deduplicate
const TERMS = [...new Set(ALL_TERMS)];

// --- Parse CLI args ---
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    startDate: "2020-01-01",
    endDate: "2026-07-13",
    house: "Bicameral",
    outDir: path.join(__dirname, "parliament_api_data"),
    concurrency: 5,
    detailConc: 10,
    type: "both",
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--startDate":   parsed.startDate = args[++i]; break;
      case "--endDate":     parsed.endDate = args[++i]; break;
      case "--house":       parsed.house = args[++i]; break;
      case "--outDir":      parsed.outDir = args[++i]; break;
      case "--concurrency": parsed.concurrency = parseInt(args[++i], 10) || 5; break;
      case "--detailConc":  parsed.detailConc = parseInt(args[++i], 10) || 10; break;
      case "--type":        parsed.type = args[++i]; break;
    }
  }
  return parsed;
}

const CONFIG = parseArgs();
const STATE_FILE = path.join(CONFIG.outDir, "parliament_api_master_state.json");
const SCRAPER_SCRIPT = path.join(__dirname, "scrapeParliamentAPI.js");

function safeName(term) {
  return term.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

// --- State management ---
function loadMasterState() {
  if (fs.existsSync(STATE_FILE)) {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")); } catch { return null; }
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
    config: { ...CONFIG },
    summary: {
      totalTerms: TERMS.length,
      completed: 0,
      failed: 0,
      pending: TERMS.length,
      totalQuestions: 0,
      totalStatements: 0,
      totalTimeMs: 0,
    },
    terms: TERMS.map((term) => ({
      term,
      safeName: safeName(term),
      status: "pending",
      questions: null,
      statements: null,
      timeMs: null,
      startedAt: null,
      completedAt: null,
      error: null,
    })),
  };
}

function mergeMasterState(saved) {
  const existing = new Map(saved.terms.map((t) => [t.term, t]));
  const terms = TERMS.map((term) => {
    if (existing.has(term)) return existing.get(term);
    return {
      term,
      safeName: safeName(term),
      status: "pending",
      questions: null,
      statements: null,
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
      "--house", CONFIG.house,
      "--outDir", CONFIG.outDir,
      "--concurrency", String(CONFIG.detailConc),
      "--type", CONFIG.type,
    ];

    let stdout = "";
    let stderr = "";

    const child = spawn("node", args, { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
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
      let result = null;
      const m = stdout.match(/__RESULT__(.+)/);
      if (m) {
        try { result = JSON.parse(m[1]); } catch {}
      }
      resolve({ code, result, stderr: stderr.trim() });
    });

    child.on("error", (err) => {
      resolve({ code: 1, result: null, stderr: err.message });
    });
  });
}

// --- Main ---
async function main() {
  if (!fs.existsSync(CONFIG.outDir)) {
    fs.mkdirSync(CONFIG.outDir, { recursive: true });
  }

  let state = loadMasterState();
  if (state) {
    console.log("Resuming from saved state...");
    state = mergeMasterState(state);
  } else {
    console.log("Starting fresh run...");
    state = initMasterState();
  }
  saveMasterState(state);

  const pending = state.terms.filter((t) => t.status === "pending" || t.status === "in_progress");
  console.log(`\n${pending.length} terms remaining out of ${state.terms.length} total.`);
  console.log(`Concurrency: ${CONFIG.concurrency} terms in parallel, ${CONFIG.detailConc} detail fetches each`);
  console.log(`Type: ${CONFIG.type}\n`);

  if (pending.length === 0) {
    console.log("All terms already completed!");
    printSummary(state);
    return;
  }

  const masterStart = Date.now();
  let completedCount = state.summary.completed;

  // --- Worker pool ---
  const queue = [...pending];

  async function processTerm(termEntry) {
    const termIndex = state.terms.findIndex((t) => t.term === termEntry.term);
    completedCount++;
    const label = `[${completedCount}/${state.terms.length}]`;

    console.log(`\n${label} Starting: "${termEntry.term}"`);

    state.terms[termIndex].status = "in_progress";
    state.terms[termIndex].startedAt = new Date().toISOString();
    saveMasterState(state);

    const termStart = Date.now();
    const { code, result, stderr } = await runScraper(termEntry.term);
    const elapsed = Date.now() - termStart;

    if (code === 0 && result) {
      state.terms[termIndex].status = "completed";
      state.terms[termIndex].questions = result.questions || 0;
      state.terms[termIndex].statements = result.statements || 0;
      state.terms[termIndex].timeMs = elapsed;
      state.terms[termIndex].completedAt = new Date().toISOString();
      state.terms[termIndex].error = null;

      state.summary.completed++;
      state.summary.pending--;
      state.summary.totalQuestions += result.questions || 0;
      state.summary.totalStatements += result.statements || 0;

      console.log(`${label} Done: "${termEntry.term}" — ${result.questions}Q / ${result.statements}S in ${(elapsed / 1000).toFixed(1)}s`);
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

  async function worker() {
    while (queue.length > 0) {
      const termEntry = queue.shift();
      if (!termEntry) break;
      await processTerm(termEntry);
    }
  }

  const workers = [];
  for (let w = 0; w < CONFIG.concurrency; w++) {
    workers.push(worker());
    if (w < CONFIG.concurrency - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await Promise.all(workers);

  state.completedAt = new Date().toISOString();
  saveMasterState(state);

  printSummary(state);
}

function printSummary(state) {
  console.log(`\n${"=".repeat(60)}`);
  console.log("PARLIAMENT API MASTER SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`Total terms:        ${state.summary.totalTerms}`);
  console.log(`Completed:          ${state.summary.completed}`);
  console.log(`Failed:             ${state.summary.failed}`);
  console.log(`Total questions:    ${state.summary.totalQuestions}`);
  console.log(`Total statements:   ${state.summary.totalStatements}`);
  console.log(`Total time:         ${(state.summary.totalTimeMs / 1000 / 60).toFixed(1)} minutes`);

  // Top terms by question count
  const topTerms = [...state.terms]
    .filter((t) => (t.questions || 0) + (t.statements || 0) > 0)
    .sort((a, b) => ((b.questions || 0) + (b.statements || 0)) - ((a.questions || 0) + (a.statements || 0)))
    .slice(0, 20);

  if (topTerms.length > 0) {
    console.log(`\nTop terms by total results:`);
    topTerms.forEach((t, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. "${t.term}" — ${t.questions}Q / ${t.statements}S`);
    });
  }

  const zeroTerms = state.terms.filter((t) => t.status === "completed" && (t.questions || 0) === 0 && (t.statements || 0) === 0);
  if (zeroTerms.length > 0) {
    console.log(`\nTerms with 0 results: ${zeroTerms.length}`);
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
