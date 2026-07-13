/**
 * Hansard Debate Scraper
 *
 * Scrapes UK Parliament Hansard search results for "artificial intelligence".
 * Uses Puppeteer to handle Cloudflare protection.
 *
 * Setup:  npm install puppeteer
 * Run:    node scrapeHansard.js
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

// --- Config ---
const BASE_URL = "https://hansard.parliament.uk";
const SEARCH_TERM = "artificial intelligence";
const START_DATE = "2020-01-01";
const END_DATE = "2026-07-13";
const SORT_ORDER = 1;
const OUTPUT_DIR = path.join(__dirname, "hansard_raw");
const META_FILE = path.join(__dirname, "hansard_metadata.json");
const DELAY_MS = 3000; // polite delay between pages

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildUrl(page) {
  const params = new URLSearchParams({
    endDate: END_DATE,
    page: String(page),
    searchTerm: SEARCH_TERM,
    sortOrder: String(SORT_ORDER),
    startDate: START_DATE,
  });
  return `https://hansard.parliament.uk/search/Debates?${params}`;
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({ headless: "new" });
  const browserPage = await browser.newPage();
  await browserPage.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  const allMetadata = [];
  let totalPages = null;
  let page = 1;

  while (true) {
    const url = buildUrl(page);
    console.log(`\nFetching page ${page}: ${url}`);

    await browserPage.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Wait for results or "no results" message to appear
    try {
      await browserPage.waitForSelector("a.card-calendar, .no-results", { timeout: 15000 });
    } catch {
      console.log("  Timeout waiting for results — may be Cloudflare challenge. Retrying in 10s...");
      await sleep(10000);
      await browserPage.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      try {
        await browserPage.waitForSelector("a.card-calendar, .no-results", { timeout: 15000 });
      } catch {
        console.log("  Still no results after retry — stopping.");
        break;
      }
    }

    // Check for "no results"
    const noResults = await browserPage.evaluate(() =>
      document.body.textContent.includes("No results were found for the specified criteria")
    );
    if (noResults) {
      console.log(`  Page ${page}: No results — stopping.`);
      break;
    }

    // Save raw HTML
    const html = await browserPage.content();
    const safeSearchTerm = SEARCH_TERM.replace(/\s+/g, "_");
    const filename = `${safeSearchTerm}_Page${page}.html`;
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), html, "utf-8");
    console.log(`  Saved ${filename}`);

    // Parse pagination on first page
    if (totalPages === null) {
      const pag = await browserPage.evaluate(() => {
        const text = document.body.textContent;
        const m = text.match(/Total\s+results\s+(\d+)\s+\(page\s+\d+\s+of\s+(\d+)\)/);
        return m ? { totalResults: parseInt(m[1]), totalPages: parseInt(m[2]) } : null;
      });
      if (pag) {
        totalPages = pag.totalPages;
        console.log(`  Total results: ${pag.totalResults}, Total pages: ${pag.totalPages}`);
      } else {
        console.log("  Warning: could not parse pagination info");
      }
    }

    // Extract metadata from cards inside .card-list under .search-results
    const meta = await browserPage.evaluate((pageNum) => {
      const cards = document.querySelectorAll(".search-results .card-list a.card-calendar");
      return Array.from(cards).map((a, i) => {
        const titleEl = a.querySelector(".primary-info");
        let title = titleEl ? titleEl.textContent.trim() : "";
        title = title.replace(/\(result item \d+\)/g, "").trim();

        const date = a.querySelector(".secondary-info")?.textContent?.trim() || "";
        const chamber = a.querySelector(".indicators-left")?.textContent?.trim() || "";
        const house = a.querySelector(".indicator")?.textContent?.trim() || "";
        const href = a.getAttribute("href") || "";

        // Extract chamber type and ISO date from the relative path
        // e.g. /Lords/2026-07-09/debates/5808F59B-.../ArtificialIntelligenceVaccineTechnology
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

    console.log(`  Extracted ${meta.length} entries`);
    allMetadata.push(...meta);

    // Stop at last page
    if (totalPages !== null && page >= totalPages) {
      console.log("\nReached last page.");
      break;
    }

    page++;
    await sleep(DELAY_MS);
  }

  await browser.close();

  // Deduplicate by fullUrl
  const seen = new Set();
  const unique = allMetadata.filter((item) => {
    if (seen.has(item.fullUrl)) return false;
    seen.add(item.fullUrl);
    return true;
  });

  // Build structured output
  const output = {
    baseURL: BASE_URL,
    searchTerm: {
      term: SEARCH_TERM,
      startDate: START_DATE,
      endDate: END_DATE,
      totalResults: unique.length,
      results: unique.map((item) => ({
        title: item.title,
        date: item.date,
        isoDate: item.isoDate,
        chamber: item.chamber,
        house: item.house,
        relativePath: item.relativePath,
        fullUrl: item.fullUrl,
        sourcePage: item.sourcePage,
      })),
    },
  };

  // Save metadata
  fs.writeFileSync(META_FILE, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\nDone. ${unique.length} unique entries saved to ${META_FILE}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
