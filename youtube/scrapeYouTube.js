/**
 * YouTube Caption Scraper (single-channel worker)
 *
 * Lists videos from a UK Parliament YouTube channel, filters by AI-related
 * keywords from searchTerms.js (title + description), then fetches captions
 * without downloading video files.
 *
 * Data sources (in order):
 *   1. youtubei.js (InnerTube) — channel uploads, no API key (default)
 *   2. yt-dlp — flat playlist listing if InnerTube fails
 *   3. YouTube Data API v3 — optional when YOUTUBE_API_KEY + YOUTUBE_USE_API=1
 *
 * Captions:
 *   youtube-transcript npm package (no API key required)
 *
 * Usage:
 *   node youtube/scrapeYouTube.js --channel uk_parliament [--startDate 2020-01-01] [--endDate 2026-07-13] [--outDir ./youtube/youtube_raw]
 *   npm run youtube:channel -- --channel uk_parliament
 *
 * Setup:
 *   npm install
 *   (optional) set YOUTUBE_API_KEY=... and YOUTUBE_USE_API=1 for official API
 *   (optional fallback) install yt-dlp: https://github.com/yt-dlp/yt-dlp#installation
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { Innertube } = require("youtubei.js");
const { YoutubeTranscript } = require("youtube-transcript");
const {
  getChannelByKey,
  TRANSCRIPT_DELAY_MS,
  API_DELAY_MS,
  INNER_TUBE_DELAY_MS,
  MAX_VIDEOS_PER_CHANNEL,
} = require("./youtubeChannels.js");
const searchTermsModule = require("../searchTerms.js");

const YT_DLP_INSTALL_HELP = [
  "yt-dlp is not installed or not on PATH.",
  "Install options:",
  "  Windows: winget install yt-dlp   OR   pip install yt-dlp",
  "  macOS:   brew install yt-dlp       OR   pip install yt-dlp",
  "  Linux:   pip install yt-dlp        OR   see https://github.com/yt-dlp/yt-dlp#installation",
].join("\n");

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
const USE_OFFICIAL_API = API_KEY && ["1", "true", "yes"].includes(String(process.env.YOUTUBE_USE_API || "").toLowerCase());

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

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text;
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return null;
}

function parseRelativeDate(text, refDate = new Date()) {
  if (!text) return null;
  const trimmed = text.trim();
  const absolute = toIsoDate(trimmed);
  if (absolute && !/\bago\b/i.test(trimmed)) return absolute;

  const match = trimmed.toLowerCase().match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return null;

  const amount = parseInt(match[1], 10);
  const unit = match[2];
  const date = new Date(refDate);

  switch (unit) {
    case "second":
      date.setSeconds(date.getSeconds() - amount);
      break;
    case "minute":
      date.setMinutes(date.getMinutes() - amount);
      break;
    case "hour":
      date.setHours(date.getHours() - amount);
      break;
    case "day":
      date.setDate(date.getDate() - amount);
      break;
    case "week":
      date.setDate(date.getDate() - amount * 7);
      break;
    case "month":
      date.setMonth(date.getMonth() - amount);
      break;
    case "year":
      date.setFullYear(date.getFullYear() - amount);
      break;
    default:
      return null;
  }

  return date.toISOString();
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
    listingMethod: null,
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

function normalizeVideo(raw) {
  return {
    videoId: raw.videoId,
    title: raw.title || "",
    description: raw.description || "",
    publishedAt: toIsoDate(raw.publishedAt),
    channelTitle: raw.channelTitle || CHANNEL.name,
  };
}

function isBeforeStartDate(isoDate) {
  if (!isoDate) return false;
  return isoDate.slice(0, 10) < CONFIG.startDate;
}

// --- YouTube Data API (optional enhancement) ---
function getYouTubeClient() {
  return google.youtube({ version: "v3", auth: API_KEY });
}

async function resolveChannelIdViaApi(youtube) {
  if (CHANNEL.channelId) return CHANNEL.channelId;

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

  while (true) {
    const res = await youtube.playlistItems.list({
      part: ["snippet", "contentDetails"],
      playlistId,
      maxResults: 50,
      pageToken,
    });

    for (const item of res.data.items || []) {
      const videoId = item.contentDetails?.videoId;
      const publishedAt = item.snippet?.publishedAt || item.contentDetails?.videoPublishedAt;
      if (!videoId) continue;

      videos.push(
        normalizeVideo({
          videoId,
          title: item.snippet?.title || "",
          description: item.snippet?.description || "",
          publishedAt,
          channelTitle: item.snippet?.channelTitle || CHANNEL.name,
        })
      );

      if (isBeforeStartDate(publishedAt)) {
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
      enriched.push(
        normalizeVideo({
          videoId: video.videoId,
          title: detail?.snippet?.title || video.title,
          description: detail?.snippet?.description || video.description,
          publishedAt: detail?.snippet?.publishedAt || video.publishedAt,
          channelTitle: detail?.snippet?.channelTitle || video.channelTitle,
        })
      );
    }

    if (i + 50 < videos.length) await sleep(API_DELAY_MS);
  }
  return enriched;
}

// --- youtubei.js / InnerTube (default, no API key) ---
function extractPublishedHint(item) {
  const rows = item.metadata?.metadata?.metadata_rows || [];
  for (const row of rows) {
    for (const part of row.metadata_parts || []) {
      const text = part.text?.text || "";
      if (/\bago\b/i.test(text) || /^\w{3}\s+\d{1,2},\s+\d{4}$/.test(text)) {
        return text;
      }
    }
  }
  return null;
}

function mapInnerTubeItem(item) {
  const videoId = item.content_id || item.video_id || item.id;
  if (!videoId) return null;

  const publishedHint = extractPublishedHint(item);
  return normalizeVideo({
    videoId,
    title: item.metadata?.title?.text || item.title?.text || "",
    description: "",
    publishedAt: parseRelativeDate(publishedHint),
    channelTitle: CHANNEL.name,
  });
}

async function getInnerTubeClient() {
  return Innertube.create({ retrieve_player: false });
}

async function resolveChannelIdViaInnerTube(innertube) {
  if (CHANNEL.channelId) return CHANNEL.channelId;

  throw new Error(
    `No channelId configured for "${CONFIG.channel}". Add channelId to youtube/youtubeChannels.js or install yt-dlp as fallback.`
  );
}

async function enrichVideoViaInnerTube(innertube, video) {
  const info = await innertube.getInfo(video.videoId);
  const publishedText = info.primary_info?.published?.text || info.basic_info?.date;
  return normalizeVideo({
    videoId: video.videoId,
    title: info.basic_info?.title || video.title,
    description: info.basic_info?.short_description || video.description,
    publishedAt: toIsoDate(publishedText) || video.publishedAt,
    channelTitle: info.basic_info?.channel?.name || video.channelTitle,
  });
}

async function enrichVideosViaInnerTube(innertube, videos) {
  const enriched = [];
  for (const video of videos) {
    try {
      enriched.push(await enrichVideoViaInnerTube(innertube, video));
    } catch (err) {
      enriched.push(video);
      console.log(`    Warning: could not enrich ${video.videoId}: ${(err.message || err).substring(0, 80)}`);
    }
    await sleep(INNER_TUBE_DELAY_MS);
  }
  return enriched;
}

async function listVideosViaInnerTube(state) {
  const innertube = await getInnerTubeClient();
  const channelId = state.resolvedChannelId || (await resolveChannelIdViaInnerTube(innertube));
  state.resolvedChannelId = channelId;
  saveState(state);

  const channel = await innertube.getChannel(channelId);
  let page = await channel.getVideos();
  const videos = [];

  while (true) {
    for (const item of page.videos || []) {
      const mapped = mapInnerTubeItem(item);
      if (!mapped) continue;
      videos.push(mapped);

      if (isBeforeStartDate(mapped.publishedAt)) {
        return videos;
      }
    }

    if (CONFIG.maxVideos > 0 && videos.length >= CONFIG.maxVideos) break;
    if (!page.has_continuation) break;

    page = await page.getContinuation();
    await sleep(INNER_TUBE_DELAY_MS);
  }

  return videos;
}

async function enrichListedVideos(videos, listingMethod) {
  if (listingMethod === "youtubei.js") {
    const innertube = await getInnerTubeClient();
    return enrichVideosViaInnerTube(innertube, videos);
  }
  return videos;
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

function isYtDlpMissingError(err) {
  const msg = err.message || String(err);
  return err.code === "ENOENT" || /spawn yt-dlp/i.test(msg) || /not found/i.test(msg);
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
    if (isYtDlpMissingError(err)) {
      throw new Error(YT_DLP_INSTALL_HELP);
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

    videos.push(
      normalizeVideo({
        videoId,
        title: title || "",
        description: descParts.join("\t") || "",
        publishedAt,
        channelTitle: CHANNEL.name,
      })
    );
  }

  return videos;
}

async function listChannelVideos(state) {
  if (USE_OFFICIAL_API) {
    console.log(`[${CHANNEL.name}] Using YouTube Data API (YOUTUBE_USE_API=1)`);
    const youtube = getYouTubeClient();
    const channelId = state.resolvedChannelId || (await resolveChannelIdViaApi(youtube));
    state.resolvedChannelId = channelId;

    const playlistId = state.uploadsPlaylistId || (await getUploadsPlaylistId(youtube, channelId));
    state.uploadsPlaylistId = playlistId;
    state.listingMethod = "youtube_data_api";
    saveState(state);

    const listed = await listVideosViaApi(youtube, playlistId, state);
    return enrichVideosViaApi(youtube, listed);
  }

  try {
    console.log(`[${CHANNEL.name}] Listing videos via youtubei.js (no API key)`);
    const videos = await listVideosViaInnerTube(state);
    state.listingMethod = "youtubei.js";
    saveState(state);
    return videos;
  } catch (innerTubeErr) {
    console.log(
      `[${CHANNEL.name}] InnerTube listing failed (${innerTubeErr.message || innerTubeErr}). Trying yt-dlp...`
    );
  }

  console.log(`[${CHANNEL.name}] Listing videos via yt-dlp (no API key)`);
  const videos = await listVideosViaYtDlp();
  state.listingMethod = "yt-dlp";
  saveState(state);
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

  let allVideos = await listChannelVideos(state);

  if (CONFIG.maxVideos > 0) {
    allVideos = allVideos.slice(0, CONFIG.maxVideos);
  }

  state.videosListed = allVideos.length;
  console.log(`[${CHANNEL.name}] Listed ${allVideos.length} videos (${state.listingMethod || "unknown"})`);

  if (state.listingMethod === "youtubei.js" && allVideos.length > 0) {
    const candidates = allVideos.filter(
      (video) => !video.publishedAt || inDateRange(video.publishedAt) || video.publishedAt.slice(0, 10) >= CONFIG.startDate
    );
    if (candidates.length > 0) {
      console.log(`[${CHANNEL.name}] Enriching ${candidates.length} videos with descriptions (InnerTube)...`);
      const enrichedById = new Map(
        (await enrichListedVideos(candidates, state.listingMethod)).map((video) => [video.videoId, video])
      );
      allVideos = allVideos.map((video) => enrichedById.get(video.videoId) || video);
    }
  }

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
