/**
 * Step 1: Extract & rank Dataset 1 speakers by AI-related utterance count,
 * flag those already in fetchMediaStatements.js POLITICIANS list,
 * and write speakers_to_search.json for Step 2.
 *
 * Usage (run in order — see MEDIA_EXPANSION.md):
 *   node extractTopSpeakers.js --top 40
 *   node fetchMediaStatements.js --provider openai --from media_statements/speakers_to_search.json --onlyNew --limit 30
 *   node mergeMediaStatements.js --report
 */

const fs = require("fs");
const path = require("path");

/** Keep name list in sync with POLITICIANS in fetchMediaStatements.js */
const MEDIA_LIST = [
  { name: "Peter Kyle", aliases: ["peter kyle"] },
  { name: "Michelle Donelan", aliases: ["michelle emma may elizabeth donelan", "michelle donelan"] },
  { name: "Matt Hancock", aliases: ["matthew john david hancock", "matt hancock", "matthew hancock"] },
  { name: "Chi Onwurah", aliases: ["chinyelu susan onwurah", "chi onwurah"] },
  { name: "Saqib Bhatti", aliases: ["saqib bhatti"] },
  { name: "Chris Bryant", aliases: ["christopher john bryant", "chris bryant"] },
  { name: "Darren Jones", aliases: ["darren paul jones", "darren jones"] },
  { name: "Alan Mak", aliases: ["alan mak"] },
  { name: "Stephen Timms", aliases: ["stephen creswell timms", "stephen timms"] },
  { name: "Joanna Cherry", aliases: ["joanna catherine cherry", "joanna cherry"] },
  { name: "Margot James", aliases: ["margot cathleen james", "margot james"] },
  { name: "Kevin Foster", aliases: ["kevin john foster", "kevin foster"] },
  { name: "Greg Clark", aliases: ["gregory david clark", "greg clark"] },
  { name: "Theresa May", aliases: ["theresa mary may", "theresa may"] },
  { name: "Feryal Clark", aliases: ["feryal clark"] },
  { name: "George Freeman", aliases: ["george william freeman", "george freeman"] },
  { name: "Paul Scully", aliases: ["paul stuart scully", "paul scully"] },
  { name: "Lucy Frazer", aliases: ["lucy claire leigh frazer", "lucy frazer", "lucy claire leigh"] },
  { name: "Oliver Dowden", aliases: ["oliver james dowden", "oliver dowden"] },
  { name: "Kanishka Narayan", aliases: ["kanishka narayan"] },
  { name: "Lord Clement-Jones", aliases: ["timothy francis clement jones", "timothy clement jones", "clement jones", "lord clement jones"] },
  { name: "Viscount Camrose", aliases: ["jonathan berry", "viscount camrose", "camrose"] },
  { name: "Lord Vallance", aliases: ["patrick vallance", "lord vallance", "vallance"] },
  { name: "Baroness Kidron", aliases: ["beeban kidron", "baroness kidron", "kidron"] },
  { name: "Lord Holmes", aliases: ["christopher holmes", "lord holmes of richmond", "holmes of richmond"] },
  { name: "Baroness Hamwee", aliases: ["sally rachel hamwee", "sally hamwee", "baroness hamwee", "hamwee"] },
  { name: "Lord Keen", aliases: ["richard keen", "lord keen of elie", "keen of elie"] },
  { name: "Baroness Neville-Rolfe", aliases: ["lucy neville rolfe", "baroness neville rolfe", "neville rolfe"] },
];

