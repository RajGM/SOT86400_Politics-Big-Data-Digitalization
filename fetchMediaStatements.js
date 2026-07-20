/**
 * Dataset 2: Media Statements Collector
 *
 * For each top MP + AI keywords:
 *   1. Web search → article URLs + snippets
 *   2. HTTP fetch of each article page → full text
 *   3. Save structured CSV (politician, party, date, source, headline, URL, text)
 *
 * Search backends (first available wins, or --provider):
 *   google   — GOOGLE_CSE_API_KEY / GOOGLE_API_KEY + GOOGLE_CSE_ID / GOOGLE_CSE_CX
 *   serpapi  — SERPAPI_API_KEY / SERPAPI_KEY
 *   brave    — BRAVE_API_KEY / BRAVE_SEARCH_API_KEY
 *   guardian — GUARDIAN_API_KEY
 *   openai   — OPENAI_API_KEY (Responses API + web_search)
 *
 * Prerequisites:
 *   npm install
 *   Copy/create .env with at least one search backend key set
 *
 * Usage:
 *   node fetchMediaStatements.js [--limit 2] [--keywords 3] [--results 5]
 *                                 [--outDir ./media_statements] [--force]
 *                                 [--provider google|serpapi|brave|guardian|openai]
 *                                 [--delay 1500] [--skipFetch]
 *                                 [--politicians "Name1,Name2"]
 *                                 [--from|--politiciansFile ./media_statements/speakers_to_search.json]
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const searchTerms = require("./searchTerms.js");

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 1;
const DEFAULT_DELAY_MS = 1500;
const DEFAULT_RESULTS_PER_QUERY = 5;
const DEFAULT_KEYWORDS_PER_MP = 4;
const MAX_TEXT_CHARS = 50000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PoliticsBigData/1.0";

/**
 * Politicians who actively discuss AI in UK Parliament.
 * Sourced from Hansard + ParlaMint analysis of speakers with 3+ AI-related contributions.
 */
const POLITICIANS = [
  // --- Commons MPs (elected) ---
  { name: "Peter Kyle", party: "Labour", house: "Commons", role: "Secretary of State for Science, Innovation and Technology" },
  { name: "Michelle Donelan", party: "Conservative", house: "Commons", role: "Former Secretary of State for DSIT" },
  { name: "Matt Hancock", party: "Independent", house: "Commons", role: "Former Health Secretary, AI advocate" },
  { name: "Chi Onwurah", party: "Labour", house: "Commons", role: "Shadow Minister for Industrial Strategy" },
  { name: "Saqib Bhatti", party: "Conservative", house: "Commons", role: "Former Tech Minister" },
  { name: "Chris Bryant", party: "Labour", house: "Commons", role: "Minister for Creative Industries" },
  { name: "Darren Jones", party: "Labour", house: "Commons", role: "Chief Secretary to the Treasury" },
  { name: "Alan Mak", party: "Conservative", house: "Commons", role: "Former Minister for AI" },
  { name: "Stephen Timms", party: "Labour", house: "Commons", role: "Chair of Work and Pensions Committee" },
  { name: "Joanna Cherry", party: "SNP", house: "Commons", role: "Justice spokesperson" },
  { name: "Margot James", party: "Conservative", house: "Commons", role: "Former Digital Minister" },
  { name: "Kevin Foster", party: "Conservative", house: "Commons", role: "Former Immigration Minister" },
  { name: "Greg Clark", party: "Conservative", house: "Commons", role: "Former BEIS Secretary" },
  { name: "Theresa May", party: "Conservative", house: "Commons", role: "Former Prime Minister" },
  { name: "Feryal Clark", party: "Labour", house: "Commons", role: "Parliamentary Under-Secretary for AI" },
  { name: "George Freeman", party: "Conservative", house: "Commons", role: "Former Science Minister" },
  { name: "Paul Scully", party: "Conservative", house: "Commons", role: "Former Tech Minister" },
  { name: "Lucy Frazer", party: "Conservative", house: "Commons", role: "Former Culture Secretary" },
  { name: "Oliver Dowden", party: "Conservative", house: "Commons", role: "Former Deputy PM" },
  { name: "Kanishka Narayan", party: "Labour", house: "Commons", role: "MP for Vale of Glamorgan" },

  // --- Lords (appointed — flag in methodology) ---
  { name: "Lord Clement-Jones", party: "Liberal Democrat", house: "Lords", role: "AI spokesperson, former Chair of AI Select Committee" },
  { name: "Viscount Camrose", party: "Conservative", house: "Lords", role: "Former AI Minister" },
  { name: "Lord Vallance", party: "Labour", house: "Lords", role: "Minister for Science, Former Chief Scientific Adviser" },
  { name: "Baroness Kidron", party: "Crossbench", house: "Lords", role: "Children's online safety campaigner" },
  { name: "Lord Holmes", party: "Conservative", house: "Lords", role: "AI and disability rights" },
  { name: "Baroness Hamwee", party: "Liberal Democrat", house: "Lords", role: "Home Affairs spokesperson" },
  { name: "Lord Keen", party: "Conservative", house: "Lords", role: "Former Advocate General" },
  { name: "Baroness Neville-Rolfe", party: "Conservative", house: "Lords", role: "Former Commercial Secretary" },
];

