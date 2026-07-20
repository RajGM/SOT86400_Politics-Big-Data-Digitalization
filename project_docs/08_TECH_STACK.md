# Technical Stack and Reproducibility Guide

## Languages and Runtimes

| Component | Language | Version |
|-----------|----------|---------|
| Data collection scripts | Node.js | 18+ |
| NLP analysis pipeline | Python | 3.10 |
| Report compilation | LaTeX | Tectonic (XeTeX) |
| Plot generation | Python | 3.10 (Google Colab) |

## Python Dependencies

```
pandas
numpy
scikit-learn          # LDA topic modelling
vaderSentiment        # VADER rule-based sentiment
transformers          # DistilBERT sentiment model
torch                 # PyTorch backend for transformers
matplotlib            # Plotting
```

Install: `pip install pandas numpy scikit-learn vaderSentiment transformers torch matplotlib`

On Colab, `transformers` and `torch` are pre-installed. Only `vaderSentiment` needs explicit install:
```bash
!pip install vaderSentiment
```

## Node.js Dependencies

```
openai                # OpenAI Responses API (media collection)
xml2js                # ParlaMint TEI-XML parsing
csv-writer            # CSV output
```

Install: `npm install openai xml2js csv-writer`

## Key Models

| Model | Type | Source | Use |
|-------|------|--------|-----|
| VADER lexicon | Rule-based | `vaderSentiment` PyPI | Sentiment method 1 |
| `distilbert-base-uncased-finetuned-sst-2-english` | Transformer (66M params) | Hugging Face Hub | Sentiment method 2 |
| LDA (scikit-learn) | Statistical | scikit-learn | Topic modelling |
| `gpt-4o-mini` | LLM | OpenAI API | Media article retrieval |

## APIs and Data Sources

| Source | API | Auth |
|--------|-----|------|
| ParlaMint 4.0 | Static XML download | None |
| Hansard | `hansard-api.parliament.uk` (JSON) | None |
| Media articles | OpenAI Responses API with `web_search` | `OPENAI_API_KEY` |

## Hardware

- **NLP pipeline**: Google Colab with T4 GPU (free tier sufficient). DistilBERT inference on 4,356 texts takes ~3 minutes on T4, ~20 minutes on CPU.
- **Data collection**: Any machine with Node.js. Media collection takes ~2 hours for 127 politicians (rate-limited).
- **Report compilation**: Any machine. Tectonic downloads ~300MB of TeX packages on first run.

## Full Reproduction Steps

### 1. Collect Parliamentary Data

```bash
# ParlaMint (2020-2022)
node parseParlaMint.js --input ./ParlaMint-GB/ --output ./parlamint_parsed/

# Hansard (2020-2026)
node master.js --limit 100 --delay 1000
```

### 2. Collect Media Data

```bash
export OPENAI_API_KEY=sk-...
export OPENAI_MODEL=gpt-4o-mini
node masterMediaExpansion.js --top 40 --delay 2000
# Then expand:
node masterMediaExpansion.js --onlyNew --delay 2000
```

### 3. Run NLP Analysis

```bash
# Local (CPU, slower)
python nlp_analysis.py --outDir ./analysis_output

# Colab (GPU, recommended)
# Upload colab_nlp_final.py + data files → run
```

### 4. Generate Figures

```bash
# In Google Colab:
# Upload colab_plots.py + data_matrix.csv → run → download figures.zip
# Upload colab_pipeline_diagram.py → run → download fig7
# Place all PNGs in ReportTemplate/figures/
```

### 5. Compile Report

```bash
# Download Tectonic + biber 2.17
# Apply patches (see 07_REPORT_AND_PDF.md)
tectonic main.tex && biber main && tectonic main.tex && tectonic main.tex
```

## Directory Structure (complete)

```
PoliticsBigData/
├── project_docs/                    # This documentation (8 files)
├── ReportTemplate/                  # TUM LaTeX report
│   ├── main.tex, main.pdf
│   ├── chapters/report.tex
│   ├── figures/ (7 PNGs)
│   ├── literature.bib
│   ├── tum-book.cls, tum-base.sty
│   └── logos/
├── parlamint_parsed/                # Dataset 1a output
│   └── parlamint_ai_debates.json
├── hansard_debates/                 # Dataset 1b output
│   └── hansard_all_speeches.json
├── media_statements/                # Dataset 2
│   ├── raw/ (127 JSONs)
│   ├── speakers_to_search.json
│   └── media_master.csv
├── analysis_output_v2_collab/       # NLP output
│   ├── data_matrix.csv (4,356 × 21)
│   ├── analysis_summary.json
│   └── analysis_report.md
├── nlp_analysis.py                  # Main NLP script (local)
├── colab_nlp_final.py               # NLP script (Colab)
├── colab_plots.py                   # Figure generation
├── colab_pipeline_diagram.py        # Methodology diagram
├── masterMediaExpansion.js          # Media orchestrator
├── fetchMediaStatements.js          # Media fetcher
├── extractTopSpeakers.js            # Speaker extraction
├── mergeMediaStatements.js          # Media merger
├── scrapeHansard.js                 # Hansard scraper
├── fetchHansardText.js              # Hansard text fetcher
├── master.js                        # Hansard orchestrator
├── parseParlaMint.js                # ParlaMint parser
└── searchTerms.js                   # AI search terms
```
