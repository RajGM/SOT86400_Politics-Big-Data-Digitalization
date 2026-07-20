# Dataset 1: Parliamentary Data Collection

## Goal

Collect all AI-related parliamentary utterances from the UK Parliament (House of Commons + House of Lords) for the period 2020–2026, with speaker identification, party affiliation, and chamber metadata.

## Sources

### Source A: ParlaMint 4.0 Corpus

**What it is**: ParlaMint is a standardised, TEI-encoded XML corpus of parliamentary proceedings from 29 national parliaments, maintained by the CLARIN research infrastructure. Version 4.0 covers UK parliamentary proceedings (ParlaMint-GB) from 2015 to mid-2022.

**How we used it**:

1. Downloaded the ParlaMint-GB `.ana` (annotated) TEI-XML files
2. Built `parseParlaMint.js` — a Node.js parser that:
   - Reads TEI-XML files using `xml2js`
   - Extracts `<u>` (utterance) elements with their `who` attribute (speaker ID)
   - Resolves speaker metadata from `<person>` elements in the corpus header: legal name, party abbreviation (`partyAbbrev`), party name (`partyName`)
   - Filters for AI-related content using keyword matching on utterance text
   - Outputs structured JSON with fields: `speakerName`, `partyAbbrev`, `partyName`, `sourceFile`, `text`, `date`
3. Extracted **1,013 AI-related records** for the 2020–2022 period

**Key technical detail**: ParlaMint uses legal names (e.g., "Timothy Francis Clement-Jones" not "Lord Clement-Jones") and stores party info in `partyAbbrev`/`partyName` fields — not a simple `party` key. This required specific field mapping in the NLP pipeline later.

**Output file**: `parlamint_parsed/parlamint_ai_debates.json`

### Source B: Hansard Digital Archive

**What it is**: The official, edited record of UK parliamentary debates, available via a JSON API at `hansard-api.parliament.uk`.

**How we used it**:

1. Built `scrapeHansard.js` — scrapes the Hansard API:
   - Searches for debates by AI-related terms from a curated list of ~100 search terms (`searchTerms.js`)
   - For each matching debate, fetches full debate text via `fetchHansardText.js`
   - Extracts individual speeches with: `speakerName`, `party`, `debateDate`, `chamber` (Commons/Lords), `debateTitle`
   - Handles pagination, rate limiting, and resumability
2. Built `master.js` — orchestrator that runs the full pipeline:
   - Iterates through unsearched terms
   - Tracks searched/unsearched state in `searchTerms.js`
   - Deduplicates by debate ID
3. Collected **2,224 speeches** for the period 2020–2026

**Data quality issue discovered**: The Hansard API sometimes leaks speaker names into the `party` field (e.g., "Saqib Bhatti", "Caroline Nokes" appearing as party values). This was fixed in the NLP pipeline's `normalize_party()` function — any value with a space and uppercase first letter is treated as "Unknown".

**Output file**: `hansard_debates/hansard_all_speeches.json`

### Combined Dataset 1

- **Total**: 3,141 parliamentary utterances
- **Period**: 2020–2026
- **Chambers**: House of Commons + House of Lords
- **Speakers**: ~900+ unique speakers
- **Party coverage**: Conservative, Labour, Liberal Democrat, SNP, DUP, Green, Crossbench, Bishops, Independent, Plaid Cymru, UUP

## Scripts

| Script | Purpose | Key flags |
|--------|---------|-----------|
| `parseParlaMint.js` | Parse TEI-XML → JSON | `--input`, `--output` |
| `scrapeHansard.js` | Scrape Hansard API | `--term`, `--from`, `--to` |
| `fetchHansardText.js` | Fetch full debate text | `--debateId` |
| `master.js` | Orchestrate full Hansard collection | `--limit`, `--delay` |
| `searchTerms.js` | Curated AI search terms with state | — (data file) |

## Challenges and Solutions

1. **ParlaMint field mapping**: ParlaMint uses `partyAbbrev` not `party`. Fixed by reading `partyAbbrev` → `partyName` → `party` as fallback chain.
2. **Hansard party field pollution**: Speaker names leaking into party field. Fixed with heuristic detection in `normalize_party()`.
3. **ParlaMint legal names vs public names**: Required manual alias mapping for cross-referencing with media dataset (e.g., "Timothy Francis Clement-Jones" = "Lord Clement-Jones").
4. **House detection**: ParlaMint stores chamber info in `sourceFile` path, not a dedicated field. Parsed from filename pattern.
