/**
 * ParlaMint-GB Parser — Extract AI-related debate segments
 *
 * Parses TEI XML files from the ParlaMint-GB corpus, filters for
 * utterances mentioning AI-related terms, and outputs structured
 * JSON + CSV with speaker/party metadata.
 *
 * Steps:
 *   1. Load speaker→party mapping from ParlaMint-GB-listPerson.xml
 *   2. Load party ID→name mapping from ParlaMint-GB-listOrg.xml
 *   3. Scan all debate XML files for AI-related utterances
 *   4. Output filtered results with full metadata
 *
 * Usage:
 *   node parseParlaMint.js [options]
 *
 * Options:
 *   --corpusDir   Path to ParlaMint-GB.TEI directory
 *   --outDir      Output directory (default: ./parlamint_parsed)
 *   --minYear     Minimum year to include (default: 2015)
 *   --maxYear     Maximum year to include (default: 2025)
 */

const fs = require("fs");
const path = require("path");

// --- Simple streaming XML helpers (no dependencies) ---

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    corpusDir: path.join(__dirname, "ParlaMint", "ParlaMint-GB", "ParlaMint-GB.TEI"),
    outDir: path.join(__dirname, "parlamint_parsed"),
    minYear: 2015,
    maxYear: 2025,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--corpusDir": parsed.corpusDir = args[++i]; break;
      case "--outDir":    parsed.outDir = args[++i]; break;
      case "--minYear":   parsed.minYear = parseInt(args[++i], 10); break;
      case "--maxYear":   parsed.maxYear = parseInt(args[++i], 10); break;
    }
  }
  return parsed;
}

const CONFIG = parseArgs();

// --- AI search terms (case-insensitive matching) ---
const AI_TERMS = [
  "artificial intelligence",
  "machine learning",
  "deep learning",
  "neural network",
  "large language model",
  "generative ai",
  "facial recognition",
  "biometric",
  "automated decision",
  "algorithmic",
  "deepfake",
  "chatgpt",
  "openai",
  "ai regulation",
  "ai safety",
  "ai ethics",
  "ai governance",
  "ai framework",
  "frontier ai",
  "foundation model",
  "superintelligence",
  "existential risk",
  "ai risk",
  "bletchley",
  "ai safety summit",
  "ai safety institute",
  "alan turing institute",
  "centre for data ethics",
  "predictive policing",
  "computer vision",
  "natural language processing",
  "ai act",
  "ai white paper",
  "pro-innovation",
  "ai taskforce",
  "ai sandbox",
  "responsible ai",
  "trustworthy ai",
];

// Also match standalone patterns
const AI_PATTERNS = [
  /\bA\.?I\.?\b/,                     // "AI" as standalone word
  /\bartificial\s+intelligence\b/i,
  /\bmachine\s+learning\b/i,
  /\bdeep\s+learning\b/i,
  /\blarge\s+language\s+model/i,
  /\bLLM\b/,
  /\bGPT\b/,
  /\bchatbot/i,
  /\brobot(?:ic)?s?\b/i,
  /\bautonomous\s+(?:weapon|vehicle|system)/i,
  /\bdata\s+(?:ethics|protection|privacy)/i,
];

function textMatchesAI(text) {
  const lower = text.toLowerCase();
  for (const term of AI_TERMS) {
    if (lower.includes(term)) return true;
  }
  for (const pat of AI_PATTERNS) {
    if (pat.test(text)) return true;
  }
  return false;
}

function getMatchedTerms(text) {
  const matches = [];
  const lower = text.toLowerCase();
  for (const term of AI_TERMS) {
    if (lower.includes(term)) matches.push(term);
  }
  for (const pat of AI_PATTERNS) {
    if (pat.test(text)) matches.push(pat.source);
  }
  return [...new Set(matches)];
}

// --- Minimal XML parsing using regex (avoids npm dependencies) ---
// Works for ParlaMint's well-structured TEI XML

function extractAttr(tag, attrName) {
  const m = tag.match(new RegExp(`${attrName}="([^"]*)"`));
  return m ? m[1] : null;
}