/** Known peer title forms for better news-search recall (ParlaMint uses personal names). */
const PEER_SEARCH_NAMES = {
  "thomas ashton": "Lord Ashton of Hyde",
  "susan williams": "Baroness Williams of Trafford",
  "robert stevenson": "Lord Stevenson of Balmacara",
  "sarah ludford": "Baroness Ludford",
  "brian paddick": "Lord Paddick",
  "diana barran": "Baroness Barran",
  "caroline chisholm": "Baroness Chisholm of Owlpen",
  "james o shaughnessy": "Lord O'Shaughnessy",
  "alan william john west": "Lord West of Spithead",
  "george young": "Lord Young of Cookham",
  "james bethell": "Lord Bethell",
  "ralph matthew palmer": "Lord Palmer of Childs Hill",
  "frederick richard penn curzon": "Earl Howe",
  "mark schreiber": "Lord Marlesford",
  "simon haskel": "Lord Haskel",
  "tom mcnally": "Lord McNally",
  "anthony giddens": "Lord Giddens",
  "peta buscombe": "Baroness Buscombe",
  "richard rosser": "Lord Rosser",
  "stephen parkinson": "Lord Parkinson of Whitley Bay",
  "elizabeth mary elizabeth truss": "Liz Truss",
  "elizabeth mary truss": "Liz Truss",
  "mary elizabeth truss": "Liz Truss",
};

const POST2020 = path.join(__dirname, "parlamint_parsed", "parlamint_ai_debates.csv");
const ALL = path.join(__dirname, "parlamint_parsed", "parlamint_ai_debates_ALL.csv");

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    top: 50,
    min: 1,
    outDir: path.join(__dirname, "media_statements"),
    sources: null,
    all: false,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--top":
        parsed.top = Math.max(1, parseInt(args[++i], 10) || 50);
        break;
      case "--min":
        parsed.min = Math.max(1, parseInt(args[++i], 10) || 1);
        break;
      case "--outDir":
        parsed.outDir = path.resolve(args[++i]);
        break;
      case "--csv":
        parsed.sources = [path.resolve(args[++i])];
        break;
      case "--all":
        parsed.all = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: node extractTopSpeakers.js [--top 50] [--min 1] [--outDir PATH] [--csv PATH] [--all]"
        );
        process.exit(0);
        break;
    }
  }
  if (!parsed.sources) {
    // Default: post-2020 (~418 speakers, matches Dataset 1 methodology).
    // --all adds pre-2020 coverage from ALL.csv.
    parsed.sources = parsed.all ? [ALL] : [POST2020];
  }
  return parsed;
}

