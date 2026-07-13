/**
 * Search terms for Hansard debate scraping.
 *
 * Auto-updated by cleanup.js on 2026-07-13T16:25:56.632Z
 *
 * Structure:
 *   SEARCHED_WITH_RESULTS  — already scraped, had results (do not re-scrape)
 *   SEARCHED_ZERO_RESULTS  — already scraped, 0 results (do not re-scrape)
 *   YET_TO_SEARCH          — new terms to scrape next run
 *
 * To add new terms: append them to YET_TO_SEARCH.
 * The master script only scrapes YET_TO_SEARCH terms.
 */

// --- SEARCHED: Had results (22 terms) ---
const SEARCHED_WITH_RESULTS = [
  { term: "artificial intelligence", results: 68, pages: 4 },
  { term: "AI could", results: 45, pages: 3 },
  { term: "facial recognition", results: 11, pages: 1 },
  { term: "biometric", results: 9, pages: 1 },
  { term: "Bletchley", results: 5, pages: 1 },
  { term: "automated decision making", results: 4, pages: 1 },
  { term: "automated decision", results: 4, pages: 1 },
  { term: "digital democracy", results: 4, pages: 1 },
  { term: "AI regulation", results: 3, pages: 1 },
  { term: "generative AI", results: 2, pages: 1 },
  { term: "AI legislation", results: 1, pages: 1 },
  { term: "AI framework", results: 1, pages: 1 },
  { term: "frontier AI", results: 1, pages: 1 },
  { term: "superintelligence", results: 1, pages: 1 },
  { term: "AI ethics", results: 1, pages: 1 },
  { term: "AI employment", results: 1, pages: 1 },
  { term: "AI workforce", results: 1, pages: 1 },
  { term: "AI training", results: 1, pages: 1 },
  { term: "AI NHS", results: 1, pages: 1 },
  { term: "AI defence", results: 1, pages: 1 },
  { term: "surveillance technology", results: 1, pages: 1 },
  { term: "Alan Turing Institute", results: 1, pages: 1 },
];

// --- SEARCHED: Zero results (130 terms) ---
const SEARCHED_ZERO_RESULTS = [
  "AGI",
  "AI",
  "AI accountability",
  "AI Act",
  "AI agriculture",
  "AI alignment",
  "AI anticipation",
  "AI anxiety",
  "AI arms race",
  "AI aspiration",
  "AI audit",
  "AI automation",
  "AI bias",
  "AI climate",
  "AI compliance",
  "AI content moderation",
  "AI cooperation",
  "AI discrimination",
  "AI disinformation",
  "AI disruption",
  "AI dystopia",
  "AI economy",
  "AI education",
  "AI energy",
  "AI existential risk",
  "AI expectation",
  "AI fairness",
  "AI fear",
  "AI forecast",
  "AI future",
  "AI global governance",
  "AI governance",
  "AI healthcare",
  "AI hope",
  "AI human rights",
  "AI imagination",
  "AI industry",
  "AI innovation",
  "AI international",
  "AI investment",
  "AI jobs",
  "AI liability",
  "AI might",
  "AI military",
  "AI misinformation",
  "AI misuse",
  "AI narrative",
  "AI opportunity",
  "AI optimism",
  "AI oversight",
  "AI pessimism",
  "AI policing",
  "AI policy",
  "AI potential",
  "AI prediction",
  "AI privacy",
  "AI procurement",
  "AI productivity",
  "AI promise",
  "AI promises",
  "AI public sector",
  "AI revolution",
  "AI risk",
  "AI safety",
  "AI Safety Institute",
  "AI Safety Summit",
  "AI sandbox",
  "AI scenario",
  "AI science fiction",
  "AI singularity",
  "AI skills",
  "AI standards",
  "AI startup",
  "AI surveillance",
  "AI talent",
  "AI taskforce",
  "AI threat",
  "AI threatens",
  "AI transformation",
  "AI transparency",
  "AI transport",
  "AI treaty",
  "AI uncertainty",
  "AI utopia",
  "AI vision",
  "AI white paper",
  "AI will transform",
  "AI-driven future",
  "AI-powered",
  "algorithmic accountability",
  "algorithmic bias",
  "algorithmic control",
  "algorithmic discrimination",
  "algorithmic fairness",
  "algorithmic transparency",
  "artificial general intelligence",
  "beneficial AI",
  "big data",
  "CDEI",
  "Centre for Data Ethics",
  "computer vision",
  "data protection AI",
  "data-driven",
  "deep learning",
  "deepfake",
  "digital public sphere",
  "digital surveillance",
  "DSIT artificial intelligence",
  "echo chamber",
  "EU AI",
  "filter bubble",
  "foundation model",
  "future of AI",
  "harmful AI",
  "informational self-determination",
  "internet of things",
  "large language model",
  "machine learning",
  "natural language processing",
  "neural network",
  "Office for AI",
  "online polarisation",
  "online polarization",
  "predictive analytics",
  "predictive policing",
  "pro-innovation AI",
  "responsible AI",
  "smart city",
  "synthetic media",
  "trustworthy AI",
];

const FAILED = [];

// --- YET TO SEARCH: Add new terms here ---
const YET_TO_SEARCH = [
];

// Master script uses this — only scrapes terms not yet searched
const ALL_SEARCHED = [
  ...SEARCHED_WITH_RESULTS.map((t) => t.term),
  ...SEARCHED_ZERO_RESULTS,
];

// Terms to scrape on next run
const SEARCH_TERMS = [...YET_TO_SEARCH, ...FAILED];

module.exports = SEARCH_TERMS;
module.exports.SEARCHED_WITH_RESULTS = SEARCHED_WITH_RESULTS;
module.exports.SEARCHED_ZERO_RESULTS = SEARCHED_ZERO_RESULTS;
module.exports.YET_TO_SEARCH = YET_TO_SEARCH;
module.exports.FAILED = FAILED;
module.exports.ALL_SEARCHED = ALL_SEARCHED;
