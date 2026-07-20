# ============================================================
# Colab Plots — paste into a single cell
# Expects: data_matrix.csv in /content/ (or current directory)
# Outputs: 6 PNG figures saved to /content/figures/
# ============================================================

import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import numpy as np
import os

os.makedirs("figures", exist_ok=True)
df = pd.read_csv("data_matrix.csv")
print(f"Loaded {len(df)} rows")

# --- Colour palette ---
COLORS = {
    "utopian_opportunity": "#2ecc71",
    "dystopian_risk": "#e74c3c",
    "regulatory_governance": "#3498db",
    "economic_industrial": "#f39c12",
    "ethical_rights": "#9b59b6",
    "unclassified": "#bdc3c7",
}
PARTY_COLORS = {
    "Conservative": "#0087DC",
    "Labour": "#DC241f",
    "Liberal Democrat": "#FAA61A",
    "SNP": "#FFF95D",
    "Crossbench": "#999999",
    "Green": "#6AB023",
}
FRAME_LABELS = {
    "utopian_opportunity": "Utopian-\nOpportunity",
    "dystopian_risk": "Dystopian-\nRisk",
    "regulatory_governance": "Regulatory-\nGovernance",
    "economic_industrial": "Economic-\nIndustrial",
    "ethical_rights": "Ethical-\nRights",
    "unclassified": "Unclassified",
}
FRAME_ORDER = ["utopian_opportunity", "dystopian_risk", "regulatory_governance",
               "economic_industrial", "ethical_rights", "unclassified"]

plt.rcParams.update({"font.size": 11, "figure.dpi": 200, "savefig.bbox": "tight"})


# =============================================
# FIGURE 1 — Frame distribution by arena
# =============================================
fig, ax = plt.subplots(figsize=(10, 5))
parl = df[df["arena"] == "parliament"]
media = df[df["arena"] == "media"]

parl_pcts = [(parl["dominant_frame"] == f).sum() / len(parl) * 100 for f in FRAME_ORDER]
media_pcts = [(media["dominant_frame"] == f).sum() / len(media) * 100 for f in FRAME_ORDER]

x = np.arange(len(FRAME_ORDER))
w = 0.35
bars1 = ax.bar(x - w/2, parl_pcts, w, label=f"Parliament (n={len(parl):,})", color="#3498db", edgecolor="white")
bars2 = ax.bar(x + w/2, media_pcts, w, label=f"Media (n={len(media):,})", color="#e74c3c", edgecolor="white")

ax.set_xticks(x)
ax.set_xticklabels([FRAME_LABELS[f] for f in FRAME_ORDER], fontsize=9)
ax.set_ylabel("Percentage of texts (%)")
ax.set_title("Figure 1: Imagined-Futures Frame Distribution by Arena")
ax.legend()
ax.yaxis.set_major_formatter(mtick.PercentFormatter(decimals=0))
for bar in bars1 + bars2:
    h = bar.get_height()
    if h > 2:
        ax.text(bar.get_x() + bar.get_width()/2, h + 0.5, f"{h:.1f}", ha="center", va="bottom", fontsize=8)
plt.tight_layout()
plt.savefig("figures/fig1_frames_by_arena.png")
plt.show()
print("Saved fig1_frames_by_arena.png")


# =============================================
# FIGURE 2 — Sentiment distribution by arena
# =============================================
fig, axes = plt.subplots(1, 2, figsize=(10, 4), sharey=True)

for i, (arena, color) in enumerate([("parliament", "#3498db"), ("media", "#e74c3c")]):
    subset = df[df["arena"] == arena]["sentiment_score"].astype(float)
    ax = axes[i]
    ax.hist(subset, bins=40, color=color, alpha=0.8, edgecolor="white")
    ax.axvline(subset.mean(), color="black", linestyle="--", linewidth=1.5,
               label=f"Mean = {subset.mean():+.3f}")
    ax.set_title(f"{arena.title()} (n={len(subset):,})")
    ax.set_xlabel("Combined sentiment score")
    ax.legend(fontsize=9)
axes[0].set_ylabel("Frequency")
fig.suptitle("Figure 2: Sentiment Score Distributions by Arena", fontsize=12, y=1.02)
plt.tight_layout()
plt.savefig("figures/fig2_sentiment_distributions.png")
plt.show()
print("Saved fig2_sentiment_distributions.png")


# =============================================
# FIGURE 3 — Party sentiment: Parliament vs Media
# =============================================
parties = ["Conservative", "Labour", "Liberal Democrat", "Crossbench", "SNP", "Green"]
fig, ax = plt.subplots(figsize=(10, 5))

parl_means = []
media_means = []
for p in parties:
    ps = df[(df["party"] == p) & (df["arena"] == "parliament")]["sentiment_score"].astype(float)
    ms = df[(df["party"] == p) & (df["arena"] == "media")]["sentiment_score"].astype(float)
    parl_means.append(ps.mean() if len(ps) > 0 else 0)
    media_means.append(ms.mean() if len(ms) > 0 else 0)

x = np.arange(len(parties))
w = 0.35
bars1 = ax.bar(x - w/2, parl_means, w, label="Parliament", color="#3498db", edgecolor="white")
bars2 = ax.bar(x + w/2, media_means, w, label="Media", color="#e74c3c", edgecolor="white")

