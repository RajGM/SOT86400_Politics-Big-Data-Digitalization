# Visualisations

## Overview

7 figures generated for the report, produced via two Colab scripts reading from `analysis_output_v2_collab/data_matrix.csv`.

**Scripts**:
- `colab_plots.py` — Figures 1–6 (data-driven)
- `colab_pipeline_diagram.py` — Figure 7 (methodology diagram)

## How to Generate

### Figures 1–6
1. Open Google Colab
2. Upload `colab_plots.py` and `data_matrix.csv`
3. Run the single cell
4. Downloads `figures.zip` containing all 6 PNGs

### Figure 7
1. Upload `colab_pipeline_diagram.py` to Colab
2. Run — no data files needed
3. Downloads `fig7_methodology_pipeline.png`

Place all PNGs in `ReportTemplate/figures/`.

## Figure Descriptions

### Figure 1: Frame Distribution by Arena (`fig1_frames_by_arena.png`)

Grouped bar chart comparing the 5 imagined-futures frames across parliament and media.

Key visual: Parliament bars are roughly even; media's economic-industrial bar towers over all others. Shows the compression from pluralistic parliamentary discourse to media's economic dominance.

### Figure 2: Sentiment Distributions by Arena (`fig2_sentiment_by_arena.png`)

Two overlapping histograms showing the distribution of combined sentiment scores.

Key visual: Parliament distribution is right-shifted (positive), broad. Media distribution clusters tightly near zero with a negative skew. Vertical dashed lines mark the means.

### Figure 3: Party Sentiment by Arena (`fig3_party_sentiment_arena.png`)

Grouped bar chart — each party has two bars (parliament, media).

Key visual: Every pair shows the same pattern: tall positive parliament bar, short or negative media bar. The universal direction of the shift is immediately visible.

### Figure 4: Arena Shift Slopes (`fig4_arena_shift_slopes.png`)

Slope chart connecting each party's parliament sentiment to its media sentiment.

Key visual: All lines slope downward from left to right. No party bucks the trend. The parallel slopes demonstrate that the arena effect is systematic, not driven by any single party.

### Figure 5: Frame Distribution by Party (`fig5_frames_by_party.png`)

Stacked bar chart showing the composition of frames within each party's discourse.

Key visual: Shows that all parties have similar frame mixes, with economic-industrial and utopian-opportunity as the largest segments. Liberal Democrats have a notably higher proportion of dystopian-risk.

### Figure 6: VADER vs DistilBERT Triangulation (`fig6_triangulation_comparison.png`)

Grouped bar chart comparing VADER and DistilBERT scores for parliament and media.

Key visual: The four bars tell the whole triangulation story. Parliament: both methods positive (agreement). Media: VADER positive, DistilBERT strongly negative (divergence). This is the figure that justifies the dual-method approach.

### Figure 7: Methodology Pipeline (`fig7_methodology_pipeline.png`)

Three-row flowchart showing the research methodology:
- **Row 1 (Data Collection)**: ParlaMint + Hansard → Corpus Assembly ← OpenAI web_search
- **Row 2 (NLP Analysis)**: Topic Modelling | Sentiment Analysis (Triangulation) | Frame Classification
- **Row 3 (Outputs)**: Comparative Analysis | Key Outputs | Report & Findings

Includes a technical stack sidebar listing platforms and libraries.

## Colour Scheme

All plots use `matplotlib` with a consistent professional palette. Arena comparisons use blue (parliament) and orange/red (media) throughout for visual consistency.

## LaTeX Integration

Figures are referenced in `report.tex` as:

```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=0.85\textwidth]{figures/fig1_frames_by_arena.png}
  \caption{Distribution of imagined-futures frames by arena.}
  \label{fig:frames-arena}
\end{figure}
```

All 7 figures have corresponding `\label` and at least one `\ref` cross-reference in the report body.
