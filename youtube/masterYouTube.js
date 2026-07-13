/**
 * Master YouTube Scraper Orchestrator
 *
 * Runs scrapeYouTube.js for each configured UK Parliament channel.
 * Tracks progress in youtube/youtube_raw/master_state.json. Fully resumable.
 *
 * Usage:
 *   node youtube/masterYouTube.js [--startDate 2020-01-01] [--endDate 2026-07-13] [--outDir ./youtube/youtube_raw] [--channel uk_parliament] [--concurrency 1]
 *   npm run youtube
 *
 * Environment:
 *   YOUTUBE_API_KEY + YOUTUBE_USE_API=1 — optional official YouTube Data API v3
 *   Default listing uses youtubei.js (no API key). Falls back to yt-dlp if needed.
 *
 * Setup:
 *   npm install
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { CHANNELS, getChannelByKey } = require("./youtubeChannels.js");

// --- Parse CLI args ---
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    startDate: "2020-01-01",
    endDate: "2026-07-13",
    outDir: path.join(__dirname, "youtube_raw"),
    channel: null, // null = all channels
    concurrency: 1,
    maxVideos: 0,
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
      case "--channel":
        parsed.channel = args[++i];
        break;
      case "--concurrency":
        parsed.concurrency = parseInt(args[++i], 10) || 1;
        break;
      case "--maxVideos":
        parsed.maxVideos = parseInt(args[++i], 10) || 0;
        break;
    }
  }
  return parsed;
}

const CONFIG = parseArgs();
const STATE_FILE = path.join(CONFIG.outDir, "master_state.json");
const SCRAPER_SCRIPT = path.join(__dirname, "scrapeYouTube.js");

function getTargetChannels() {
  if (CONFIG.channel) {
    const ch = getChannelByKey(CONFIG.channel);
    if (!ch) {
      console.error(`Unknown channel: ${CONFIG.channel}`);
      console.error(`Valid keys: ${CHANNELS.map((c) => c.key).join(", ")}`);
      process.exit(1);
    }
    return [ch];
  }
  return CHANNELS;
}

const TARGET_CHANNELS = getTargetChannels();

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
      channelFilter: CONFIG.channel,
      maxVideos: CONFIG.maxVideos,
    },
    summary: {
      totalChannels: TARGET_CHANNELS.length,
      completed: 0,
      failed: 0,
      pending: TARGET_CHANNELS.length,
      totalVideosListed: 0,
      totalVideosMatched: 0,
      totalTranscriptsSaved: 0,
      totalSkippedNoCaptions: 0,
      totalTimeMs: 0,
    },
    channels: TARGET_CHANNELS.map((ch) => ({
      key: ch.key,
      name: ch.name,
      status: "pending",
      videosListed: null,
      videosMatched: null,
      transcriptsSaved: null,
      skippedNoCaptions: null,
      timeMs: null,
      startedAt: null,
      completedAt: null,
      error: null,
    })),
  };
}

function mergeMasterState(saved) {
  const existing = new Map((saved.channels || []).map((c) => [c.key, c]));

  const channels = TARGET_CHANNELS.map((ch) => {
    if (existing.has(ch.key)) return existing.get(ch.key);
    return {
      key: ch.key,
      name: ch.name,
      status: "pending",
      videosListed: null,
      videosMatched: null,
      transcriptsSaved: null,
      skippedNoCaptions: null,
      timeMs: null,
      startedAt: null,
      completedAt: null,
      error: null,
    };
  });

  saved.channels = channels;
  saved.summary.totalChannels = channels.length;
  saved.summary.pending = channels.filter((c) => c.status === "pending" || c.status === "in_progress").length;
  saved.summary.completed = channels.filter((c) => c.status === "completed").length;
  saved.summary.failed = channels.filter((c) => c.status === "failed").length;
  saved.lastUpdated = new Date().toISOString();
  return saved;
}

// --- Run a single channel scraper ---
function runScraper(channelKey) {
  return new Promise((resolve) => {
    const args = [
      SCRAPER_SCRIPT,
      "--channel",
      channelKey,
      "--startDate",
      CONFIG.startDate,
      "--endDate",
      CONFIG.endDate,
      "--outDir",
      CONFIG.outDir,
    ];

    if (CONFIG.maxVideos > 0) {
      args.push("--maxVideos", String(CONFIG.maxVideos));
    }

    let stdout = "";
    let stderr = "";

    const child = spawn("node", args, { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      text
        .split("\n")
        .filter(Boolean)
        .forEach((line) => {
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
      const resultMatch = stdout.match(/__RESULT__(.+)/);
      if (resultMatch) {
        try {
          result = JSON.parse(resultMatch[1]);
        } catch {
          // ignore parse errors
        }
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

  if (!process.env.YOUTUBE_USE_API) {
    console.log("Using no-API-key mode (youtubei.js). Set YOUTUBE_USE_API=1 to use the official API.\n");
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

  const pending = state.channels.filter((c) => c.status === "pending" || c.status === "in_progress");
  console.log(`\n${pending.length} channels remaining out of ${state.channels.length} total.\n`);

  if (pending.length === 0) {
    console.log("All channels already completed!");
    printSummary(state);
    return;
  }

  const masterStart = Date.now();
  let completedCount = 0;

  async function processChannel(channelEntry) {
    const idx = state.channels.findIndex((c) => c.key === channelEntry.key);
    completedCount++;
    const label = `[${completedCount}/${pending.length}]`;

    console.log(`${label} Starting channel: ${channelEntry.name} (${channelEntry.key})`);

    state.channels[idx].status = "in_progress";
    state.channels[idx].startedAt = new Date().toISOString();
    saveMasterState(state);

    const channelStart = Date.now();
    const { code, result, stderr } = await runScraper(channelEntry.key);
    const elapsed = Date.now() - channelStart;

    if (code === 0 && result) {
      state.channels[idx].status = "completed";
      state.channels[idx].videosListed = result.videosListed || 0;
      state.channels[idx].videosMatched = result.videosMatched || 0;
      state.channels[idx].transcriptsSaved = result.transcriptsSaved || 0;
      state.channels[idx].skippedNoCaptions = result.skippedNoCaptions || 0;
      state.channels[idx].timeMs = elapsed;
      state.channels[idx].completedAt = new Date().toISOString();
      state.channels[idx].error = null;

      state.summary.completed++;
      state.summary.pending--;
      state.summary.totalVideosListed += result.videosListed || 0;
      state.summary.totalVideosMatched += result.videosMatched || 0;
      state.summary.totalTranscriptsSaved += result.transcriptsSaved || 0;
      state.summary.totalSkippedNoCaptions += result.skippedNoCaptions || 0;

      console.log(
        `${label} Done: ${channelEntry.name} — ${result.videosMatched} matched, ${result.transcriptsSaved} transcripts (${(elapsed / 1000).toFixed(1)}s)`
      );
    } else {
      state.channels[idx].status = "failed";
      state.channels[idx].timeMs = elapsed;
      state.channels[idx].completedAt = new Date().toISOString();
      state.channels[idx].error = stderr || `Exit code ${code}`;

      state.summary.failed++;
      state.summary.pending--;

      console.log(`${label} FAILED: ${channelEntry.name} (exit ${code}) in ${(elapsed / 1000).toFixed(1)}s`);
      if (stderr) console.log(`  Error: ${stderr.substring(0, 200)}`);
    }

    state.summary.totalTimeMs = Date.now() - masterStart;
    state.lastUpdated = new Date().toISOString();
    saveMasterState(state);
  }

  const queue = [...pending];

  async function worker() {
    while (queue.length > 0) {
      const channelEntry = queue.shift();
      if (!channelEntry) break;
      await processChannel(channelEntry);
      if (queue.length > 0) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  const workers = [];
  for (let w = 0; w < CONFIG.concurrency; w++) {
    workers.push(worker());
    if (w < CONFIG.concurrency - 1) {
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
  console.log("YOUTUBE MASTER SCRAPE SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`Total channels:      ${state.summary.totalChannels}`);
  console.log(`Completed:           ${state.summary.completed}`);
  console.log(`Failed:              ${state.summary.failed}`);
  console.log(`Videos listed:       ${state.summary.totalVideosListed}`);
  console.log(`Videos matched:      ${state.summary.totalVideosMatched}`);
  console.log(`Transcripts saved:   ${state.summary.totalTranscriptsSaved}`);
  console.log(`No captions:         ${state.summary.totalSkippedNoCaptions}`);
  console.log(`Total time:          ${(state.summary.totalTimeMs / 1000 / 60).toFixed(1)} minutes`);

  const failed = state.channels.filter((c) => c.status === "failed");
  if (failed.length > 0) {
    console.log("\nFailed channels:");
    failed.forEach((c) => console.log(`  - ${c.name}: ${c.error}`));
  }

  console.log(`\nState saved to: ${STATE_FILE}`);
}

main().catch((err) => {
  console.error("Master fatal error:", err);
  process.exit(1);
});
