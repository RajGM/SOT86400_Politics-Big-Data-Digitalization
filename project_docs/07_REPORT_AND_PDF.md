# Report Compilation and PDF Generation

## LaTeX Setup

### Template: TUM Book Class

The report uses TUM's official LaTeX template (`tum-book.cls`) with the following structure:

```
ReportTemplate/
├── main.tex              # Root document
├── chapters/
│   └── report.tex        # Full report body (~4,115 words)
├── figures/              # 7 PNG figures
├── literature.bib        # BibLaTeX-APA bibliography (12 entries)
├── tum-book.cls          # TUM document class
├── tum-base.sty          # TUM base styles
└── main.pdf              # Compiled output
```

### main.tex Key Configuration

```latex
\documentclass[oneside]{tum-book}
\title{Imagined Futures of Artificial Intelligence in UK Politics}
\subtitle{A Comparative Analysis of Parliamentary Debates
          and Media Statements (2020--2026)}
\author{Raj Gaurav Maurya (03812304)}
```

Bibliography: `\addbibresource{literature.bib}` with `biblatex-apa` style.

## Build Process

### Compiler: Tectonic

[Tectonic](https://tectonic-typesetting.github.io/) — a self-contained LaTeX engine that auto-downloads packages. No TeX Live installation required.

### Biber Version Compatibility

Tectonic's bundled biblatex produces `.bcf` version 3.8. This requires biber 2.17 specifically:

| biber version | Expected bcf | Result |
|---------------|-------------|--------|
| 2.19 | 3.10 | ❌ Version mismatch |
| 2.20 | 3.11 | ❌ Version mismatch |
| **2.17** | **3.8** | ✅ Works |

biber 2.17 downloaded from SourceForge (`biblatex-biber/2.17/binaries/Linux/biber-linux_x86_64.tar.gz`).

### Build Script (reproducible)

```bash
# 1. Copy source to build directory (avoid modifying originals)
cp -r ReportTemplate/ /tmp/build_report/
cd /tmp/build_report/

# 2. Apply patches to TUM class files
# tum-base.sty: comment out \RequirePackage[gen]{eurosym} and \DeclareUnicodeCharacter
# tum-book.cls: comment out \titleformat*, \pdfimageresolution, \pgfplotsset
# main.tex: remove stray \\ after \author{}, comment out \usepackage[table]{xcolor}

# 3. First pass (generates .bcf for biber)
/tmp/tectonic main.tex

# 4. Run biber for bibliography
PATH="/tmp:$PATH" /tmp/biber main

# 5. Second + third pass (resolves references)
/tmp/tectonic main.tex
/tmp/tectonic main.tex

# 6. Copy PDF back
cp main.pdf /path/to/ReportTemplate/main.pdf
```

## Patches Required

### tum-base.sty (line 21)

```latex
% \RequirePackage[gen]{eurosym}    % COMMENTED: eurosym not in Tectonic
% \DeclareUnicodeCharacter{20AC}{...}  % COMMENTED: depends on eurosym
```

**Reason**: Tectonic doesn't bundle the `eurosym` package. The euro symbol is unused in this report.

### tum-book.cls

```latex
% \titleformat*{\section}{...}     % COMMENTED: "not allowed in easy settings"
% \titleformat*{\subsection}{...}  % COMMENTED: same error
% \pdfimageresolution 300          % COMMENTED: pdfTeX primitive, not in XeTeX
% \pgfplotsset{compat=1.3}         % COMMENTED: pgfplots not loaded
```

**Reason**: Tectonic uses XeTeX internally; some pdfTeX primitives and titlesec "easy" settings are incompatible.

### main.tex

```latex
\author{Raj Gaurav Maurya (03812304)}
% Removed stray \\ that caused "no line here to end" error

% \usepackage[table]{xcolor}  % COMMENTED: xcolor already loaded by cls
```

## Report Structure

The report body (`chapters/report.tex`) contains:

1. **Introduction** — Research questions, hypothesis, scope
2. **Literature Review** — Beckert, Suckert, Constantino, Friedrich
3. **Methodology** — Data collection, NLP pipeline, triangulation approach
4. **Results** — 3 tables, 7 figures, cross-referenced throughout
5. **Discussion** — Arena effect interpretation, VADER-DistilBERT divergence
6. **Conclusion** — Summary, limitations, future work

### Tables
- `tab:frames-arena` — Frame distribution by arena (5 frames × 2 arenas)
- `tab:sentiment-arena` — Sentiment scores by arena (VADER, DistilBERT, combined)
- `tab:party-sentiment` — Party × arena sentiment breakdown

### Figures
- `fig:frames-arena` through `fig:pipeline` — 7 figures, all with `\label` and `\ref`

### Word Count
Final body: ~4,115 words (target: 4,000–5,000). Verified with a custom Python script that strips LaTeX commands, figure/table environments, and bibliography.

## Submission Checklist

- [x] Word count within 4,000–5,000 range
- [x] All 10 cross-references resolve (no "??" in PDF)
- [x] All 12 citations present in literature.bib
- [x] No orphaned labels (every `\label` has a `\ref`)
- [x] TUM cover page with student number, examiner, module code
- [x] Bibliography in APA format
- [ ] Real figure PNGs (run Colab scripts, place in `figures/`)
- [ ] Final PDF rebuild with real figures
