/**
 * Master Dataset 2 media expansion orchestrator
 *
 * Runs the full 3-step pipeline end-to-end:
 *   1. extractTopSpeakers.js
 *   2. fetchMediaStatements.js (--from speakers_to_search.json --onlyNew)
 *   3. mergeMediaStatements.js (--report)
 *
 * Usage:
 *   node masterMediaExpansion.js
 *   node masterMediaExpansion.js --top 40 --provider openai --delay 2000
 *   node masterMediaExpansion.js --limit 30
 *   node masterMediaExpansion.js --skip-fetch          # extract + merge only
 *   node masterMediaExpansion.js --skip-extract        # fetch + merge only
 *   node masterMediaExpansion.js --dry-run
 *   npm run media:expand
 *
 * See MEDIA_EXPANSION.md for details.
 */

const { spawn } = require("child_process");
const path = require("path");

const ROOT = __dirname;
const SPEAKERS_FILE = path.join(ROOT, "media_statements", "speakers_to_search.json");

const SCRIPTS = {
  extract: path.join(ROOT, "extractTopSpeakers.js"),
  fetch: path.join(ROOT, "fetchMediaStatements.js"),
  merge: path.join(ROOT, "mergeMediaStatements.js"),
};

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    top: 40,
    limit: null,
    delay: null,
    provider: "openai",
    force: false,
    skipFetch: false,
    skipExtract: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--top":
        parsed.top = Math.max(1, parseInt(args[++i], 10) || 40);
        break;
      case "--limit":
        parsed.limit = parseInt(args[++i], 10);
        break;
      case "--delay":
        parsed.delay = parseInt(args[++i], 10);
        break;
      case "--provider":
        parsed.provider = String(args[++i] || "").toLowerCase();
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--skip-fetch":
        parsed.skipFetch = true;
        break;
      case "--skip-extract":
        parsed.skipExtract = true;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown flag: ${args[i]}`);
        printHelp();
        process.exit(1);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node masterMediaExpansion.js [options]

Runs Dataset 2 media expansion end-to-end (extract → fetch → merge).

Options:
  --top N            Speakers to extract (default 40)
  --limit N          Cap politicians processed in fetch step
  --delay MS         Delay between fetch API calls
  --provider NAME    Search provider (default openai)
  --force            Re-run fetch ignoring prior state
  --skip-fetch       Run extract + merge only (no OpenAI/search)
  --skip-extract     Run fetch + merge only (reuse speakers_to_search.json)
  --dry-run          Print steps/commands without executing
  --help             Show this help

Examples:
  npm run media:expand
  node masterMediaExpansion.js --top 40 --limit 30 --delay 2000
  node masterMediaExpansion.js --skip-fetch
`);
}

function runNode(scriptPath, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, ...scriptArgs], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

function buildSteps(config) {
  const steps = [];

  if (!config.skipExtract) {
    steps.push({
      label: "Extract top unsearched speakers",
      script: SCRIPTS.extract,
      args: ["--top", String(config.top)],
    });
  }

  if (!config.skipFetch) {
    const fetchArgs = [
      "--from",
      SPEAKERS_FILE,
      "--onlyNew",
      "--provider",
      config.provider,
    ];
    if (config.limit != null && !Number.isNaN(config.limit)) {
      fetchArgs.push("--limit", String(config.limit));
    }
    if (config.delay != null && !Number.isNaN(config.delay)) {
      fetchArgs.push("--delay", String(config.delay));
    }
    if (config.force) {
      fetchArgs.push("--force");
    }
    steps.push({
      label: "Fetch media statements (onlyNew)",
      script: SCRIPTS.fetch,
      args: fetchArgs,
    });
  }

  steps.push({
    label: "Merge raw JSON → master CSV",
    script: SCRIPTS.merge,
    args: ["--report"],
  });

  return steps;
}

async function main() {
  const config = parseArgs();
  const steps = buildSteps(config);
  const total = steps.length;

  console.log("=".repeat(60));
  console.log("Dataset 2 media expansion — master pipeline");
  console.log("=".repeat(60));
  console.log(`Steps planned: ${total}`);
  if (config.skipExtract) console.log("  (skipping extract)");
  if (config.skipFetch) console.log("  (skipping fetch)");
  if (config.dryRun) console.log("  DRY RUN — commands will not execute");
  console.log("");

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const n = i + 1;
    const cmd = `node ${path.basename(step.script)} ${step.args.join(" ")}`;

    console.log("-".repeat(60));
    console.log(`Step ${n}/${total}: ${step.label}`);
    console.log(`  → ${cmd}`);
    console.log("-".repeat(60));

    if (config.dryRun) {
      console.log("(dry-run) skipped\n");
      continue;
    }

    const started = Date.now();
    try {
      await runNode(step.script, step.args);
    } catch (err) {
      console.error(`\nStep ${n}/${total} FAILED: ${err.message}`);
      process.exit(1);
    }
    console.log(`Step ${n}/${total} done in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  }

  console.log("=".repeat(60));
  console.log(config.dryRun ? "Dry run complete." : "Media expansion pipeline finished.");
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Master fatal error:", err);
  process.exit(1);
});
