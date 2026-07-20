/**
 * Step 3: Rebuild media_statements/media_statements_all.csv from raw/*.json
 *
 * Append-safe: reads every raw politician file under outDir/raw/, dedupes by
 * (politician + URL), and writes a single CSV with the same schema as
 * fetchMediaStatements.js:
 *   politician, party, date, source, headline, URL, text
 *
 * Usage:
 *   node mergeMediaStatements.js
 *   node mergeMediaStatements.js --outDir ./media_statements
 *   node mergeMediaStatements.js --report
 */

const fs = require("fs");
const path = require("path");

const CSV_HEADERS = ["politician", "party", "date", "source", "headline", "URL", "text"];

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    outDir: path.join(__dirname, "media_statements"),
    report: false,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--outDir":
        parsed.outDir = path.resolve(args[++i]);
        break;
      case "--report":
        parsed.report = true;
        break;
      case "--help":
      case "-h":
        console.log(`Usage: node mergeMediaStatements.js [--outDir PATH] [--report]`);
        process.exit(0);
        break;
    }
  }
  return parsed;
}

function escapeCSV(val) {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildCSV(rows) {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        escapeCSV(row.politician),
        escapeCSV(row.party),
        escapeCSV(row.date),
        escapeCSV(row.source),
        escapeCSV(row.headline),
        escapeCSV(row.URL),
        escapeCSV(row.text),
      ].join(",")
    );
  }
  return lines.join("\n");
}

function normalizeUrl(url) {
  try {
    const u = new URL(String(url || "").trim());
    u.hash = "";
    // drop tracking params that differ across search providers
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((k) =>
      u.searchParams.delete(k)
    );
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return String(url || "")
      .trim()
      .toLowerCase();
  }
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.politician || ""}||${normalizeUrl(row.URL || "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function countCsvRows(csvPath) {
  if (!fs.existsSync(csvPath)) return 0;
  const text = fs.readFileSync(csvPath, "utf8");
  if (!text.trim()) return 0;
  // Rough line count minus header; quoted newlines make this imperfect,
  // so we prefer raw-file totals for the authoritative after-count.
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  return Math.max(0, lines.length - 1);
}

function main() {
  const config = parseArgs();
  const rawDir = path.join(config.outDir, "raw");
  const csvPath = path.join(config.outDir, "media_statements_all.csv");

  if (!fs.existsSync(rawDir)) {
    throw new Error(`Raw directory not found: ${rawDir}`);
  }

  const beforeRows = countCsvRows(csvPath);
  const files = fs
    .readdirSync(rawDir)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .sort();

  const allRows = [];
  const perPolitician = [];

  for (const file of files) {
    const fp = path.join(rawDir, file);
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(fp, "utf8"));
    } catch (err) {
      console.warn(`Skipping corrupt file ${file}: ${err.message}`);
      continue;
    }
    const articles = Array.isArray(saved.articles) ? saved.articles : [];
    const name =
      (saved.politician && saved.politician.name) ||
      (articles[0] && articles[0].politician) ||
      file.replace(/\.json$/i, "");
    perPolitician.push({ file, name, articles: articles.length });
    for (const row of articles) {
      allRows.push({
        politician: row.politician || name,
        party: row.party || (saved.politician && saved.politician.party) || "",
        date: row.date || "",
        source: row.source || "",
        headline: row.headline || "",
        URL: row.URL || row.url || "",
        text: row.text || "",
      });
    }
  }

  const unique = dedupeRows(allRows);
  fs.writeFileSync(csvPath, buildCSV(unique), "utf8");

  const politiciansCovered = new Set(unique.map((r) => r.politician).filter(Boolean));

  console.log("=== Merge media_statements_all.csv ===");
  console.log(`Raw files:           ${files.length}`);
  console.log(`Rows before (approx): ${beforeRows}`);
  console.log(`Rows after (deduped): ${unique.length}`);
  console.log(`Delta (approx):      ${unique.length - beforeRows}`);
  console.log(`Politicians covered: ${politiciansCovered.size}`);
  console.log(`Wrote: ${csvPath}`);

  if (config.report) {
    const reportPath = path.join(config.outDir, "merge_report.json");
    const report = {
      mergedAt: new Date().toISOString(),
      rawFiles: files.length,
      rowsBeforeApprox: beforeRows,
      rowsAfter: unique.length,
      politiciansCovered: politiciansCovered.size,
      perPolitician: perPolitician.sort((a, b) => b.articles - a.articles),
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`Report: ${reportPath}`);
  }
}

main();
