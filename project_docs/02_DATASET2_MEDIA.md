# Dataset 2: Media Statements Collection

## Goal

Collect public media statements about AI by UK politicians and peers from major news outlets (2020–2026), to enable comparison with their parliamentary discourse.

## Strategy

Traditional news APIs (NewsAPI, GDELT) have limited historical access and paywalled archives. Instead, we used the **OpenAI Responses API with `web_search` tool** — effectively using an LLM-powered web search to find, retrieve, and extract relevant articles.

## Collection Pipeline

### Step 1: Identify Politicians to Search

**Script**: `extractTopSpeakers.js`

- Reads Dataset 1 (parliamentary data) to find the most active AI speakers
- Ranks by utterance count
- Maps ParlaMint legal names to public-facing names (manual alias file for Lords: "Thomas Ashton" → "Viscount Camrose", "Timothy Francis Clement-Jones" → "Lord Clement-Jones", etc.)
- Outputs `speakers_to_search.json`

**Initial run**: Top 40 speakers from parliamentary data
**Expansion**: Added 50 additional politicians from `media_expansion_candidates.json` — manually curated list including David Davis, Damian Collins, Liz Truss, Baroness Ludford, Lord Bethell, etc.

### Step 2: Fetch Media Articles

**Script**: `fetchMediaStatements.js`

- For each politician, constructs 8 search queries combining their name with AI keywords:
  - `"[name] artificial intelligence"`, `"[name] AI policy"`, `"[name] AI regulation"`, `"[name] AI safety"`, `"[name] machine learning"`, `"[name] AI technology"`, `"[name] AI ethics"`, `"[name] AI innovation"`
- Calls OpenAI Responses API with `web_search` tool enabled
- Model: `gpt-4o-mini` (via `OPENAI_MODEL` env var) — chosen for cost efficiency at scale
- Extracts: article URL, title, source outlet, publication date, full article text, relevant quotes
- Saves one JSON file per politician in `media_statements/raw/`
- Supports `--onlyNew` flag to skip already-completed politicians (resumability)
- Rate-limited with configurable `--delay` (default 2000ms)

**Key design choice**: Using `gpt-4o-mini` rather than `gpt-4o` — the web search tool does the heavy lifting of finding articles; the model only needs to extract structured data from the search results. This kept API costs manageable across 127 politicians × 8 queries each.

### Step 3: Merge and Clean

**Script**: `mergeMediaStatements.js`

- Reads all `raw/*.json` files
- Deduplicates by URL
- Cleans article text: removes navigation elements, cookie banners, subscription prompts, boilerplate footers
- Outputs a master CSV with standardised columns matching Dataset 1 format
- `--report` flag prints collection statistics

### Orchestrator

**Script**: `masterMediaExpansion.js`

Runs all three steps end-to-end:

```bash
node masterMediaExpansion.js --top 40 --provider openai --delay 2000
```

Key flags:
- `--top N`: Number of top speakers to extract (default 40)
- `--provider`: Search provider (default "openai")
- `--delay`: Milliseconds between API calls
- `--onlyNew`: Skip completed politicians
- `--skip-fetch`: Run extract + merge only
- `--skip-extract`: Run fetch + merge only (reuse existing speakers list)
- `--dry-run`: Print commands without executing
- `--force`: Re-run ignoring prior state

State tracking via `fetch_state.json` enables safe resumption after interruptions.

## Results

### Initial Collection
- 28 politicians → 270 media statements

### Expanded Collection
- **127 politicians** completed (0 failed)
- **1,215 media statements** total (after dedup)
- **Sources**: BBC, Guardian, Telegraph, Independent, Sky News, Financial Times, The Times, government press releases, tech media outlets
- **Period**: 2020–2026

### Party Coverage in Media Dataset

| Party | Media texts | % of media |
|-------|-----------|------------|
| Conservative | 571 | 47.0% |
| Labour | 340 | 28.0% |
| Liberal Democrat | 121 | 10.0% |
| Crossbench | 68 | 5.6% |
| Independent | 38 | 3.1% |
| Bishops | 22 | 1.8% |
| Green | 20 | 1.6% |
| SNP | 16 | 1.3% |

## Technical Details

### Environment Variables

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

### File Structure

```
media_statements/
├── raw/                          # 127 individual JSON files
│   ├── Matt_Hancock.json
│   ├── Keir_Starmer.json
│   ├── Rishi_Sunak.json
│   └── ... (127 files)
├── speakers_to_search.json       # Generated speaker list
├── media_expansion_candidates.json  # Manual expansion list
├── fetch_state.json              # Resumability state
└── media_master.csv              # Merged output
```

### Challenges and Solutions

1. **Name disambiguation**: Lords have legal names (ParlaMint) vs courtesy titles (media). Solved with manual alias mapping.
2. **Article quality**: Web search returns some low-quality or tangential results. Mitigated by using 8 specific keyword combinations and cleaning in merge step.
3. **Cost management**: 127 politicians × 8 queries × ~$0.01/query ≈ $10 total API cost using gpt-4o-mini.
4. **Resumability**: `--onlyNew` flag + `fetch_state.json` allows stopping and restarting without re-fetching completed politicians.
5. **Web scraping artefacts**: Navigation text, subscription prompts, and boilerplate leak into article text. Cleaned in merge step and handled in NLP pipeline via custom stop words.
