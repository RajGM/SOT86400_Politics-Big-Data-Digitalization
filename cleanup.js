/**
 * Cleanup Script
 *
 * Reads master_state.json, removes folders and metadata files for terms
 * with 0 results, and updates searchTerms.js with categorized terms.
 *
 * Usage:  node cleanup.js [--outDir ./hansard_raw] [--dryRun]
 */

const fs = require("fs");
const path = require("path");

// --- Parse CLI args ---
const args = process.argv.slice(2);
let outDir = path.join(__dirname, "hansard_raw");
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--outDir") outDir = args[++i];
  if (args[i] === "--dryRun") dryRun = true;
}

const STATE_FILE = path.join(outDir, "master_state.json");
const TERMS_FILE = path.join(__dirname, "searchTerms.js");

function safeName(term) {
  return term.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach((f) => fs.unlinkSync(path.join(dir, f)));
  fs.rmdirSync(dir);
}

function main() {
  if (!fs.existsSync(STATE_FILE)) {
    console.error(`master_state.json not found at ${STATE_FILE}`);
    process.exit(1);
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));

  const withResults = [];
  const zeroResults = [];
  const failed = [];
  const pending = [];

  for (const t of state.terms) {
    if (t.status === "completed" && (t.totalResults || 0) > 0) {
      withResults.push(t);
    } else if (t.status === "completed" && (t.totalResults || 0) === 0) {
      zeroResults.push(t);
    } else if (t.status === "failed") {
      failed.push(t);
    } else {
      pending.push(t);
    }
  }

  console.log(`Terms with results:    ${withResults.length}`);
  console.log(`Terms with 0 results:  ${zeroResults.length}`);
  console.log(`Terms failed:          ${failed.length}`);
  console.log(`Terms pending:         ${pending.length}`);

  // --- Delete folders and files for zero-result terms ---
  let deletedFolders = 0;
  let deletedFiles = 0;

  for (const t of zeroResults) {
    const sn = safeName(t.term);

    // Remove term subfolder (e.g., hansard_raw/ai_regulation/)
    const termDir = path.join(outDir, sn);
    if (fs.existsSync(termDir)) {
      if (dryRun) {
        console.log(`  [dry-run] Would delete folder: ${termDir}`);
      } else {
        rmDir(termDir);
        deletedFolders++;
      }
    }

    // Remove metadata file
    const metaFile = path.join(outDir, `${sn}_metadata.json`);
    if (fs.existsSync(metaFile)) {
      if (dryRun) {
        console.log(`  [dry-run] Would delete file: ${metaFile}`);
      } else {
        fs.unlinkSync(metaFile);
        deletedFiles++;
      }
    }

    // Remove state file
    const stateFile = path.join(outDir, `${sn}_state.json`);
    if (fs.existsSync(stateFile)) {
      if (dryRun) {
        console.log(`  [dry-run] Would delete file: ${stateFile}`);
      } else {
        fs.unlinkSync(stateFile);
        deletedFiles++;
      }
    }
  }

  // Also clean up failed terms' empty folders
  for (const t of failed) {
    const sn = safeName(t.term);
    const termDir = path.join(outDir, sn);
    if (fs.existsSync(termDir)) {
      const files = fs.readdirSync(termDir);
      if (files.length === 0) {
        if (!dryRun) { fs.rmdirSync(termDir); deletedFolders++; }
      }
    }
  }

  console.log(`\nDeleted ${deletedFolders} folders, ${deletedFiles} files.`);

  // --- Update searchTerms.js ---
  // Sort results by count descending
  withResults.sort((a, b) => (b.totalResults || 0) - (a.totalResults || 0));
  zeroResults.sort((a, b) => a.term.localeCompare(b.term));
  failed.sort((a, b) => a.term.localeCompare(b.term));
  pending.sort((a, b) => a.term.localeCompare(b.term));

  const lines = [];
  lines.push(`/**`);
  lines.push(` * Search terms for Hansard debate scraping.`);
  lines.push(` *`);
  lines.push(` * Auto-updated by cleanup.js on ${new Date().toISOString()}`);
  lines.push(` *`);
  lines.push(` * Structure:`);
  lines.push(` *   SEARCHED_WITH_RESULTS  — already scraped, had results (do not re-scrape)`);
  lines.push(` *   SEARCHED_ZERO_RESULTS  — already scraped, 0 results (do not re-scrape)`);
  lines.push(` *   YET_TO_SEARCH          — new terms to scrape next run`);
  lines.push(` *`);
  lines.push(` * To add new terms: append them to YET_TO_SEARCH.`);
  lines.push(` * The master script only scrapes YET_TO_SEARCH terms.`);
  lines.push(` */`);
  lines.push(``);

  // SEARCHED_WITH_RESULTS
  lines.push(`// --- SEARCHED: Had results (${withResults.length} terms) ---`);
  lines.push(`const SEARCHED_WITH_RESULTS = [`);
  for (const t of withResults) {
    lines.push(`  { term: ${JSON.stringify(t.term)}, results: ${t.totalResults}, pages: ${t.totalPages} },`);
  }
  lines.push(`];`);
  lines.push(``);

  // SEARCHED_ZERO_RESULTS
  lines.push(`// --- SEARCHED: Zero results (${zeroResults.length} terms) ---`);
  lines.push(`const SEARCHED_ZERO_RESULTS = [`);
  for (const t of zeroResults) {
    lines.push(`  ${JSON.stringify(t.term)},`);
  }
  lines.push(`];`);
  lines.push(``);

  // FAILED
  if (failed.length > 0) {
    lines.push(`// --- FAILED: Need retry (${failed.length} terms) ---`);
    lines.push(`const FAILED = [`);
    for (const t of failed) {
      lines.push(`  ${JSON.stringify(t.term)}, // ${t.error || "unknown error"}`);
    }
    lines.push(`];`);
    lines.push(``);
  } else {
    lines.push(`const FAILED = [];`);
    lines.push(``);
  }

  // YET_TO_SEARCH
  lines.push(`// --- YET TO SEARCH: Add new terms here ---`);
  lines.push(`const YET_TO_SEARCH = [`);
  for (const t of pending) {
    lines.push(`  ${JSON.stringify(t.term)},`);
  }
  lines.push(`];`);
  lines.push(``);

  // Exports
  lines.push(`// Master script uses this — only scrapes terms not yet searched`);
  lines.push(`const ALL_SEARCHED = [`);
  lines.push(`  ...SEARCHED_WITH_RESULTS.map((t) => t.term),`);
  lines.push(`  ...SEARCHED_ZERO_RESULTS,`);
  lines.push(`];`);
  lines.push(``);
  lines.push(`// Terms to scrape on next run`);
  lines.push(`const SEARCH_TERMS = [...YET_TO_SEARCH, ...FAILED];`);
  lines.push(``);
  lines.push(`module.exports = SEARCH_TERMS;`);
  lines.push(`module.exports.SEARCHED_WITH_RESULTS = SEARCHED_WITH_RESULTS;`);
  lines.push(`module.exports.SEARCHED_ZERO_RESULTS = SEARCHED_ZERO_RESULTS;`);
  lines.push(`module.exports.YET_TO_SEARCH = YET_TO_SEARCH;`);
  lines.push(`module.exports.FAILED = FAILED;`);
  lines.push(`module.exports.ALL_SEARCHED = ALL_SEARCHED;`);
  lines.push(``);

  const content = lines.join("\n");

  if (dryRun) {
    console.log(`\n[dry-run] Would write searchTerms.js (${content.length} chars)`);
  } else {
    fs.writeFileSync(TERMS_FILE, content, "utf-8");
    console.log(`\nUpdated ${TERMS_FILE}`);
  }

  console.log("\nDone.");
}

main();