function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function escapeCSV(val) {
  if (val == null) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[()]/g, " ")
    .replace(/^(the\s+)?(rt\.?\s*hon\.?\s*|hon\.?\s*)/i, "")
    .replace(/\b(lord|lady|baroness|baron|viscount|earl|duke|marquess|sir|dame|dr|mr|mrs|ms|miss)\b\.?/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(norm) {
  return norm.split(" ").filter(Boolean);
}

function matchMediaList(speakerName) {
  const n = normalizeName(speakerName);
  const nTokens = tokens(n);
  if (!n) return { already: false, matchedAs: "" };

  for (const entry of MEDIA_LIST) {
    const aliases = [normalizeName(entry.name), ...(entry.aliases || [])].map((a) =>
      normalizeName(a)
    );
    for (const alias of aliases) {
      if (!alias) continue;
      if (n === alias) return { already: true, matchedAs: entry.name };

      // Full-name containment for longer forms (Theresa Mary May ↔ Theresa May)
      const aTokens = tokens(alias);
      if (aTokens.length >= 2 && nTokens.length >= 2) {
        const first = aTokens[0];
        const last = aTokens[aTokens.length - 1];
        // Require first + last present; avoid matching common last names alone
        if (nTokens.includes(first) && nTokens.includes(last) && last.length >= 3) {
          // For very common surnames, also require a middle-token or exact alias length check
          const commonLast = new Set(["jones", "clark", "foster", "james", "holmes", "young", "west", "smith", "brown", "wilson"]);
          if (commonLast.has(last)) {
            // only accept if alias first name matches and speaker first token matches
            if (nTokens[0] === first || nTokens.includes(aTokens[1] || first)) {
              // still require that this is intentional: for Darren Jones, first must be darren
              if (nTokens[0] === first) return { already: true, matchedAs: entry.name };
            }
          } else {
            return { already: true, matchedAs: entry.name };
          }
        }
      }

      // Unique uncommon surname match for peers (kidron, hamwee, camrose, vallance, …)
      if (aTokens.length === 1 && aTokens[0].length >= 6 && nTokens.includes(aTokens[0])) {
        return { already: true, matchedAs: entry.name };
      }
    }
  }
  return { already: false, matchedAs: "" };
}

function partyToLabel(partyName, partyAbbrev) {
  const p = (partyName || "").trim();
  if (p) return p;
  const map = {
    LAB: "Labour",
    CON: "Conservative",
    CONS: "Conservative",
    LD: "Liberal Democrat",
    LIB: "Liberal Democrat",
    LIBDEM: "Liberal Democrat",
    SNP: "SNP",
    GREEN: "Green",
    DUP: "DUP",
    SF: "Sinn Fein",
    PC: "Plaid Cymru",
    CROSSBENCH: "Crossbench",
    CB: "Crossbench",
    I: "Independent",
    IND: "Independent",
    NA: "Non-affiliated",
  };
  const a = (partyAbbrev || "").toUpperCase();
  return map[a] || partyAbbrev || "Unknown";
}

function titleCaseName(name) {
  if (!name) return name;
  if (name.includes(" ")) return name;
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

function shortDisplayName(fullName) {
  // "Robert William Henry Seely" → "Bob Seely" is hard; use First + Last
  const parts = String(fullName || "")
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length <= 2) return parts.join(" ");
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function toSearchName(speaker) {
  const norm = normalizeName(speaker.speakerName);
  if (PEER_SEARCH_NAMES[norm]) return PEER_SEARCH_NAMES[norm];
  // Heuristic: for Lords without a mapped title, try Lord/Baroness + surname
  if (/lords/i.test(speaker.chamber || "")) {
    const parts = tokens(norm);
    const last = parts[parts.length - 1];
    if (last && last.length >= 3) {
      const sex = (speaker.speakerSex || "").toUpperCase();
      const title = sex === "F" ? "Baroness" : "Lord";
      return `${title} ${last.charAt(0).toUpperCase()}${last.slice(1)}`;
    }
  }
  return shortDisplayName(speaker.speakerName);
}

function loadSpeakers(sources) {
  const counts = new Map();
  for (const file of sources) {
    if (!fs.existsSync(file)) {
      console.warn(`Skipping missing source: ${file}`);
      continue;
    }
    console.log(`Reading ${file}...`);
    const rows = parseCsv(fs.readFileSync(file, "utf8"));
    if (rows.length < 2) continue;
    const h = rows[0];
    const idx = Object.fromEntries(h.map((col, i) => [col, i]));
    for (const col of ["speakerName", "partyName", "chamber"]) {
      if (idx[col] == null) throw new Error(`Missing column ${col} in ${file}`);
    }
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      let speakerName = (row[idx.speakerName] || "").trim();
      if (!speakerName) continue;
      const displayName = titleCaseName(speakerName);
      const key = normalizeName(displayName) || displayName.toLowerCase();
      if (!counts.has(key)) {
        counts.set(key, {
          speakerId: (row[idx.speakerId] || "").trim(),
          speakerName: displayName,
          speakerSex: idx.speakerSex != null ? (row[idx.speakerSex] || "").trim() : "",
          partyName: partyToLabel(row[idx.partyName], row[idx.partyAbbrev]),
          partyAbbrev: (row[idx.partyAbbrev] || "").trim(),
          chamber: (row[idx.chamber] || "").trim(),
          utterances: 0,
        });
      }
      const o = counts.get(key);
      o.utterances++;
      if (displayName.includes(" ") && !o.speakerName.includes(" ")) o.speakerName = displayName;
      if (!o.partyName || o.partyName === "Unknown") {
        o.partyName = partyToLabel(row[idx.partyName], row[idx.partyAbbrev]);
      }
      if (!o.chamber) o.chamber = (row[idx.chamber] || "").trim();
      if (!o.speakerSex && idx.speakerSex != null) o.speakerSex = (row[idx.speakerSex] || "").trim();
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.utterances - a.utterances || a.speakerName.localeCompare(b.speakerName)
  );
}

function main() {
  const config = parseArgs();
  if (!fs.existsSync(config.outDir)) fs.mkdirSync(config.outDir, { recursive: true });

  const speakers = loadSpeakers(config.sources);
  console.log(`Unique speakers: ${speakers.length}`);
  console.log(`Media list size: ${MEDIA_LIST.length}`);

  const ranked = speakers.map((s, i) => {
    const match = matchMediaList(s.speakerName);
    const searchName = toSearchName(s);
    return {
      rank: i + 1,
      speakerName: s.speakerName,
      searchName,
      party: s.partyName,
      partyAbbrev: s.partyAbbrev,
      chamber: s.chamber || "",
      house: /lords/i.test(s.chamber) ? "Lords" : /commons/i.test(s.chamber) ? "Commons" : s.chamber || "",
      utteranceCount: s.utterances,
      already_in_media_list: match.already,
      matched_media_name: match.matchedAs,
      speakerId: s.speakerId,
      speakerSex: s.speakerSex || "",
    };
  });

  const rankedPath = path.join(config.outDir, "dataset1_speakers_ranked.csv");
  const header = [
    "rank",
    "speakerName",
    "searchName",
    "party",
    "partyAbbrev",
    "chamber",
    "house",
    "utteranceCount",
    "already_in_media_list",
    "matched_media_name",
    "speakerId",
  ];
  const lines = [header.join(",")];
  for (const r of ranked) {
    lines.push(
      [
        r.rank,
        escapeCSV(r.speakerName),
        escapeCSV(r.searchName),
        escapeCSV(r.party),
        escapeCSV(r.partyAbbrev),
        escapeCSV(r.chamber),
        escapeCSV(r.house),
        r.utteranceCount,
        r.already_in_media_list,
        escapeCSV(r.matched_media_name),
        escapeCSV(r.speakerId),
      ].join(",")
    );
  }
  fs.writeFileSync(rankedPath, lines.join("\n"), "utf8");

  const unsearched = ranked.filter((r) => !r.already_in_media_list && r.utteranceCount >= config.min);
  const candidates = unsearched.slice(0, config.top);

  const candidateRows = candidates.map((c) => ({
    name: c.searchName,
    party: c.party === "Scottish National Party" ? "SNP" : c.party,
    house: c.house || (/lords/i.test(c.chamber) ? "Lords" : "Commons"),
    role: `ParlaMint AI utterances: ${c.utteranceCount}`,
    utteranceCount: c.utteranceCount,
    rank: c.rank,
    speakerId: c.speakerId,
    speakerName: c.speakerName,
  }));

  const payload = {
    generatedAt: new Date().toISOString(),
    source: config.sources.map((s) => path.relative(__dirname, s)),
    mediaListCount: MEDIA_LIST.length,
    totalSpeakers: ranked.length,
    alreadyInMediaList: ranked.filter((r) => r.already_in_media_list).length,
    unsearchedCount: unsearched.length,
    topN: candidateRows.length,
    candidates: candidateRows,
  };

  // Primary Step-2 input (preferred filename)
  const speakersToSearchPath = path.join(config.outDir, "speakers_to_search.json");
  fs.writeFileSync(speakersToSearchPath, JSON.stringify(payload, null, 2), "utf8");

  // Alias kept for older docs / package scripts
  const candidatesPath = path.join(config.outDir, "media_expansion_candidates.json");
  fs.writeFileSync(candidatesPath, JSON.stringify(payload, null, 2), "utf8");

  const namesPath = path.join(config.outDir, "media_expansion_names.txt");
  fs.writeFileSync(namesPath, candidateRows.map((c) => c.name).join("\n") + "\n", "utf8");

  console.log(`\nWrote ${rankedPath}`);
  console.log(`Wrote ${speakersToSearchPath} (${candidateRows.length} candidates)`);
  console.log(`Wrote ${candidatesPath} (alias)`);
  console.log(`Wrote ${namesPath}`);
  console.log(`\nAlready in media list: ${payload.alreadyInMediaList}`);
  console.log(`Unsearched (min=${config.min}): ${unsearched.length}`);
  console.log(`\nTop ${Math.min(20, candidateRows.length)} new candidates:`);
  candidateRows.slice(0, 20).forEach((c, i) => {
    console.log(
      `  ${i + 1}. ${c.name} [${c.speakerName}] (${c.party}, ${c.house}) — ${c.utteranceCount} utt.`
    );
  });
}

main();