function stripTags(xml) {
  return xml.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, " ").trim();
}

// --- Load speaker metadata ---

function loadPersonMap(filePath) {
  console.log("Loading speaker metadata...");
  const xml = fs.readFileSync(filePath, "utf-8");
  const persons = {};

  // Match each <person> block
  const personBlocks = xml.match(/<person[\s\S]*?<\/person>/g) || [];
  for (const block of personBlocks) {
    const id = extractAttr(block, 'xml:id');
    if (!id) continue;

    // Name
    const forenames = [];
    const fnMatches = block.match(/<forename>([^<]*)<\/forename>/g) || [];
    for (const fn of fnMatches) {
      forenames.push(fn.replace(/<\/?forename>/g, ""));
    }
    const surnameMatch = block.match(/<surname>([^<]*)<\/surname>/);
    const surname = surnameMatch ? surnameMatch[1] : "";

    // Party affiliations (get the most recent one)
    const affiliations = [];
    const affMatches = block.match(/<affiliation[^>]*\/>/g) || [];
    for (const aff of affMatches) {
      const ref = extractAttr(aff, 'ref');
      const from = extractAttr(aff, 'from');
      const to = extractAttr(aff, 'to');
      const role = extractAttr(aff, 'role');
      if (ref && ref.startsWith("#party.")) {
        affiliations.push({
          partyRef: ref.replace("#", ""),
          from: from || "",
          to: to || "",
          role: role || "",
        });
      }
    }

    // Sort affiliations by 'from' descending, pick the most recent without a 'to' (or latest 'to')
    affiliations.sort((a, b) => b.from.localeCompare(a.from));
    const currentParty = affiliations.find(a => !a.to) || affiliations[0] || null;

    // Sex
    const sexMatch = block.match(/<sex value="([^"]*)"/);

    persons[id] = {
      name: [...forenames, surname].filter(Boolean).join(" "),
      surname,
      forenames: forenames.join(" "),
      sex: sexMatch ? sexMatch[1] : "",
      partyRef: currentParty ? currentParty.partyRef : "",
      allAffiliations: affiliations,
    };
  }
  console.log(`  Loaded ${Object.keys(persons).length} speakers.`);
  return persons;
}

function loadOrgMap(filePath) {
  console.log("Loading organisation metadata...");
  const xml = fs.readFileSync(filePath, "utf-8");
  const orgs = {};

  const orgBlocks = xml.match(/<org[\s\S]*?<\/org>/g) || [];
  for (const block of orgBlocks) {
    const id = extractAttr(block, 'xml:id');
    if (!id) continue;

    const nameMatches = block.match(/<orgName[^>]*>([^<]*)<\/orgName>/g) || [];
    let fullName = "";
    let abbrev = "";
    for (const nm of nameMatches) {
      if (nm.includes('full="yes"')) {
        fullName = nm.replace(/<orgName[^>]*>/, "").replace(/<\/orgName>/, "").replace(/&amp;/g, "&");
      } else if (nm.includes('full="abb"')) {
        abbrev = nm.replace(/<orgName[^>]*>/, "").replace(/<\/orgName>/, "");
      }
    }

    const role = extractAttr(block.match(/<org[^>]*>/)?.[0] || "", 'role');
    orgs[id] = { fullName, abbrev, role: role || "" };
  }
  console.log(`  Loaded ${Object.keys(orgs).length} organisations.`);
  return orgs;
}

// --- Parse a single debate file ---

