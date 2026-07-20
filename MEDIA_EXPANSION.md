# Dataset 2 media expansion (3 steps)

Expand media coverage beyond the hardcoded ~28 politicians in `fetchMediaStatements.js` by mining top AI speakers from ParlaMint (Dataset 1).

**Do not commit `.env` secrets. Scripts never print key values.**

## One-command run

```bash
npm run media:expand
# same as:
node masterMediaExpansion.js
```

Useful flags: `--top 40`, `--limit 30`, `--delay 2000`, `--provider openai`, `--force`, `--skip-fetch`, `--skip-extract`, `--dry-run`.

---

## Step 1 — Rank speakers & pick unsearched names

```bash
node extractTopSpeakers.js --top 40
```

Optional flags:

```bash
node extractTopSpeakers.js --top 50 --min 2
node extractTopSpeakers.js --all          # use parlamint_ai_debates_ALL.csv (pre+post 2020)
node extractTopSpeakers.js --csv path\to\file.csv
```

Outputs (under `media_statements/`):

| File | Purpose |
|------|---------|
| `dataset1_speakers_ranked.csv` | All speakers, utterance counts, `already_in_media_list` |
| `speakers_to_search.json` | Top N unsearched politicians for Step 2 |
| `media_expansion_candidates.json` | Alias of the same JSON |
| `media_expansion_names.txt` | One name per line |

Default source: `parlamint_parsed/parlamint_ai_debates.csv` (~418 speakers).

---

## Step 2 — Fetch media statements for those names

Uses the **same** keywords, outlets, and pipeline as the original script. Requires a search key in `.env` (e.g. `OPENAI_API_KEY`).

```bash
# Recommended: resume-friendly expansion of the candidate list
node fetchMediaStatements.js --provider openai --from media_statements/speakers_to_search.json --onlyNew --limit 30 --delay 2000
```

Alternatives:

```bash
# Full candidate file (up to top N from Step 1)
node fetchMediaStatements.js --provider openai --from media_statements/speakers_to_search.json --onlyNew --delay 2000

# Explicit comma-separated names
node fetchMediaStatements.js --provider openai --politicians "Robert Seely,Damian Collins,Liz Truss" --delay 2000

# Alias flag (same as --from)
node fetchMediaStatements.js --politiciansFile media_statements/speakers_to_search.json --onlyNew --limit 30
```

Notes:

- `--onlyNew` only processes pending/failed entries (safe to re-run after interruptions).
- Progress is saved under `media_statements/raw/<name>.json` and `media_statements/fetch_state.json`.
- Start with `--limit 30` if cost/time is a concern; raise later.

---

## Step 3 — Merge raw JSON → master CSV

After Step 2 (or any partial run):

```bash
node mergeMediaStatements.js --report
```

Writes/updates:

- `media_statements/media_statements_all.csv` (deduped by politician + URL)
- `media_statements/merge_report.json` (with `--report`)

---

## npm shortcuts

```bash
npm run media:expand          # full pipeline (recommended)
npm run extract:speakers
npm run fetch:media:expand
npm run merge:media
```
