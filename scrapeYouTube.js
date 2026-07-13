/**
 * YouTube Caption Scraper (single-channel worker)
 *
 * Lists videos from a UK Parliament YouTube channel, filters by AI-related
 * keywords from searchTerms.js (title + description), then fetches captions
 * without downloading video files.
 *
 * Data sources (in order):
 *   1. YouTube Data API v3 — channel uploads playlist + video metadata
 *      Requires env YOUTUBE_API_KEY (free tier: 10,000 units/day)
 *   2. yt-dlp fallback — flat playlist listing when API key is missing
 *
 * Captions:
 *   youtube-transcript npm package (no API key required)
 *
 * Usage:
 *   node scrapeYouTube.js --channel uk_parliament [--startDate 2020-01-01] [--endDate 2026-07-13] [--outDir ./youtube_raw]
 *
 * Setup:
 *   npm install
 *   set YOUTUBE_API_KEY=your_key_here
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { YoutubeTranscript } = require("youtube-transcript");
const {
  getChannelByKey,
  TRANSCRIPT_DELAY_MS,
  API_DELAY_MS,
  MAX_VIDEOS_PER_CHANNEL,
} = require("./youtubeChannels.js");
const searchTermsModule = require("./searchTerms.js");

// --- Parse CLI args ---
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    channel: "uk_parliament",
    startDate: "2020-01-01",
    endDate: "2026-07-13",
    outDir: path.join(__dirname, "youtube_raw"),
    maxVideos: MAX_VIDEOS_PER_CHANNEL,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--channel":
        parsed.channel = args[++i];
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
      case "--maxVideos":
        parsed.maxVideos = parseInt(args[++i], 10) || 0;
        break;
    }
  }
  return parsed;
}

const CONFIG = parseArgs();
const CHANNEL = getChannelByKey(CONFIG.channel);
const API_KEY = process.env.YOUTUBE_API_KEY || "";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- AI keyword list from searchTerms.js ---
function buildKeywordList() {
  const terms = new Set([
    ...(searchTermsModule.SEARCHED_WITH_RESULTS || []).map((t) => t.term),
    ...(searchTermsModule.SEARCHED_ZERO_RESULTS || []),
    ...(searchTermsModule.YET_TO_SEARCH || []),
    ...(searchTermsModule.FAILED || []),
  ]);
  return [...terms].sort((a, b) => b.length - a.length);
}

const KEYWORDS = buildKeywordList();

function termMatches(haystack, term) {
  const lower = term.toLowerCase();
  if (lower.length <= 3) {
    return new RegExp(`\\b${escapeRegex(lower)}\\b`, "i").test(haystack);
  }
  return haystack.includes(lower);
}

function matchKeywords(title, description) {
  const text = `${title || ""}\n${description || ""}`;
  const matched = [];
  for (const term of KEYWORDS) {
    if (termMatches(text, term)) matched.push(term);
  }
  return matched;
}

function inDateRange(isoDate) {
  if (!isoDate) return false;
  const day = isoDate.slice(0, 10);
  return day >= CONFIG.startDate && day <= CONFIG.endDate;
}

function metadataPath(videoId) {
  return path.join(CONFIG.outDir, `${videoId}_metadata.json`);
}

function transcriptPath(videoId) {
  return path.join(CONFIG.outDir, `${videoId}_transcript.txt`);
}

function stateFilePath() {
  return path.join(CONFIG.outDir, `${CONFIG.channel}_state.json`);
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

function initState() {
  return {
    channel: CONFIG.channel,
    channelName: CHANNEL ? CHANNEL.name : CONFIG.channel,
    status: "in_progress",
    startedAt: new Date().toISOString(),
    completedAt: null,
    config: {
      startDate: CONFIG.startDate,
      endDate: CONFIG.endDate,
      outDir: CONFIG.outDir,
    },
    resolvedChannelId: CHANNEL?.channelId || null,
    uploadsPlaylistId: null,
    videosListed: 0,
    videosInRange: 0,
    videosMatched: 0,
    transcriptsSaved: 0,
    skippedNoCaptions: 0,
    skippedNoMatch: 0,
    skippedAlreadyDone: 0,
    errors: [],
    processedVideoIds: [],
    matchedVideoIds: [],
  };
}

// --- YouTube Data API ---
function getYouTubeClient() {
  return google.youtube({ version: "v3", auth: API_KEY });
}

async function resolveChannelId(youtube) {
  if (CHANNEL.channelId) return CHANNEL.channelId;

  if (!API_KEY) {
    throw new Error("YOUTUBE_API_KEY not set and no fallback channelId configured");
  }

  const handlesToTry = [CHANNEL.handle, CHANNEL.handle.toLowerCase()];
  for (const handle of handlesToTry) {
    try {
      const res = await youtube.channels.list({
        part: ["contentDetails", "snippet"],
        forHandle: handle,
      });
      if (res.data.items?.length) {
        return res.data.items[0].id;
      }
    } catch {
      // try next handle variant
    }
  }

  throw new Error(`Could not resolve channel ID for handle @${CHANNEL.handle}`);
}

async function getUploadsPlaylistId(youtube, channelId) {
  const res = await youtube.channels.list({
    part: ["contentDetails"],
    id: [channelId],
  });
  const playlistId = res.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) {
    throw new Error(`No uploads playlist found for channel ${channelId}`);
  }
  return playlistId;
}

async function listVideosViaApi(youtube, playlistId, state) {
  const videos = [];
  let pageToken = state.playlistPageToken || undefined;
  let pagesFetched = 0;

  while (true) {
    const res = await youtube.playlistItems.list({
      part: ["snippet", "contentDetails"],
      playlistId,
      maxResults: 50,
      pageToken,
    });

    const items = res.data.items || [];
    pagesFetched++;

    for (const item of items) {
      const videoId = item.contentDetails?.videoId;
      const publishedAt = item.snippet?.publishedAt || item.contentDetails?.videoPublishedAt;
      if (!videoId) continue;

      videos.push({
        videoId,
        title: item.snippet?.title || "",
        description: item.snippet?.description || "",
        publishedAt,
        channelTitle: item.snippet?.channelTitle || CHANNEL.name,
      });

      // Upload playlists are reverse-chronological; stop once we're before startDate
      if (publishedAt && publishedAt.slice(0, 10) < CONFIG.startDate) {
        state.playlistPageToken = null;
        return videos;
      }
    }

    pageToken = res.data.nextPageToken;
    state.playlistPageToken = pageToken || null;
    saveState(state);

    if (!pageToken) break;
    if (CONFIG.maxVideos > 0 && videos.length >= CONFIG.maxVideos) break;

    await sleep(API_DELAY_MS);
  }

  return videos;
}

async function enrichVideosViaApi(youtube, videos) {
  const enriched = [];
  for (let i = 0; i < videos.length; i += 50) {
    const batch = videos.slice(i, i + 50);
    const ids = batch.map((v) => v.videoId);
    const res = await youtube.videos.list({
      part: ["snippet"],
      id: ids,
    });

    const byId = new Map((res.data.items || []).map((item) => [item.id, item]));
    for (const video of batch) {
      const detail = byId.get(video.videoId);
      enriched.push({
        videoId: video.videoId,
        title: detail?.snippet?.title || video.title,
        description: detail?.snippet?.description || video.description,
        publishedAt: detail?.snippet?.publishedAt || video.publishedAt,
        channelTitle: detail?.snippet?.channelTitle || video.channelTitle,
      });
    }

    if (i + 50 < videos.length) await sleep(API_DELAY_MS);
  }
  return enriched;
}

// --- yt-dlp fallback (no API key) ---
function runCommand(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `Command failed with exit ${code}`));
    });
    child.on("error", (err) => reject(err));
  });
}

async function listVideosViaYtDlp() {
  const url = `${CHANNEL.url}/videos`;
  const args = [
    "--flat-playlist",
    "--print",
    "%(id)s\t%(title)s\t%(upload_date)s\t%(description)s",
    url,
  ];

  let stdout;
  try {
    ({ stdout } = await runCommand("yt-dlp", args));
  } catch (err) {
    if (err.message.includes("ENOENT") || err.message.includes("spawn yt-dlp")) {
      throw new Error("yt-dlp not found on PATH. Install yt-dlp or set YOUTUBE_API_KEY.");
    }
    throw err;
  }

  const videos = [];
  for (const line of stdout.split("\n").filter(Boolean)) {
    const [videoId, title, uploadDate, ...descParts] = line.split("\t");
    if (!videoId) continue;

    let publishedAt = null;
    if (uploadDate && /^\d{8}$/.test(uploadDate)) {
      publishedAt = `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}T00:00:00Z`;
    }

    videos.push({
      videoId,
      title: title || "",
      description: descParts.join("\t") || "",
      publishedAt,
      channelTitle: CHANNEL.name,
    });
  }

  return videos;
}

// --- Transcript fetch ---
async function fetchTranscript(videoId) {
  const attempts = [
  () => YoutubeTranscript.fetchTranscript(videoId, { lang: "en" }),
  () => YoutubeTranscript.fetchTranscript(videoId, { lang: "en-GB" }),
  () => YoutubeTranscript.fetchTranscript(videoId),
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const segments = await attempt();
      if (segments?.length) {
        return segments.map((s) => s.text).join("\n");
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("No captions available");
}

function saveVideoOutputs(video, matchedTerms, transcriptText) {
  const url = `https://www.youtube.com/watch?v=${video.videoId}`;
  const metadata = {
    video_id: video.videoId,
    title: video.title,
    description: video.description,
    published_at: video.publishedAt,
    channel: CHANNEL.name,
    channel_key: CONFIG.channel,
    url,
    matched_terms: matchedTerms,
    scraped_at: new Date().toISOString(),
    has_transcript: Boolean(transcriptText),
  };

  fs.writeFileSync(metadataPath(video.videoId), JSON.stringify(metadata, null, 2), "utf-8");
  if (transcriptText) {
    fs.writeFileSync(transcriptPath(video.videoId), transcriptText, "utf-8");
  }
}

// --- Main ---
async function main() {
  if (!CHANNEL) {
    console.error(`Unknown channel key: ${CONFIG.channel}`);
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.outDir)) {
    fs.mkdirSync(CONFIG.outDir, { recursive: true });
  }

  let state = loadState() || initState();

  if (state.status === "completed") {
    console.log(`[${CHANNEL.name}] Already completed. Skipping.`);
    console.log(
      `__RESULT__${JSON.stringify({
        channel: CONFIG.channel,
        videosListed: state.videosListed,
        videosMatched: state.videosMatched,
        transcriptsSaved: state.transcriptsSaved,
        skippedNoCaptions: state.skippedNoCaptions,
        status: "completed",
        resumed: true,
      })}`
    );
    return;
  }

  console.log(`[${CHANNEL.name}] Listing channel videos (${CONFIG.startDate} to ${CONFIG.endDate})...`);

  let allVideos = [];

  if (API_KEY) {
    console.log(`[${CHANNEL.name}] Using YouTube Data API`);
    const youtube = getYouTubeClient();
    const channelId = state.resolvedChannelId || (await resolveChannelId(youtube));
    state.resolvedChannelId = channelId;

    const playlistId = state.uploadsPlaylistId || (await getUploadsPlaylistId(youtube, channelId));
    state.uploadsPlaylistId = playlistId;
    saveState(state);

    const listed = await listVideosViaApi(youtube, playlistId, state);
    allVideos = await enrichVideosViaApi(youtube, listed);
  } else {
    console.log(`[${CHANNEL.name}] No YOUTUBE_API_KEY — falling back to yt-dlp`);
    allVideos = await listVideosViaYtDlp();
  }

  if (CONFIG.maxVideos > 0) {
    allVideos = allVideos.slice(0, CONFIG.maxVideos);
  }

  state.videosListed = allVideos.length;
  console.log(`[${CHANNEL.name}] Listed ${allVideos.length} videos`);

  const processedSet = new Set(state.processedVideoIds || []);
  let transcriptsSaved = state.transcriptsSaved || 0;
  let skippedNoCaptions = state.skippedNoCaptions || 0;
  let skippedNoMatch = state.skippedNoMatch || 0;
  let skippedAlreadyDone = state.skippedAlreadyDone || 0;
  let videosInRange = 0;
  let videosMatched = 0;

  for (const video of allVideos) {
    if (!inDateRange(video.publishedAt)) continue;
    videosInRange++;

    const matchedTerms = matchKeywords(video.title, video.description);
    if (matchedTerms.length === 0) {
      skippedNoMatch++;
      continue;
    }

    videosMatched++;

    if (processedSet.has(video.videoId)) {
      skippedAlreadyDone++;
      continue;
    }

    if (fs.existsSync(metadataPath(video.videoId)) && fs.existsSync(transcriptPath(video.videoId))) {
      processedSet.add(video.videoId);
      skippedAlreadyDone++;
      continue;
    }

    console.log(
      `  [${CHANNEL.name}] ${video.videoId} — "${video.title.substring(0, 70)}..." (${matchedTerms.length} terms)`
    );

    try {
      const transcriptText = await fetchTranscript(video.videoId);
      saveVideoOutputs(video, matchedTerms, transcriptText);
      transcriptsSaved++;
      processedSet.add(video.videoId);
      if (!state.matchedVideoIds.includes(video.videoId)) {
        state.matchedVideoIds.push(video.videoId);
      }
      console.log(`    Saved transcript (${transcriptText.length} chars)`);
    } catch (err) {
      skippedNoCaptions++;
      saveVideoOutputs(video, matchedTerms, null);
      processedSet.add(video.videoId);
      const msg = err.message || String(err);
      console.log(`    No captions — skipped (${msg.substring(0, 80)})`);
      state.errors.push({ videoId: video.videoId, error: msg, at: new Date().toISOString() });
    }

    state.processedVideoIds = [...processedSet];
    state.transcriptsSaved = transcriptsSaved;
    state.skippedNoCaptions = skippedNoCaptions;
    state.skippedNoMatch = skippedNoMatch;
    state.skippedAlreadyDone = skippedAlreadyDone;
    state.videosInRange = videosInRange;
    state.videosMatched = videosMatched;
    saveState(state);

    await sleep(TRANSCRIPT_DELAY_MS);
  }

  state.status = "completed";
  state.completedAt = new Date().toISOString();
  state.videosInRange = videosInRange;
  state.videosMatched = videosMatched;
  state.transcriptsSaved = transcriptsSaved;
  state.skippedNoCaptions = skippedNoCaptions;
  state.skippedNoMatch = skippedNoMatch;
  state.skippedAlreadyDone = skippedAlreadyDone;
  saveState(state);

  console.log(
    `__RESULT__${JSON.stringify({
      channel: CONFIG.channel,
      videosListed: state.videosListed,
      videosInRange,
      videosMatched,
      transcriptsSaved,
      skippedNoCaptions,
      skippedNoMatch,
      status: "completed",
      resumed: false,
    })}`
  );

  console.log(
    `[${CHANNEL.name}] Done. ${videosMatched} matched, ${transcriptsSaved} transcripts saved, ${skippedNoCaptions} without captions.`
  );
}

main().catch((err) => {
  console.error(`[${CHANNEL?.name || CONFIG.channel}] Fatal error:`, err.message || err);
  process.exit(1);
});
