/**
 * Hansard Debate Scraper (single-term worker)
 *
 * Scrapes UK Parliament Hansard search results for a given term.
 * Uses Puppeteer to handle Cloudflare protection.
 * Supports resumability — skips pages already saved to disk.
 *
 * Usage:
 *   node scrapeHansard.js --term "artificial intelligence" [--startDate 2020-01-01] [--endDate 2026-07-13] [--outDir ./hansard_raw]
 *
 * Setup:  npm install puppeteer
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

// --- Parse CLI args ---
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    term: "artificial intelligence",
    startDate: "2020-01-01",
    endDate: "2026-07-13",
    outDir: path.join(__dirname, "hansard_raw"),
    sortOrder: 1,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--term":
        parsed.term = args[++i];
        break;
      case "--startDate":
        parsed.startDate = args[++i];
        break;
      case "--endDate":
        parsed.endDate = args[++i];
        break;
      case "--outDir":
        parsed.outDir = args[++i];
        break;
    }
  }
  return parsed;
}

const CONFIG = parseArgs();
const BASE_URL = "https://hansard.parliament.uk";
const DELAY_MS = 3000;

// Safe filename from search term
function safeName(term) {
  return term.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildUrl(page) {
  const params = new URLSearchParams({
    endDate: CONFIG.endDate,
    page: String(page),
    searchTerm: CONFIG.term,
    sortOrder: String(CONFIG.sortOrder),
    startDate: CONFIG.startDate,
  });
  return `${BASE_URL}/search/Debates?${params}`;
}

// --- State file for resumability ---
function stateFilePath() {
  return path.join(CONFIG.outDir, `${safeName(CONFIG.term)}_state.json`);
}

function loadState() {
  const fp = stateFilePath();
  if (fs.existsSync(fp)) {
    try {
      return JSON.parse(fs.readFileSync(fp, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

function saveState(state) {
  fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2), "utf-8");
}

// --- Main ---
async function main() {
  const termDir = path.join(CONFIG.outDir, safeName(CONFIG.term));
  if (!fs.existsSync(termDir)) {
    fs.mkdirSync(termDir, { recursive: true });
  }

  // Load previous state for resumability
  let state = loadState() || {
    term: CONFIG.term,
    status: "in_progress",
    totalResults: null,
    totalPages: null,
    lastCompletedPage: 0,
    results: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
  };

  // If already completed, exit early
  if (state.status === "completed") {
    console.log(`[${CONFIG.term}] Already completed (${state.results.length} results). Skipping.`);
    // Output result summary to stdout for master to parse
    console.log(`__RESULT__${JSON.stringify({ totalResults: state.results.length, totalPages: state.totalPages, status: "completed", resumed: true })}`);
    return;
  }

  const startPage = state.lastCompletedPage + 1;
  console.log(`[${CONFIG.term}] Starting from page ${startPage}`);

  const browser = await puppeteer.launch({ headless: "new" });
  const browserPage = await browser.newPage();
  await browserPage.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  let page = startPage;

  while (true) {
    const url = buildUrl(page);
    console.log(`  [${CONFIG.term}] Fetching page ${page}...`);

    try {
      await browserPage.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    } catch (err) {
      console.error(`  [${CONFIG.term}] Navigation error on page ${page}: ${err.message}`);
      break;
    }

    // Wait for results or "no results"
    try {
      await browserPage.waitForSelector("a.card-calendar, .no-results", { timeout: 15000 });
    } catch {
      console.log(`  [${CONFIG.term}] Timeout — Cloudflare challenge? Retrying in 10s...`);
      await sleep(10000);
      try {
        await browserPage.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
        await browserPage.waitForSelector("a.card-calendar, .no-results", { timeout: 15000 });
      } catch {
        console.log(`  [${CONFIG.term}] Still no results after retry — stopping.`);
        break;
      }
    }

    // Check for "no results"
    const noResults = await browserPage.evaluate(() =>
      document.body.textContent.includes("No results were found for the specified criteria")
    );
    if (noResults) {
      if (page === 1) {
        console.log(`  [${CONFIG.term}] No results found for this term.`);
        state.totalResults = 0;
        state.totalPages = 0;
      } else {
        console.log(`  [${CONFIG.term}] Page ${page}: No more results.`);
      }
      break;
    }

    // Save raw HTML
    const html = await browserPage.content();
    const filename = `${safeName(CONFIG.term)}_Page${page}.html`;
    fs.writeFileSync(path.join(termDir, filename), html, "utf-8");

    // Parse pagination on first fetched page
    if (state.totalPages === null) {
      const pag = await browserPage.evaluate(() => {
        const text = document.body.textContent;
        const m = text.match(/Total\s+results\s+(\d+)\s+\(page\s+\d+\s+of\s+(\d+)\)/);
        return m ? { totalResults: parseInt(m[1]), totalPages: parseInt(m[2]) } : null;
      });
      if (pag) {
        state.totalResults = pag.totalResults;
        state.totalPages = pag.totalPages;
        console.log(`  [${CONFIG.term}] Total results: ${pag.totalResults}, pages: ${pag.totalPages}`);
      }
    }

    // Extract metadata
    const meta = await browserPage.evaluate((pageNum) => {
      const cards = document.querySelectorAll(".search-results .card-list a.card-calendar");
      return Array.from(cards).map((a) => {
        const titleEl = a.querySelector(".primary-info");
        let title = titleEl ? titleEl.textContent.trim() : "";
        title = title.replace(/\(result item \d+\)/g, "").trim();

        const date = a.querySelector(".secondary-info")?.textContent?.trim() || "";
        const chamber = a.querySelector(".indicators-left")?.textContent?.trim() || "";
        const house = a.querySelector(".indicator")?.textContent?.trim() || "";
        const href = a.getAttribute("href") || "";
        const urlMatch = href.match(/\/(Commons|Lords)\/(\d{4}-\d{2}-\d{2})\//i);

        return {
          title,
          date,
          isoDate: urlMatch ? urlMatch[2] : "",
          chamber: chamber || (urlMatch ? urlMatch[1] : ""),
          house,
          relativePath: href,
          fullUrl: "https://hansard.parliament.uk" + href,
          sourcePage: pageNum,
        };
      });
    }, page);

    console.log(`  [${CONFIG.term}] Page ${page}: ${meta.length} entries`);
    state.results.push(...meta);
    state.lastCompletedPage = page;
    saveState(state);

    // Stop at last page
    if (state.totalPages !== null && page >= state.totalPages) {
      console.log(`  [${CONFIG.term}] Reached last page.`);
      break;
    }

    page++;
    await sleep(DELAY_MS);
  }

  await browser.close();

  // Deduplicate
  const seen = new Set();
  state.results = state.results.filter((item) => {
    if (seen.has(item.fullUrl)) return false;
    seen.add(item.fullUrl);
    return true;
  });

  state.status = "completed";
  state.completedAt = new Date().toISOString();
  saveState(state);

  // Also save the structured output JSON
  const outputFile = path.join(CONFIG.outDir, `${safeName(CONFIG.term)}_metadata.json`);
  const output = {
    baseURL: BASE_URL,
    searchTerm: {
      term: CONFIG.term,
      startDate: CONFIG.startDate,
      endDate: CONFIG.endDate,
      totalResults: state.results.length,
      results: state.results,
    },
  };
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf-8");

  // Output result summary for master script to parse
  console.log(`__RESULT__${JSON.stringify({ totalResults: state.results.length, totalPages: state.totalPages, status: "completed", resumed: false })}`);
  console.log(`[${CONFIG.term}] Done. ${state.results.length} unique results.`);
}

main().catch((err) => {
  console.error(`[${CONFIG.term || "unknown"}] Fatal error:`, err);
  process.exit(1);
});