function parseDebateFile(filePath, persons, orgs) {
  const xml = fs.readFileSync(filePath, "utf-8");
  const results = [];

  // Extract file-level metadata
  const fileName = path.basename(filePath, ".xml");
  const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : "";
  const chamber = fileName.includes("-commons") ? "Commons" : fileName.includes("-lords") ? "Lords" : "Unknown";

  // Extract debate sections (div elements with heads)
  // We'll work at the utterance level
  const utteranceBlocks = xml.match(/<u [\s\S]*?<\/u>/g) || [];

  // Also track which debateSection each utterance belongs to
  // Build a map of debateSection heads
  const sections = [];
  const divRegex = /<div[^>]*>[\s\S]*?(?=<div[^>]*>|<\/body>)/g;
  let divMatch;
  // Simpler: find all <head> tags and their positions
  const headRegex = /<head[^>]*>([\s\S]*?)<\/head>/g;
  let headMatch;
  const heads = [];
  while ((headMatch = headRegex.exec(xml)) !== null) {
    heads.push({
      position: headMatch.index,
      text: stripTags(headMatch[1]),
    });
  }

  for (const uBlock of utteranceBlocks) {
    // Get all <seg> text within this utterance
    const segTexts = [];
    const segRegex = /<seg[^>]*>([\s\S]*?)<\/seg>/g;
    let segMatch;
    while ((segMatch = segRegex.exec(uBlock)) !== null) {
      segTexts.push(stripTags(segMatch[1]));
    }
    const fullText = segTexts.join(" ");

    // Check if this utterance is AI-related
    if (!textMatchesAI(fullText)) continue;

    // Extract speaker
    const who = extractAttr(uBlock, 'who');
    const speakerId = who ? who.replace("#", "") : "";
    const speaker = persons[speakerId] || { name: speakerId, surname: "", forenames: "", sex: "", partyRef: "" };

    // Resolve party name
    const partyInfo = orgs[speaker.partyRef] || { fullName: speaker.partyRef, abbrev: "" };

    // Find which debate section this utterance belongs to
    const uPos = xml.indexOf(uBlock);
    let sectionHead = "";
    for (let i = heads.length - 1; i >= 0; i--) {
      if (heads[i].position < uPos) {
        sectionHead = heads[i].text;
        break;
      }
    }

    const uId = extractAttr(uBlock, 'xml:id') || "";
    const matchedTerms = getMatchedTerms(fullText);

    results.push({
      utteranceId: uId,
      date,
      chamber,
      debateSection: sectionHead,
      speakerId,
      speakerName: speaker.name,
      speakerSex: speaker.sex,
      partyId: speaker.partyRef,
      partyName: partyInfo.fullName,
      partyAbbrev: partyInfo.abbrev,
      text: fullText,
      wordCount: fullText.split(/\s+/).length,
      matchedTerms: matchedTerms.join("; "),
      sourceFile: fileName,
    });
  }

  return results;
}

// --- CSV helper ---

