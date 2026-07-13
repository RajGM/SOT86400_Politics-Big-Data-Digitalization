/**
 * UK Parliament YouTube channel configuration.
 *
 * Channel listing uses youtubei.js (InnerTube) by default — no API key required.
 * Each channel should have a `channelId` for reliable listing without yt-dlp.
 *
 * Optional: set YOUTUBE_API_KEY + YOUTUBE_USE_API=1 to use the official Data API.
 *
 * Setup:
 *   npm install
 */

const CHANNELS = [
  {
    key: "uk_parliament",
    name: "UK Parliament",
    handle: "UKParliament",
    url: "https://www.youtube.com/@UKParliament",
    channelId: "UCMasyWuE1P2AaEKw_FkGq9g",
  },
  {
    key: "house_of_lords",
    name: "House of Lords",
    handle: "UKHouseOfLords",
    url: "https://www.youtube.com/@UKHouseOfLords",
    // Known channel ID (also reachable as @houseoflords)
    channelId: "UCI_4WZYDHY9Dvb_zUq1_4HQ",
  },
];

/** Default polite delay between transcript fetches (ms). */
const TRANSCRIPT_DELAY_MS = 1500;

/** Delay between YouTube Data API paginated requests (ms). */
const API_DELAY_MS = 500;

/** Delay between InnerTube requests when enriching video metadata (ms). */
const INNER_TUBE_DELAY_MS = 400;

/** Max videos to process per channel in a single run (0 = unlimited). */
const MAX_VIDEOS_PER_CHANNEL = 0;

function getChannelByKey(key) {
  return CHANNELS.find((c) => c.key === key) || null;
}

function getAllChannelKeys() {
  return CHANNELS.map((c) => c.key);
}

module.exports = {
  CHANNELS,
  TRANSCRIPT_DELAY_MS,
  API_DELAY_MS,
  INNER_TUBE_DELAY_MS,
  MAX_VIDEOS_PER_CHANNEL,
  getChannelByKey,
  getAllChannelKeys,
};