const MEDIA_SITES = [
  "theguardian.com",
  "bbc.co.uk",
  "bbc.com",
  "telegraph.co.uk",
  "independent.co.uk",
  "sky.com",
  "ft.com",
  "thetimes.co.uk",
  "gov.uk",
];

/** Extra media-oriented keywords layered on top of searchTerms.js hits. */
const MEDIA_EXTRA_KEYWORDS = [
  "artificial intelligence",
  "AI regulation",
  "AI safety",
  "generative AI",
  "AI policy",
  "deepfake",
  "facial recognition",
  "machine learning",
  "AI ethics",
  "ChatGPT",
];

// ---------------------------------------------------------------------------
// KEYWORDS (from searchTerms.js)
// ---------------------------------------------------------------------------

function buildAiKeywords() {
  const fromHansard = (searchTerms.SEARCHED_WITH_RESULTS || [])
    .slice()
    .sort((a, b) => (b.results || 0) - (a.results || 0))
    .map((t) => t.term);

  const seen = new Set();
  const out = [];
  for (const term of [...MEDIA_EXTRA_KEYWORDS, ...fromHansard]) {
    const key = String(term || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(term).trim());
  }
  return out;
}

const AI_KEYWORDS = buildAiKeywords();

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    outDir: path.join(__dirname, "media_statements"),
    limit: null,
    keywords: DEFAULT_KEYWORDS_PER_MP,
    results: DEFAULT_RESULTS_PER_QUERY,
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
    force: false,
    skipFetch: false,
    provider: null,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    politicians: null,
    politiciansFile: null,
    onlyNew: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--outDir":
        parsed.outDir = path.resolve(args[++i]);
        break;
      case "--limit":
        parsed.limit = parseInt(args[++i], 10);
        break;
      case "--keywords":
        parsed.keywords = Math.max(1, parseInt(args[++i], 10) || DEFAULT_KEYWORDS_PER_MP);
        break;
      case "--results":
        parsed.results = Math.max(1, parseInt(args[++i], 10) || DEFAULT_RESULTS_PER_QUERY);
        break;
      case "--concurrency":
        parsed.concurrency = Math.max(1, parseInt(args[++i], 10) || DEFAULT_CONCURRENCY);
        break;
      case "--delay":
        parsed.delayMs = parseInt(args[++i], 10);
        if (Number.isNaN(parsed.delayMs)) parsed.delayMs = DEFAULT_DELAY_MS;
        break;
      case "--force":
        parsed.force = true;
        break;
      case "--skipFetch":
        parsed.skipFetch = true;
        break;
      case "--provider":
        parsed.provider = String(args[++i] || "").toLowerCase();
        break;
      case "--model":
        parsed.model = args[++i];
        break;
      case "--politicians":
        parsed.politicians = String(args[++i] || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "--politiciansFile":
      case "--from":
        parsed.politiciansFile = path.resolve(args[++i]);
        break;
      case "--onlyNew":
        parsed.onlyNew = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node fetchMediaStatements.js [options]

Options:
  --limit N              Process only N politicians
  --keywords N           AI keywords per MP (default ${DEFAULT_KEYWORDS_PER_MP})
  --results N            Search results per query (default ${DEFAULT_RESULTS_PER_QUERY})
  --outDir PATH          Output folder (default ./media_statements)
  --provider NAME        google|serpapi|brave|guardian|openai
  --delay MS             Delay between API calls (default ${DEFAULT_DELAY_MS})
  --skipFetch            Keep search snippets; do not HTTP-fetch articles
  --force                Ignore prior state and re-run
  --model NAME           OpenAI model when provider=openai
  --politicians LIST     Comma-separated names (overrides hardcoded list when set)
  --from PATH            Alias for --politiciansFile
  --politiciansFile PATH JSON from extractTopSpeakers.js ({candidates:[...]}) or [{name,party,house}]
  --onlyNew              With --from/--politiciansFile, only process pending/failed names
  --help                 Show this help
`);
}

/**
 * Resolve the active politician roster for this run.
 * Default: hardcoded POLITICIANS.
 * With --politicians / --politiciansFile: those names (merged with metadata when available).
 */
function resolvePoliticians(config) {
  const byName = new Map(POLITICIANS.map((p) => [p.name.toLowerCase(), { ...p }]));

  let extras = [];
  if (config.politiciansFile) {
    if (!fs.existsSync(config.politiciansFile)) {
      throw new Error(`politiciansFile not found: ${config.politiciansFile}`);
    }
    const raw = JSON.parse(fs.readFileSync(config.politiciansFile, "utf-8"));
    const list = Array.isArray(raw) ? raw : raw.candidates || raw.politicians || [];
    extras = list.map((p) => {
      if (typeof p === "string") return { name: p, party: "Unknown", house: "", role: "" };
      return {
        name: p.name,
        party: p.party || "Unknown",
        house: p.house || "",
        role: p.role || "",
      };
    });
  }
  if (config.politicians && config.politicians.length) {
    extras = extras.concat(
      config.politicians.map((name) => ({ name, party: "Unknown", house: "", role: "" }))
    );
  }

  if (!extras.length) return POLITICIANS.map((p) => ({ ...p }));

  // Enrich unknown party/house from file entries; prefer explicit file metadata
  const resolved = [];
  const seen = new Set();
  for (const p of extras) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const known = byName.get(key);
    resolved.push({
      name: p.name,
      party: p.party && p.party !== "Unknown" ? p.party : known?.party || p.party || "Unknown",
      house: p.house || known?.house || "",
      role: p.role || known?.role || "",
    });
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// ENV / PROVIDER DETECTION
// ---------------------------------------------------------------------------

function envFirst(...names) {
  for (const name of names) {
    const v = process.env[name];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function detectProvider(preferred) {
  const available = [];
  if (envFirst("GOOGLE_CSE_API_KEY", "GOOGLE_API_KEY") && envFirst("GOOGLE_CSE_ID", "GOOGLE_CSE_CX", "GOOGLE_CX")) {
    available.push("google");
  }
  if (envFirst("SERPAPI_API_KEY", "SERPAPI_KEY")) available.push("serpapi");
  if (envFirst("BRAVE_API_KEY", "BRAVE_SEARCH_API_KEY")) available.push("brave");
  if (envFirst("GUARDIAN_API_KEY")) available.push("guardian");
  if (envFirst("OPENAI_API_KEY")) available.push("openai");

  if (preferred) {
    if (!available.includes(preferred)) {
      throw new Error(
        `Provider "${preferred}" is not configured. Available: ${available.join(", ") || "(none)"}. ` +
          "Set the matching key(s) in .env"
      );
    }
    return preferred;
  }
  if (available.length === 0) {
    throw new Error(
      "No search API keys found in .env. Set one of: " +
        "GOOGLE_CSE_API_KEY+GOOGLE_CSE_ID, SERPAPI_API_KEY, BRAVE_API_KEY, GUARDIAN_API_KEY, OPENAI_API_KEY"
    );
  }
  return available[0];
}

function listConfiguredEnvKeys() {
  const names = [
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "GOOGLE_CSE_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_CSE_ID",
    "GOOGLE_CSE_CX",
    "GOOGLE_CX",
    "SERPAPI_API_KEY",
    "SERPAPI_KEY",
    "BRAVE_API_KEY",
    "BRAVE_SEARCH_API_KEY",
    "GUARDIAN_API_KEY",
    "SEARCH_API_KEY",
  ];
  return names.filter((n) => envFirst(n));
}

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

function stateFilePath(outDir) {
  return path.join(outDir, "fetch_state.json");
}

function loadState(outDir) {
  const fp = stateFilePath(outDir);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}

function saveState(outDir, state) {
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(stateFilePath(outDir), JSON.stringify(state, null, 2), "utf-8");
}

function initState(politicians) {
  const list = politicians || POLITICIANS;
  return {
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    completedAt: null,
    summary: {
      totalPoliticians: list.length,
      completed: 0,
      failed: 0,
      totalArticles: 0,
    },
    politicians: list.map((p) => ({
      name: p.name,
      party: p.party,
      house: p.house,
      status: "pending",
      articlesFound: 0,
      error: null,
    })),
  };
}

/** Merge new politicians into existing state without wiping completed entries. */
function mergePoliticiansIntoState(state, politicians) {
  const existing = new Map(state.politicians.map((p) => [p.name.toLowerCase(), p]));
  for (const p of politicians) {
    const key = p.name.toLowerCase();
    if (existing.has(key)) continue;
    state.politicians.push({
      name: p.name,
      party: p.party,
      house: p.house,
      status: "pending",
      articlesFound: 0,
      error: null,
    });
  }
  state.summary.totalPoliticians = state.politicians.length;
  return state;
}

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// WEB SEARCH PROVIDERS
// ---------------------------------------------------------------------------

function buildQuery(politician, keyword) {
  const sites = MEDIA_SITES.map((s) => `site:${s}`).join(" OR ");
  return `"${politician.name}" "${keyword}" (${sites})`;
}

async function searchGoogle(query, num) {
  const key = envFirst("GOOGLE_CSE_API_KEY", "GOOGLE_API_KEY");
  const cx = envFirst("GOOGLE_CSE_ID", "GOOGLE_CSE_CX", "GOOGLE_CX");
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(num, 10)));
  url.searchParams.set("dateRestrict", "y6");

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Google CSE HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.items || []).map((item) => ({
    url: item.link || "",
    headline: item.title || "",
    snippet: item.snippet || "",
    source: hostnameToSource(item.link),
    date: extractDateFromMeta(item) || "",
  }));
}

async function searchSerpApi(query, num) {
  const key = envFirst("SERPAPI_API_KEY", "SERPAPI_KEY");
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", key);
  url.searchParams.set("num", String(num));
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "uk");

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.organic_results || []).map((item) => ({
    url: item.link || "",
    headline: item.title || "",
    snippet: item.snippet || "",
    source: hostnameToSource(item.link),
    date: item.date || "",
  }));
}

async function searchBrave(query, num) {
  const key = envFirst("BRAVE_API_KEY", "BRAVE_SEARCH_API_KEY");
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(num, 20)));
  url.searchParams.set("country", "GB");
  url.searchParams.set("search_lang", "en");

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key,
      "User-Agent": USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return ((data.web && data.web.results) || []).map((item) => ({
    url: item.url || "",
    headline: item.title || "",
    snippet: item.description || "",
    source: hostnameToSource(item.url),
    date: (item.age || item.page_age || "").toString(),
  }));
}

async function searchGuardian(politician, keyword, num) {
  const key = envFirst("GUARDIAN_API_KEY");
  const url = new URL("https://content.guardianapis.com/search");
  url.searchParams.set("api-key", key);
  url.searchParams.set("q", `"${politician.name}" AND (${keyword})`);
  url.searchParams.set("page-size", String(Math.min(num, 50)));
  url.searchParams.set("order-by", "relevance");
  url.searchParams.set("from-date", "2020-01-01");
  url.searchParams.set("show-fields", "trailText,bodyText,headline,byline,publication");
  url.searchParams.set("query-fields", "body,headline,trailText");

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Guardian HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const results = (data.response && data.response.results) || [];
  return results.map((item) => {
    const fields = item.fields || {};
    return {
      url: item.webUrl || "",
      headline: fields.headline || item.webTitle || "",
      snippet: fields.trailText || "",
      source: "The Guardian",
      date: (item.webPublicationDate || "").slice(0, 10),
      text: fields.bodyText || "",
    };
  });
}

async function searchOpenAI(politician, keyword, model, num) {
  const client = new OpenAI({ apiKey: envFirst("OPENAI_API_KEY") });
  const prompt = `Search for UK news articles (2020-2026) where ${politician.name} (${politician.party}) discusses "${keyword}".

Prefer: The Guardian, BBC News, The Telegraph, The Independent, Sky News, Financial Times, The Times, gov.uk.

Return up to ${num} distinct articles. For each article list:
- HEADLINE: ...
- SOURCE: ...
- DATE: YYYY-MM-DD (or best guess)
- URL: https://...
- SNIPPET: 1-2 sentences about what ${politician.name} said

If none found, reply exactly: NONE`;

  const response = await client.responses.create({
    model,
    tools: [{ type: "web_search" }],
    input: prompt,
  });

  const textOutput = response.output_text || "";
  const fromText = parseArticlesFromText(textOutput);

  // Prefer structured URL citations when present
  const citations = [];
  for (const item of response.output || []) {
    if (item.type === "message" && item.content) {
      for (const content of item.content) {
        for (const ann of content.annotations || []) {
          if (ann.type === "url_citation" && ann.url) {
            citations.push({
              url: ann.url,
              headline: ann.title || "",
              snippet: "",
              source: hostnameToSource(ann.url),
              date: "",
            });
          }
        }
      }
    }
  }

  const byUrl = new Map();
  for (const art of [...fromText, ...citations]) {
    if (!art.url) continue;
    const key = normalizeUrl(art.url);
    if (!byUrl.has(key)) byUrl.set(key, art);
    else {
      const prev = byUrl.get(key);
      byUrl.set(key, {
        ...prev,
        headline: prev.headline || art.headline,
        snippet: prev.snippet || art.snippet,
        source: prev.source || art.source,
        date: prev.date || art.date,
      });
    }
  }
  return [...byUrl.values()].slice(0, num);
}

function parseArticlesFromText(text) {
  if (!text || /^\s*NONE\s*$/i.test(text.trim())) return [];
  const blocks = text.split(/(?=HEADLINE\s*:)/i);
  const articles = [];
  for (const block of blocks) {
    const headline = matchField(block, "HEADLINE");
    const source = matchField(block, "SOURCE");
    const date = matchField(block, "DATE");
    const url = matchField(block, "URL");
    const snippet = matchField(block, "SNIPPET");
    if (url && /^https?:\/\//i.test(url)) {
      articles.push({
        url: url.trim(),
        headline: (headline || "").trim(),
        snippet: (snippet || "").trim(),
        source: (source || hostnameToSource(url)).trim(),
        date: normalizeDate(date),
      });
    }
  }

  // Fallback: bare URLs in the response
  if (articles.length === 0) {
    const urlRe = /https?:\/\/[^\s)\]>"']+/gi;
    let m;
    while ((m = urlRe.exec(text)) !== null) {
      articles.push({
        url: m[0].replace(/[.,;]+$/, ""),
        headline: "",
        snippet: "",
        source: hostnameToSource(m[0]),
        date: "",
      });
    }
  }
  return articles;
}

function matchField(block, name) {
  const re = new RegExp(`${name}\\s*:\\s*(.+)`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : "";
}

async function runSearch(provider, politician, keyword, config) {
  const query = buildQuery(politician, keyword);
  switch (provider) {
    case "google":
      return searchGoogle(query, config.results);
    case "serpapi":
      return searchSerpApi(query, config.results);
    case "brave":
      return searchBrave(query, config.results);
    case "guardian":
      return searchGuardian(politician, keyword, config.results);
    case "openai":
      return searchOpenAI(politician, keyword, config.model, config.results);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ---------------------------------------------------------------------------
// ARTICLE FETCH (web_fetch / HTTP)
// ---------------------------------------------------------------------------

function htmlToText(html) {
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<\/(p|div|h[1-6]|li|br|tr|section|article)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.replace(/[ \t]{2,}/g, " ").trim();
}

function hostnameToSource(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("theguardian")) return "The Guardian";
    if (host.includes("bbc.")) return "BBC News";
    if (host.includes("telegraph")) return "The Telegraph";
    if (host.includes("independent")) return "The Independent";
    if (host.includes("sky.")) return "Sky News";
    if (host.includes("ft.com")) return "Financial Times";
    if (host.includes("thetimes")) return "The Times";
    if (host.includes("gov.uk")) return "GOV.UK";
    return host;
  } catch {
    return "";
  }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

function normalizeDate(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  const iso = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s.slice(0, 40);
}

function extractDateFromMeta(item) {
  const meta = item.pagemap && (item.pagemap.metatags || [])[0];
  if (!meta) return "";
  return normalizeDate(
    meta["article:published_time"] ||
      meta["og:updated_time"] ||
      meta["pubdate"] ||
      meta["date"] ||
      ""
  );
}

function extractDateFromHtml(html) {
  const patterns = [
    /property=["']article:published_time["'][^>]*content=["']([^"']+)/i,
    /content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /datetime=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return normalizeDate(m[1]);
  }
  return "";
}

function extractHeadlineFromHtml(html) {
  const og = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i);
  if (og) return og[1].trim();
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title) return title[1].replace(/\s+/g, " ").trim();
  return "";
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function escapeCSV(val) {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const CSV_HEADERS = ["politician", "party", "date", "source", "headline", "URL", "text"];

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

// ---------------------------------------------------------------------------
// PER-POLITICIAN PIPELINE
// ---------------------------------------------------------------------------

async function collectForPolitician(politician, config, provider) {
  const keywords = AI_KEYWORDS.slice(0, config.keywords);
  const byUrl = new Map();

  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    console.log(`  search [${i + 1}/${keywords.length}]: ${keyword}`);
    try {
      const hits = await runSearch(provider, politician, keyword, config);
      for (const hit of hits) {
        if (!hit.url) continue;
        const key = normalizeUrl(hit.url);
        if (!byUrl.has(key)) {
          byUrl.set(key, {
            politician: politician.name,
            party: politician.party,
            date: normalizeDate(hit.date),
            source: hit.source || hostnameToSource(hit.url),
            headline: hit.headline || "",
            URL: hit.url,
            text: hit.text || hit.snippet || "",
            _snippet: hit.snippet || "",
          });
        }
      }
      console.log(`    -> ${hits.length} hit(s)`);
    } catch (err) {
      console.error(`    -> search error: ${err.message}`);
    }
    if (i < keywords.length - 1) await sleep(config.delayMs);
  }

  const articles = [...byUrl.values()];

  if (!config.skipFetch) {
    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      // Guardian API already returns bodyText
      if (art.text && art.text.length > 800 && provider === "guardian") continue;
      console.log(`  fetch [${i + 1}/${articles.length}]: ${art.URL}`);
      try {
        const htmlRes = await fetch(art.URL, {
          headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
          redirect: "follow",
          signal: AbortSignal.timeout(25000),
        });
        if (!htmlRes.ok) throw new Error(`HTTP ${htmlRes.status}`);
        const html = await htmlRes.text();
        const text = htmlToText(html).slice(0, MAX_TEXT_CHARS);
        if (text.length > 100) art.text = text;
        else if (!art.text) art.text = art._snippet || "";
        if (!art.headline) art.headline = extractHeadlineFromHtml(html);
        if (!art.date) art.date = extractDateFromHtml(html);
        if (!art.source) art.source = hostnameToSource(art.URL);
      } catch (err) {
        console.error(`    -> fetch failed: ${err.message}`);
        if (!art.text) art.text = art._snippet || "";
      }
      if (i < articles.length - 1) await sleep(Math.min(config.delayMs, 800));
    }
  }

  return articles.map(({ _snippet, ...row }) => row);
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function main() {
  const config = parseArgs();
  const configuredKeys = listConfiguredEnvKeys();
  const provider = detectProvider(config.provider);
  const activePoliticians = resolvePoliticians(config);
  // Lookup used during collection (name → full metadata)
  const politicianByName = new Map(activePoliticians.map((p) => [p.name, p]));

  console.log("=== Dataset 2: Media Statements Collector ===");
  console.log(`Provider:    ${provider}`);
  console.log(`Env keys:    ${configuredKeys.join(", ") || "(none)"}`);
  console.log(`Model:       ${provider === "openai" ? config.model : "n/a"}`);
  console.log(`Output:      ${config.outDir}`);
  console.log(`Keywords/MP: ${config.keywords} (from ${AI_KEYWORDS.length} AI terms)`);
  console.log(`Results/q:   ${config.results}`);
  console.log(`Delay:       ${config.delayMs}ms`);
  console.log(`Fetch pages: ${config.skipFetch ? "no (--skipFetch)" : "yes"}`);
  console.log(`Politicians: ${activePoliticians.length}`);
  if (config.politiciansFile) console.log(`From file:   ${config.politiciansFile}`);
  if (config.limit) console.log(`Limit:       ${config.limit}`);
  console.log("");

  if (!fs.existsSync(config.outDir)) fs.mkdirSync(config.outDir, { recursive: true });
  const rawDir = path.join(config.outDir, "raw");
  if (!fs.existsSync(rawDir)) fs.mkdirSync(rawDir, { recursive: true });

  let state = config.force ? null : loadState(config.outDir);
  if (!state) {
    state = initState(activePoliticians);
  } else {
    // Expansion runs: append new names; keep prior completed
    mergePoliticiansIntoState(state, activePoliticians);
  }
  saveState(config.outDir, state);

  let pending = state.politicians.filter((p) => p.status === "pending" || p.status === "failed");

  // When expanding via file/list, only process those names (not the whole roster)
  if (config.politiciansFile || (config.politicians && config.politicians.length)) {
    const wanted = new Set(activePoliticians.map((p) => p.name.toLowerCase()));
    pending = pending.filter((p) => wanted.has(p.name.toLowerCase()));
    if (config.onlyNew) {
      pending = pending.filter((p) => p.status === "pending" || p.status === "failed");
    }
  }

  if (config.limit) pending = pending.slice(0, config.limit);

  console.log(`${pending.length} politician(s) to process.\n`);

  const allRows = [];
  const csvPath = path.join(config.outDir, "media_statements_all.csv");

  // Reload ALL completed raw results so CSV stays complete on resume/expansion
  for (const p of state.politicians) {
    if (p.status !== "completed") continue;
    const rawPath = path.join(rawDir, safeName(p.name) + ".json");
    if (!fs.existsSync(rawPath)) continue;
    try {
      const saved = JSON.parse(fs.readFileSync(rawPath, "utf-8"));
      for (const row of saved.articles || []) allRows.push(row);
    } catch {
      // ignore corrupt raw files
    }
  }

  if (pending.length === 0) {
    console.log("All politicians already processed!");
    if (allRows.length > 0) {
      fs.writeFileSync(csvPath, buildCSV(dedupeRows(allRows)), "utf-8");
      console.log(`CSV saved: ${csvPath} (${allRows.length} rows)`);
    }
    printSummary(state);
    return;
  }

  let processed = 0;
  for (const entry of pending) {
    processed++;
    const politician =
      politicianByName.get(entry.name) ||
      activePoliticians.find((p) => p.name.toLowerCase() === entry.name.toLowerCase()) ||
      POLITICIANS.find((p) => p.name === entry.name);
    if (!politician) {
      console.warn(`  Skipping unknown politician metadata: ${entry.name}`);
      continue;
    }

    const idx = state.politicians.findIndex((p) => p.name === entry.name);
    console.log(`[${processed}/${pending.length}] ${politician.name} (${politician.party})`);

    state.politicians[idx].status = "in_progress";
    saveState(config.outDir, state);

    try {
      const articles = await collectForPolitician(politician, config, provider);
      const result = {
        politician,
        provider,
        searchedAt: new Date().toISOString(),
        articles,
      };
      const rawPath = path.join(rawDir, safeName(politician.name) + ".json");
      fs.writeFileSync(rawPath, JSON.stringify(result, null, 2), "utf-8");

      for (const row of articles) allRows.push(row);

      if (entry.status === "failed") {
        state.summary.failed = Math.max(0, state.summary.failed - 1);
      }
      state.politicians[idx].status = "completed";
      state.politicians[idx].articlesFound = articles.length;
      state.politicians[idx].error = null;
      state.summary.completed++;
      state.summary.totalArticles += articles.length;

      console.log(`  -> ${articles.length} article(s) saved\n`);
    } catch (err) {
      state.politicians[idx].status = "failed";
      state.politicians[idx].error = err.message;
      state.summary.failed++;
      console.error(`  -> FAILED: ${err.message}\n`);
      // Persist partial progress and continue
      saveState(config.outDir, state);
      fs.writeFileSync(csvPath, buildCSV(dedupeRows(allRows)), "utf-8");
    }

    saveState(config.outDir, state);
    fs.writeFileSync(csvPath, buildCSV(dedupeRows(allRows)), "utf-8");

    if (processed < pending.length) await sleep(config.delayMs);
  }

  const unique = dedupeRows(allRows);
  fs.writeFileSync(csvPath, buildCSV(unique), "utf-8");
  console.log(`\nCSV saved: ${csvPath} (${unique.length} rows)`);

  state.completedAt = new Date().toISOString();
  saveState(config.outDir, state);
  printSummary(state);
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.politician}||${normalizeUrl(row.URL || "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function printSummary(state) {
  console.log(`\n${"=".repeat(60)}`);
  console.log("MEDIA STATEMENTS COLLECTION SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`Total politicians:  ${state.summary.totalPoliticians}`);
  console.log(`Completed:          ${state.summary.completed}`);
  console.log(`Failed:             ${state.summary.failed}`);
  console.log(`Total articles:     ${state.summary.totalArticles}`);

  const topResults = state.politicians
    .filter((p) => p.status === "completed" && p.articlesFound > 0)
    .sort((a, b) => b.articlesFound - a.articlesFound)
    .slice(0, 10);

  if (topResults.length > 0) {
    console.log("\nTop results:");
    for (const p of topResults) {
      console.log(`  ${p.name} (${p.party}): ${p.articlesFound} articles`);
    }
  }

  const failed = state.politicians.filter((p) => p.status === "failed");
  if (failed.length > 0) {
    console.log("\nFailed:");
    for (const p of failed) {
      console.log(`  ${p.name}: ${p.error}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message || err);
  process.exit(1);
});
