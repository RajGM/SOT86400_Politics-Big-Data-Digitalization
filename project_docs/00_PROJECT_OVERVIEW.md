# Project Overview: Imagined Futures of AI in UK Politics

## Project Details

- **Title**: Imagined Futures of Artificial Intelligence in UK Politics
- **Subtitle**: A Comparative Analysis of Parliamentary Debates and Media Statements (2020–2026)
- **Module**: (SOT86065) Politics of Big-Data and Digitalization
- **Programme**: M.Sc. Data & Society, TUM School of Social Sciences and Technology
- **Author**: Raj Gaurav Maurya (03812304)
- **Examiner**: Prof. Daria Gritsenko Ph.D.
- **Credits**: 6 ECTS
- **Submission Date**: 20 July 2026

## Research Questions

1. What imagined futures do UK elected officials and parliamentarians communicate concerning AI?
2. How do different political groups imagine the future of AI, and does the arena of communication — parliamentary debate versus public media statements — shape the types of futures articulated?

## Hypothesis

The arena of communication systematically shapes the imagined futures articulated: politicians will construct more pluralistic, deliberative futures in parliamentary settings and narrower, more commercially oriented futures in media contexts.

## Key Findings

- Parliament sustains pluralistic AI futures (utopian 25.0%, regulatory 20.0%, economic 17.7%, dystopian 12.8%, ethical 5.0%)
- Media compresses discourse into economic-industrial dominance (45.5%)
- Every party shifts from positive sentiment in Parliament to negative in media — the arena effect is universal, not partisan
- Sentiment gap: Parliament +0.429 vs Media −0.100 (combined VADER + DistilBERT)
- VADER and DistilBERT diverge dramatically on media texts (+0.741 vs −0.941), validating the triangulation approach

## Corpus

- **Total**: 4,356 texts by 1,151 unique speakers
- **Dataset 1 (Parliament)**: 3,141 utterances from ParlaMint 4.0 + Hansard API (2020–2026)
- **Dataset 2 (Media)**: 1,215 statements from 127 politicians via web search (2020–2026)

## Documentation Index

| File | Contents |
|------|----------|
| `01_DATASET1_PARLIAMENT.md` | Parliamentary data collection (ParlaMint + Hansard) |
| `02_DATASET2_MEDIA.md` | Media statements collection and expansion |
| `03_NLP_ANALYSIS.md` | NLP pipeline: sentiment, topics, frames |
| `04_RESULTS_AND_FINDINGS.md` | Complete results with all numbers |
| `05_VISUALISATIONS.md` | Plot generation code and interpretation |
| `06_LITERATURE_REVIEW.md` | Theoretical framework and sources |
| `07_REPORT_AND_PDF.md` | LaTeX report compilation process |
| `08_TECH_STACK.md` | Full technical stack and reproducibility guide |

## Repository Structure

```
PoliticsBigData/
├── project_docs/              # This documentation
├── ReportTemplate/            # TUM LaTeX report + PDF
│   ├── chapters/report.tex    # Final report source
│   ├── literature.bib         # Bibliography
│   ├── figures/               # Generated plots (7 PNGs)
│   └── main.pdf               # Compiled PDF
├── parlamint_parsed/          # ParlaMint JSON output
├── hansard_debates/           # Hansard JSON output
├── media_statements/          # Media collection
│   ├── raw/                   # Individual politician JSONs
│   └── speakers_to_search.json
├── analysis_output_v2_collab/ # NLP pipeline output
│   ├── data_matrix.csv        # 4,356 × 21 columns
│   ├── analysis_summary.json  # Aggregated statistics
│   └── analysis_report.md     # Auto-generated report
├── nlp_analysis.py            # Main NLP pipeline
├── colab_nlp_final.py         # Colab-adapted pipeline
├── colab_plots.py             # Figure generation (6 plots)
├── colab_pipeline_diagram.py  # Methodology pipeline diagram
├── masterMediaExpansion.js    # Media expansion orchestrator
├── fetchMediaStatements.js    # Media article fetcher
├── extractTopSpeakers.js      # Speaker extraction
├── mergeMediaStatements.js    # JSON → CSV merger
├── scrapeHansard.js           # Hansard debate scraper
├── master.js                  # Hansard orchestrator
└── parseParlaMint.js          # ParlaMint TEI-XML parser
```
