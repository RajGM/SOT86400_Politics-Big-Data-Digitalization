/**
 * UK Parliament YouTube channel configuration.
 *
 * Channel IDs can be resolved at runtime via the YouTube Data API (forHandle).
 * Optional `channelId` values are fallbacks when the API key is missing or
 * handle resolution fails.
 *
 * Setup:
 *   export YOUTUBE_API_KEY=your_key_here   (Windows: set YOUTUBE_API_KEY=...)
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
  MAX_VIDEOS_PER_CHANNEL,
  getChannelByKey,
  getAllChannelKeys,
};
