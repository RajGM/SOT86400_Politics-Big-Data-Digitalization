# ============================================================
# Colab: Methodology Pipeline Diagram (Figure 7)
# Paste into a single cell. No data files needed.
# Outputs: figures/fig7_methodology_pipeline.png
# ============================================================

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import os

os.makedirs("figures", exist_ok=True)

fig, ax = plt.subplots(figsize=(18, 11))
ax.set_xlim(0, 18)
ax.set_ylim(0, 11)
ax.axis("off")
fig.patch.set_facecolor("white")

# --- Colours ---
C_SOURCE   = "#E8F4FD"  # light blue
C_PROCESS  = "#FFF3E0"  # light orange
C_ANALYSIS = "#E8F5E9"  # light green
C_OUTPUT   = "#F3E5F5"  # light purple
C_BORDER_S = "#1565C0"
C_BORDER_P = "#E65100"
C_BORDER_A = "#2E7D32"
C_BORDER_O = "#6A1B9A"
C_ARROW    = "#455A64"

def draw_box(x, y, w, h, title, lines, fill, border, fontsize=8):
    box = FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.15",
                         facecolor=fill, edgecolor=border, linewidth=1.8)
    ax.add_patch(box)
    ax.text(x + w/2, y + h - 0.28, title, ha="center", va="top",
            fontsize=fontsize + 1, fontweight="bold", color=border)
    for i, line in enumerate(lines):
        ax.text(x + w/2, y + h - 0.62 - i * 0.28, line, ha="center", va="top",
                fontsize=fontsize, color="#333333")

def arrow(x1, y1, x2, y2, label=""):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="-|>", color=C_ARROW, lw=1.8,
                                connectionstyle="arc3,rad=0"))
    if label:
        mx, my = (x1+x2)/2, (y1+y2)/2
        ax.text(mx, my + 0.15, label, ha="center", va="bottom",
                fontsize=7, color=C_ARROW, style="italic")

# ============================================================
# ROW 1: DATA SOURCES (y=8.5, h=2.0)
# ============================================================
ax.text(9, 10.7, "Figure 7: Research Methodology Pipeline", ha="center",
        fontsize=14, fontweight="bold", color="#212121")

# --- Dataset 1: Parliament ---
draw_box(0.3, 8.2, 3.8, 2.2, "Dataset 1: Parliament",
         ["ParlaMint 4.0 (TEI-XML)", "2020–2022 | 1,013 records",
          "Hansard JSON API", "2020–2026 | 2,224 speeches",
          "Combined: 3,141 utterances"],
         C_SOURCE, C_BORDER_S)

# --- Dataset 2: Media ---
draw_box(5.0, 8.2, 3.8, 2.2, "Dataset 2: Media",
         ["OpenAI web_search API", "8 AI keywords × 127 politicians",
          "BBC, Guardian, Telegraph,", "FT, Independent, Sky News",
          "1,215 media statements"],
         C_SOURCE, C_BORDER_S)

# --- Merge box ---
draw_box(10.0, 8.5, 3.0, 1.6, "Corpus Assembly",
         ["Merge + deduplicate", "Party normalisation",
          "Arena tagging", "n = 4,356 texts"],
         C_PROCESS, C_BORDER_P)

arrow(4.1, 9.3, 5.0, 9.3)       # DS1 → DS2 (visual flow)
arrow(8.8, 9.3, 10.0, 9.3)      # DS2 → Merge

# ============================================================
# ROW 2: NLP PIPELINE (y=5.0, h=2.5)
# ============================================================
draw_box(0.3, 5.0, 3.5, 2.7, "Topic Modelling",
         ["LDA (scikit-learn)", "8 topics, 3,000 features",
          "Unigrams + bigrams", "Custom stop words",
          "Parliamentary procedural", "& web artefact removal"],
         C_ANALYSIS, C_BORDER_A, fontsize=7.5)