ax.axhline(0, color="black", linewidth=0.5)
ax.set_xticks(x)
ax.set_xticklabels(parties, fontsize=9)
ax.set_ylabel("Mean combined sentiment score")
ax.set_title("Figure 3: Party Sentiment by Arena (Parliament vs Media)")
ax.legend()
for bar in bars1 + bars2:
    h = bar.get_height()
    va = "bottom" if h >= 0 else "top"
    offset = 0.01 if h >= 0 else -0.01
    ax.text(bar.get_x() + bar.get_width()/2, h + offset, f"{h:+.3f}", ha="center", va=va, fontsize=7)
plt.tight_layout()
plt.savefig("figures/fig3_party_sentiment_by_arena.png")
plt.show()
print("Saved fig3_party_sentiment_by_arena.png")


# =============================================
# FIGURE 4 — Arena shift arrows (slope chart)
# =============================================
fig, ax = plt.subplots(figsize=(7, 5))
for i, p in enumerate(parties):
    ps = df[(df["party"] == p) & (df["arena"] == "parliament")]["sentiment_score"].astype(float).mean()
    ms = df[(df["party"] == p) & (df["arena"] == "media")]["sentiment_score"].astype(float).mean()
    c = PARTY_COLORS.get(p, "#555555")
    ax.plot([0, 1], [ps, ms], marker="o", color=c, linewidth=2, markersize=8)
    ax.text(-0.05, ps, f"{ps:+.3f}", ha="right", va="center", fontsize=8, color=c)
    ax.text(1.05, ms, f"{ms:+.3f}  {p}", ha="left", va="center", fontsize=8, color=c)

ax.axhline(0, color="black", linewidth=0.5, linestyle=":")
ax.set_xticks([0, 1])
ax.set_xticklabels(["Parliament", "Media"], fontsize=11)
ax.set_ylabel("Mean combined sentiment score")
ax.set_title("Figure 4: Sentiment Shift from Parliament to Media")
ax.set_xlim(-0.3, 1.6)
plt.tight_layout()
plt.savefig("figures/fig4_arena_shift_slopes.png")
plt.show()
print("Saved fig4_arena_shift_slopes.png")


# =============================================
# FIGURE 5 — Stacked frame bars by party
# =============================================
fig, ax = plt.subplots(figsize=(10, 5))
frames_no_unc = [f for f in FRAME_ORDER if f != "unclassified"]

bottom = np.zeros(len(parties))
for frame in frames_no_unc:
    vals = []
    for p in parties:
        sub = df[df["party"] == p]
        vals.append((sub["dominant_frame"] == frame).sum() / len(sub) * 100 if len(sub) > 0 else 0)
    ax.bar(parties, vals, bottom=bottom, label=FRAME_LABELS[frame].replace("\n", " "),
           color=COLORS[frame], edgecolor="white", linewidth=0.5)
    bottom += np.array(vals)

# Add unclassified on top
vals_unc = []
for p in parties:
    sub = df[df["party"] == p]
    vals_unc.append((sub["dominant_frame"] == "unclassified").sum() / len(sub) * 100 if len(sub) > 0 else 0)
ax.bar(parties, vals_unc, bottom=bottom, label="Unclassified", color=COLORS["unclassified"],
       edgecolor="white", linewidth=0.5)

ax.set_ylabel("Percentage of texts (%)")
ax.set_title("Figure 5: Frame Distribution by Party")
ax.legend(bbox_to_anchor=(1.02, 1), loc="upper left", fontsize=8)
plt.tight_layout()
plt.savefig("figures/fig5_frames_by_party.png")
plt.show()
print("Saved fig5_frames_by_party.png")


# =============================================
# FIGURE 6 — VADER vs DistilBERT comparison
# =============================================
fig, ax = plt.subplots(figsize=(8, 5))
arenas = ["parliament", "media"]
vader_means = [df[df["arena"] == a]["vader_score"].astype(float).mean() for a in arenas]
distil_means = [df[df["arena"] == a]["distilbert_score"].astype(float).mean() for a in arenas]
combined_means = [df[df["arena"] == a]["sentiment_score"].astype(float).mean() for a in arenas]

x = np.arange(len(arenas))
w = 0.25
ax.bar(x - w, vader_means, w, label="VADER", color="#2ecc71", edgecolor="white")
ax.bar(x, distil_means, w, label="DistilBERT", color="#e74c3c", edgecolor="white")
ax.bar(x + w, combined_means, w, label="Combined (mean)", color="#3498db", edgecolor="white")

ax.axhline(0, color="black", linewidth=0.5)
ax.set_xticks(x)
ax.set_xticklabels(["Parliament", "Media"], fontsize=11)
ax.set_ylabel("Mean sentiment score")
ax.set_title("Figure 6: VADER vs DistilBERT — Triangulation Comparison")
ax.legend()

for bars in [ax.containers[0], ax.containers[1], ax.containers[2]]:
    for bar in bars:
        h = bar.get_height()
        va = "bottom" if h >= 0 else "top"
        offset = 0.02 if h >= 0 else -0.02
        ax.text(bar.get_x() + bar.get_width()/2, h + offset, f"{h:+.3f}", ha="center", va=va, fontsize=8)
plt.tight_layout()
plt.savefig("figures/fig6_vader_vs_distilbert.png")
plt.show()
print("Saved fig6_vader_vs_distilbert.png")


# =============================================
# ZIP all figures for download
# =============================================
import shutil
shutil.make_archive("figures", "zip", ".", "figures")
print("\n✅ All 6 figures saved. Download figures.zip:")

try:
    from google.colab import files
    files.download("figures.zip")
except:
    print("  (not in Colab — find figures/ folder locally)")
