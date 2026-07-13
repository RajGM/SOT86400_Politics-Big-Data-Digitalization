/**
 * UK Parliament Written Questions & Statements API Scraper
 *
 * Two-pass approach:
 *   Pass 1: Batch-fetch all results from the list endpoint (fast, but text truncated)
 *   Pass 2: Fetch each record individually by ID for full text (concurrent, resumable)
 *
 * Endpoints:
 *   - /api/writtenquestions/questions      (list)
 *   - /api/writtenquestions/questions/{id}  (detail — full text)
 *   - /api/writtenstatements/statements     (list)
 *   - /api/writtenstatements/statements/{id} (detail — full text)
 *
 * API docs:  https://questions-statements-api.parliament.uk/index.html
 * Swagger:   https://questions-statements-api.parliament.uk/swagger/v1/swagger.json
 * Dev hub:   https://developer.parliament.uk/
 *
 * Usage:
 *   node scrapeParliamentAPI.js --term "artificial intelligence" [options]
 *
 * Options:
 *   --term         Search term (default: "artificial intelligence")
 *   --startDate    From date yyyy-mm-dd (default: 2020-01-01)
 *   --endDate      To date yyyy-mm-dd (default: 2026-07-13)
 *   --house        Commons | Lords | Bicameral (default: Bicameral)
 *   --outDir       Output directory (default: ./parliament_api_data)
 *   --batchSize    Records per list request (default: 100)
 *   --concurrency  Parallel detail fetches (default: 10)
 *   --type         questions | statements | both (default: both)
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

// --- Parse CLI args ---
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    term: "artificial intelligence",
    startDate: "2020-01-01",
    endDate: "2026-07-13",
    house: "Bicameral",
    outDir: path.join(__dirname, "parliament_api_data"),
    batchSize: 100,
    concurrency: 10,
    type: "both",
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--term":        parsed.term = args[++i]; break;
      case "--startDate":   parsed.startDate = args[++i]; break;
      case "--endDate":     parsed.endDate = args[++i]; break;
      case "--house":       parsed.house = args[++i]; break;
      case "--outDir":      parsed.outDir = args[++i]; break;
      case "--batchSize":   parsed.batchSize = parseInt(args[++i], 10) || 100; break;
      case "--concurrency": parsed.concurrency = parseInt(args[++i], 10) || 10; break;
      case "--type":        parsed.type = args[++i]; break;
    }
  }
  return parsed;
}

const CONFIG = parseArgs();
const BASE_URL = "https://questions-statements-api.parliament.uk";

function safeName(term) {
  return term.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- HTTP fetch as JSON with retry ---
function fetchJSON(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      https.get(url, { headers: { Accept: "application/json" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 429 || res.statusCode >= 500) {
            if (n < retries) {
              const wait = (res.statusCode === 429 ? 5000 : 2000) * n;
              console.log(`    Rate limited/server error (${res.statusCode}), retrying in ${wait}ms...`);
              setTimeout(() => attempt(n + 1), wait);
              return;
            }
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`JSON parse error: ${err.message}\nBody: ${data.substring(0, 300)}`));
          }
        });
      }).on("error", (err) => {
        if (n < retries) {
          setTimeout(() => attempt(n + 1), 2000 * n);
        } else {
          reject(err);
        }
      });
    };
    attempt(1);
  });
}

// --- State management ---
function stateFilePath(type) {
  return path.join(CONFIG.outDir, `${safeName(CONFIG.term)}_${type}_state.json`);
}

function loadState(type) {
  const fp = stateFilePath(type);
  if (fs.existsSync(fp)) {
    try { return JSON.parse(fs.readFileSync(fp, "utf-8")); } catch { return null; }
  }
  return null;
}

function saveState(type, state) {
  fs.writeFileSync(stateFilePath(type), JSON.stringify(state, null, 2), "utf-8");
}

// --- Concurrent worker pool ---
async function runPool(items, concurrency, workerFn) {
  const queue = [...items];
  let completed = 0;
  const total = items.length;

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      await workerFn(item);
      completed++;
      if (completed % 50 === 0 || completed === total) {
        console.log(`    Detail fetch progress: ${completed}/${total}`);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

// ===========================================================================
//  WRITTEN QUESTIONS
// ===========================================================================
async function scrapeQuestions() {
  const type = "questions";
  let state = loadState(type) || {
    term: CONFIG.term,
    type,
    phase: "list",       // "list" → "detail" → "completed"
    totalResults: null,
    listFetched: 0,
    detailFetched: new Set(),
    results: [],         // array of {id, ...partial data}
    startedAt: new Date().toISOString(),
  };

  // Convert detailFetched back to Set if loaded from JSON
  if (Array.isArray(state.detailFetched)) {
    state.detailFetched = new Set(state.detailFetched);
  }

  const saveWithSet = () => {
    const toSave = { ...state, detailFetched: [...state.detailFetched] };
    fs.writeFileSync(stateFilePath(type), JSON.stringify(toSave, null, 2), "utf-8");
  };

  if (state.phase === "completed") {
    console.log(`[Questions] Already completed (${state.results.length} results). Skipping.`);
    return state;
  }

  // --- PASS 1: List fetch (get IDs + truncated text) ---
  if (state.phase === "list") {
    console.log(`[Questions] Pass 1: List fetch from skip=${state.listFetched}...`);

    while (true) {
      const params = new URLSearchParams({
        searchTerm: CONFIG.term,
        tabledWhenFrom: CONFIG.startDate,
        tabledWhenTo: CONFIG.endDate,
        house: CONFIG.house,
        expandMember: "true",
        skip: String(state.listFetched),
        take: String(CONFIG.batchSize),
      });

      const url = `${BASE_URL}/api/writtenquestions/questions?${params}`;
      console.log(`  [Questions] List: skip=${state.listFetched}...`);

      let data;
      try {
        data = await fetchJSON(url);
      } catch (err) {
        console.error(`  [Questions] Error: ${err.message}`);
        saveWithSet();
        break;
      }

      if (state.totalResults === null) {
        state.totalResults = data.totalResults || 0;
        console.log(`  [Questions] Total: ${state.totalResults}`);
      }

      if (!data.results || data.results.length === 0) break;

      for (const item of data.results) {
        const q = item.value;
        state.results.push({
          id: q.id,
          house: q.house,
          dateTabled: q.dateTabled,
          dateAnswered: q.dateAnswered,
          heading: q.heading,
          questionText: q.questionText,
          answerText: q.answerText,
          askingMember: q.askingMember ? {
            id: q.askingMember.id,
            name: q.askingMember.name,
            party: q.askingMember.party,
            partyAbbreviation: q.askingMember.partyAbbreviation,
            constituency: q.askingMember.memberFrom,
          } : null,
          answeringMember: q.answeringMember ? {
            id: q.answeringMember.id,
            name: q.answeringMember.name,
            party: q.answeringMember.party,
            partyAbbreviation: q.answeringMember.partyAbbreviation,
          } : null,
          answeringBodyName: q.answeringBodyName,
          uin: q.uin,
          isWithdrawn: q.isWithdrawn,
          _needsDetail: true,
        });
      }

      state.listFetched += data.results.length;
      saveWithSet();

      if (state.listFetched >= state.totalResults) break;
      await sleep(300);
    }

    state.phase = "detail";
    saveWithSet();
    console.log(`  [Questions] Pass 1 done. ${state.results.length} records, moving to detail fetch.`);
  }

  // --- PASS 2: Detail fetch (full text for each record) ---
  if (state.phase === "detail") {
    const needDetail = state.results.filter(
      (r) => r._needsDetail && !state.detailFetched.has(r.id)
    );
    console.log(`[Questions] Pass 2: Detail fetch for ${needDetail.length} records (concurrency=${CONFIG.concurrency})...`);

    // Build a map for fast lookup
    const resultMap = new Map(state.results.map((r, i) => [r.id, i]));
    let saveCounter = 0;

    await runPool(needDetail, CONFIG.concurrency, async (record) => {
      const url = `${BASE_URL}/api/writtenquestions/questions/${record.id}?expandMember=true`;
      try {
        const detail = await fetchJSON(url);
        const v = detail.value;
        const idx = resultMap.get(record.id);
        if (idx !== undefined && v) {
          state.results[idx].questionText = v.questionText;
          state.results[idx].answerText = v.answerText;
          state.results[idx]._needsDetail = false;
        }
        state.detailFetched.add(record.id);
      } catch (err) {
        console.error(`    Failed detail for ID ${record.id}: ${err.message}`);
      }

      // Save state every 100 records
      saveCounter++;
      if (saveCounter % 100 === 0) {
        saveWithSet();
      }

      await sleep(50); // tiny delay per request
    });

    // Clean up _needsDetail flags
    for (const r of state.results) {
      delete r._needsDetail;
    }

    state.phase = "completed";
    state.completedAt = new Date().toISOString();
    saveWithSet();
    console.log(`  [Questions] Pass 2 done. Full text fetched.`);
  }

  return state;
}

// ===========================================================================
//  WRITTEN STATEMENTS
// ===========================================================================
async function scrapeStatements() {
  const type = "statements";
  let state = loadState(type) || {
    term: CONFIG.term,
    type,
    phase: "list",
    totalResults: null,
    listFetched: 0,
    detailFetched: new Set(),
    results: [],
    startedAt: new Date().toISOString(),
  };

  if (Array.isArray(state.detailFetched)) {
    state.detailFetched = new Set(state.detailFetched);
  }

  const saveWithSet = () => {
    const toSave = { ...state, detailFetched: [...state.detailFetched] };
    fs.writeFileSync(stateFilePath(type), JSON.stringify(toSave, null, 2), "utf-8");
  };

  if (state.phase === "completed") {
    console.log(`[Statements] Already completed (${state.results.length} results). Skipping.`);
    return state;
  }

  // --- PASS 1: List fetch ---
  if (state.phase === "list") {
    console.log(`[Statements] Pass 1: List fetch from skip=${state.listFetched}...`);

    while (true) {
      const params = new URLSearchParams({
        searchTerm: CONFIG.term,
        madeWhenFrom: CONFIG.startDate,
        madeWhenTo: CONFIG.endDate,
        house: CONFIG.house,
        expandMember: "true",
        skip: String(state.listFetched),
        take: String(CONFIG.batchSize),
      });

      const url = `${BASE_URL}/api/writtenstatements/statements?${params}`;
      console.log(`  [Statements] List: skip=${state.listFetched}...`);

      let data;
      try {
        data = await fetchJSON(url);
      } catch (err) {
        console.error(`  [Statements] Error: ${err.message}`);
        saveWithSet();
        break;
      }

      if (state.totalResults === null) {
        state.totalResults = data.totalResults || 0;
        console.log(`  [Statements] Total: ${state.totalResults}`);
      }

      if (!data.results || data.results.length === 0) break;

      for (const item of data.results) {
        const s = item.value;
        state.results.push({
          id: s.id,
          house: s.house,
          dateMade: s.dateMade,
          title: s.title,
          text: s.text,
          member: s.member ? {
            id: s.member.id,
            name: s.member.name,
            party: s.member.party,
            partyAbbreviation: s.member.partyAbbreviation,
            constituency: s.member.memberFrom,
          } : null,
          memberRole: s.memberRole,
          answeringBodyName: s.answeringBodyName,
          uin: s.uin,
          _needsDetail: true,
        });
      }

      state.listFetched += data.results.length;
      saveWithSet();

      if (state.listFetched >= state.totalResults) break;
      await sleep(300);
    }

    state.phase = "detail";
    saveWithSet();
    console.log(`  [Statements] Pass 1 done. ${state.results.length} records.`);
  }

  // --- PASS 2: Detail fetch ---
  if (state.phase === "detail") {
    const needDetail = state.results.filter(
      (r) => r._needsDetail && !state.detailFetched.has(r.id)
    );
    console.log(`[Statements] Pass 2: Detail fetch for ${needDetail.length} records...`);

    const resultMap = new Map(state.results.map((r, i) => [r.id, i]));
    let saveCounter = 0;

    await runPool(needDetail, CONFIG.concurrency, async (record) => {
      const url = `${BASE_URL}/api/writtenstatements/statements/${record.id}?expandMember=true`;
      try {
        const detail = await fetchJSON(url);
        const v = detail.value;
        const idx = resultMap.get(record.id);
        if (idx !== undefined && v) {
          state.results[idx].text = v.text;
          state.results[idx]._needsDetail = false;
        }
        state.detailFetched.add(record.id);
      } catch (err) {
        console.error(`    Failed detail for ID ${record.id}: ${err.message}`);
      }

      saveCounter++;
      if (saveCounter % 100 === 0) {
        saveWithSet();
      }

      await sleep(50);
    });

    for (const r of state.results) {
      delete r._needsDetail;
    }

    state.phase = "completed";
    state.completedAt = new Date().toISOString();
    saveWithSet();
    console.log(`  [Statements] Pass 2 done. Full text fetched.`);
  }

  return state;
}

// ===========================================================================
//  MAIN
// ===========================================================================
async function main() {
  if (!fs.existsSync(CONFIG.outDir)) {
    fs.mkdirSync(CONFIG.outDir, { recursive: true });
  }

  const startTime = Date.now();
  let questionsState = null;
  let statementsState = null;

  if (CONFIG.type === "both") {
    // Run list passes in parallel, then detail passes
    [questionsState, statementsState] = await Promise.all([
      scrapeQuestions(),
      scrapeStatements(),
    ]);
  } else if (CONFIG.type === "questions") {
    questionsState = await scrapeQuestions();
  } else if (CONFIG.type === "statements") {
    statementsState = await scrapeStatements();
  }

  const elapsed = Date.now() - startTime;

  // Save combined output
  const sn = safeName(CONFIG.term);
  const output = {
    baseURL: BASE_URL,
    apiDocs: "https://questions-statements-api.parliament.uk/index.html",
    devHub: "https://developer.parliament.uk/",
    scrapeConfig: {
      term: CONFIG.term,
      startDate: CONFIG.startDate,
      endDate: CONFIG.endDate,
      house: CONFIG.house,
      scrapedAt: new Date().toISOString(),
      elapsedMs: elapsed,
    },
  };

  if (questionsState) {
    output.writtenQuestions = {
      totalResults: questionsState.totalResults,
      count: questionsState.results.length,
      results: questionsState.results,
    };
  }

  if (statementsState) {
    output.writtenStatements = {
      totalResults: statementsState.totalResults,
      count: statementsState.results.length,
      results: statementsState.results,
    };
  }

  const outputFile = path.join(CONFIG.outDir, `${sn}_combined.json`);
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf-8");

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`PARLIAMENT API SCRAPE COMPLETE`);
  console.log(`${"=".repeat(50)}`);
  console.log(`Term:               "${CONFIG.term}"`);
  console.log(`House:              ${CONFIG.house}`);
  console.log(`Date range:         ${CONFIG.startDate} to ${CONFIG.endDate}`);
  if (questionsState) {
    console.log(`Written Questions:  ${questionsState.results.length}`);
  }
  if (statementsState) {
    console.log(`Written Statements: ${statementsState.results.length}`);
  }
  console.log(`Time:               ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`Output:             ${outputFile}`);

  console.log(`__RESULT__${JSON.stringify({
    term: CONFIG.term,
    questions: questionsState?.results.length || 0,
    statements: statementsState?.results.length || 0,
    status: "completed",
  })}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