function escapeCSV(val) {
  const s = String(val || "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCSVRow(obj, headers) {
  return headers.map(h => escapeCSV(obj[h])).join(",");
}

// --- Main ---

function main() {
  if (!fs.existsSync(CONFIG.outDir)) {
    fs.mkdirSync(CONFIG.outDir, { recursive: true });
  }

  const personFile = path.join(CONFIG.corpusDir, "ParlaMint-GB-listPerson.xml");
  const orgFile = path.join(CONFIG.corpusDir, "ParlaMint-GB-listOrg.xml");

  if (!fs.existsSync(personFile)) {
    console.error(`Person file not found: ${personFile}`);
    process.exit(1);
  }
  if (!fs.existsSync(orgFile)) {
    console.error(`Org file not found: ${orgFile}`);
    process.exit(1);
  }

  const persons = loadPersonMap(personFile);
  const orgs = loadOrgMap(orgFile);

  // Find all year directories
  const yearDirs = fs.readdirSync(CONFIG.corpusDir)
    .filter(d => /^\d{4}$/.test(d))
    .filter(d => {
      const y = parseInt(d, 10);
      return y >= CONFIG.minYear && y <= CONFIG.maxYear;
    })
    .sort();

  console.log(`\nProcessing years: ${yearDirs.join(", ")}`);

  let allResults = [];
  let totalFiles = 0;
  let filesWithMatches = 0;

  for (const year of yearDirs) {
    const yearPath = path.join(CONFIG.corpusDir, year);
    const xmlFiles = fs.readdirSync(yearPath).filter(f => f.endsWith(".xml")).sort();
    console.log(`\n${year}: ${xmlFiles.length} debate files`);

    let yearMatches = 0;
    for (const file of xmlFiles) {
      totalFiles++;
      const filePath = path.join(yearPath, file);
      try {
        const results = parseDebateFile(filePath, persons, orgs);
        if (results.length > 0) {
          filesWithMatches++;
          yearMatches += results.length;
          allResults.push(...results);
        }
      } catch (err) {
        console.error(`  Error parsing ${file}: ${err.message}`);
      }
    }
    console.log(`  → ${yearMatches} AI-related utterances found`);
  }

  // --- Output ---
  console.log(`\n${"=".repeat(60)}`);
  console.log("PARLAMINT PARSING SUMMARY");
  console.log(`${"=".repeat(60)}`);
  console.log(`Total debate files scanned:  ${totalFiles}`);
  console.log(`Files with AI mentions:      ${filesWithMatches}`);
  console.log(`Total AI-related utterances: ${allResults.length}`);

  // Stats by party
  const byParty = {};
  for (const r of allResults) {
    const key = r.partyName || r.partyId || "Unknown";
    byParty[key] = (byParty[key] || 0) + 1;
  }
  console.log(`\nUtterances by party:`);
  Object.entries(byParty)
    .sort((a, b) => b[1] - a[1])
    .forEach(([party, count]) => console.log(`  ${party}: ${count}`));

  // Stats by year
  const byYear = {};
  for (const r of allResults) {
    const y = r.date.substring(0, 4);
    byYear[y] = (byYear[y] || 0) + 1;
  }
  console.log(`\nUtterances by year:`);
  Object.entries(byYear).sort().forEach(([y, c]) => console.log(`  ${y}: ${c}`));

  // Stats by chamber
  const byChamber = {};
  for (const r of allResults) {
    byChamber[r.chamber] = (byChamber[r.chamber] || 0) + 1;
  }
  console.log(`\nUtterances by chamber:`);
  Object.entries(byChamber).forEach(([ch, c]) => console.log(`  ${ch}: ${c}`));

  // Save JSON
  const jsonPath = path.join(CONFIG.outDir, "parlamint_ai_debates.json");
  fs.writeFileSync(jsonPath, JSON.stringify(allResults, null, 2), "utf-8");
  console.log(`\nSaved JSON: ${jsonPath} (${allResults.length} records)`);

  // Save CSV
  const headers = [
    "utteranceId", "date", "chamber", "debateSection",
    "speakerId", "speakerName", "speakerSex",
    "partyId", "partyName", "partyAbbrev",
    "text", "wordCount", "matchedTerms", "sourceFile",
  ];
  const csvLines = [headers.join(",")];
  for (const r of allResults) {
    csvLines.push(toCSVRow(r, headers));
  }
  const csvPath = path.join(CONFIG.outDir, "parlamint_ai_debates.csv");
  fs.writeFileSync(csvPath, csvLines.join("\n"), "utf-8");
  console.log(`Saved CSV:  ${csvPath}`);

  // Save debate section summary
  const bySectionParty = {};
  for (const r of allResults) {
    const key = `${r.date} | ${r.debateSection}`;
    if (!bySectionParty[key]) {
      bySectionParty[key] = { date: r.date, chamber: r.chamber, section: r.debateSection, utterances: 0, speakers: new Set(), parties: new Set() };
    }
    bySectionParty[key].utterances++;
    bySectionParty[key].speakers.add(r.speakerName);
    bySectionParty[key].parties.add(r.partyName || r.partyId);
  }

  const sectionSummary = Object.values(bySectionParty).map(s => ({
    date: s.date,
    chamber: s.chamber,
    debateSection: s.section,
    utterances: s.utterances,
    uniqueSpeakers: s.speakers.size,
    parties: [...s.parties].join("; "),
  }));
  sectionSummary.sort((a, b) => b.utterances - a.utterances);

  const summaryPath = path.join(CONFIG.outDir, "parlamint_debate_sections.json");
  fs.writeFileSync(summaryPath, JSON.stringify(sectionSummary, null, 2), "utf-8");
  console.log(`Saved debate sections summary: ${summaryPath} (${sectionSummary.length} sections)`);

  console.log("\nDone.");
}

main();