draw_box(4.3, 5.0, 4.5, 2.7, "Sentiment Analysis (Triangulation)",
         ["VADER (rule-based lexicon)", "  Compound score: −1 to +1",
          "DistilBERT (transformer)", "  SST-2 fine-tuned, rescaled",
          "Combined = mean(VADER, DistilBERT)",
          "Thresholds: >+0.05 pos, <−0.05 neg"],
         C_ANALYSIS, C_BORDER_A, fontsize=7.5)

draw_box(9.3, 5.0, 3.8, 2.7, "Frame Classification",
         ["5 imagined-futures frames:", "  Utopian-Opportunity",
          "  Dystopian-Risk", "  Regulatory-Governance",
          "  Economic-Industrial", "  Ethical-Rights",
          "Keyword dictionaries → max score"],
         C_ANALYSIS, C_BORDER_A, fontsize=7.5)

# Arrows from merge down to NLP
arrow(11.5, 8.5, 2.0, 7.7)    # Merge → Topic
arrow(11.5, 8.5, 6.5, 7.7)    # Merge → Sentiment
arrow(11.5, 8.5, 11.2, 7.7)   # Merge → Frame

# ============================================================
# ROW 3: OUTPUTS (y=1.5, h=2.8)
# ============================================================
draw_box(0.3, 1.5, 3.5, 2.8, "Comparative Analysis",
         ["By arena:", "  Parliament vs Media", "",
          "By party:", "  Con, Lab, LibDem,", "  SNP, Crossbench, Green", "",
          "By party × arena"],
         C_OUTPUT, C_BORDER_O, fontsize=7.5)

draw_box(4.3, 1.5, 4.5, 2.8, "Key Outputs",
         ["data_matrix.csv (4,356 rows)", "  21 columns per text", "",
          "analysis_summary.json", "  Arena, party, party×arena", "",
          "6 visualisation figures", "  + pipeline diagram"],
         C_OUTPUT, C_BORDER_O, fontsize=7.5)

draw_box(9.3, 1.5, 3.8, 2.8, "Report & Findings",
         ["TUM LaTeX template", "3 data tables:", "  Frames by arena",
          "  Sentiment by arena", "  Party sentiment breakdown", "",
          "Arena > Party as driver", "of imagined-futures framing"],
         C_OUTPUT, C_BORDER_O, fontsize=7.5)

# Arrows from NLP to outputs
arrow(2.0, 5.0, 2.0, 4.3)
arrow(6.5, 5.0, 6.5, 4.3)
arrow(11.2, 5.0, 11.2, 4.3)

# ============================================================
# ROW LABELS (left side)
# ============================================================
for y, label in [(9.3, "DATA\nCOLLECTION"), (6.3, "NLP\nANALYSIS"), (2.9, "OUTPUTS")]:
    ax.text(14.5, y, label, ha="center", va="center", fontsize=9,
            fontweight="bold", color="#757575", rotation=0,
            bbox=dict(boxstyle="round,pad=0.3", facecolor="#F5F5F5",
                      edgecolor="#BDBDBD", linewidth=1))

# ============================================================
# SPECS sidebar
# ============================================================
specs = [
    "Platform: Google Colab (T4 GPU)",
    "Language: Python 3.10",
    "Key libraries:",
    "  scikit-learn 1.x (LDA)",
    "  vaderSentiment 3.3.2",
    "  transformers 4.x (DistilBERT)",
    "  pandas, numpy, matplotlib",
    "Data collection: Node.js 18+",
    "  openai SDK (web_search)",
    "Report: LaTeX (Tectonic)",
]
ax.text(16.2, 7.5, "Technical Stack", ha="center", va="top",
        fontsize=9, fontweight="bold", color="#37474F")
for i, s in enumerate(specs):
    ax.text(14.8, 7.1 - i * 0.35, s, ha="left", va="top",
            fontsize=7, color="#546E7A", family="monospace")

plt.tight_layout()
plt.savefig("figures/fig7_methodology_pipeline.png", dpi=200, bbox_inches="tight",
            facecolor="white", edgecolor="none")
plt.show()
print("Saved fig7_methodology_pipeline.png")

# Download
try:
    from google.colab import files
    files.download("figures/fig7_methodology_pipeline.png")
except:
    print("(not in Colab)")
