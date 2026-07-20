# ============================================================
# Colab Cell 1: Install dependencies
# ============================================================
# !pip install -q vaderSentiment transformers torch scikit-learn pandas numpy

# ============================================================
# Colab Cell 2: Run this entire cell
# ============================================================

import os, sys, json, csv, re, numpy as np, pandas as pd
from collections import Counter, defaultdict
from sklearn.feature_extraction.text import CountVectorizer, ENGLISH_STOP_WORDS
from sklearn.decomposition import LatentDirichletAllocation
from transformers import pipeline as hf_pipeline

# ---------------------------------------------------------------------------
# CONFIG — adjusted for Colab (all files in root /content/)
# ---------------------------------------------------------------------------
BASE_DIR = "/content"
OUT_DIR = "/content/analysis_output_v2"
os.makedirs(OUT_DIR, exist_ok=True)

SENTIMENT_MODEL = "distilbert-base-uncased-finetuned-sst-2-english"
SENTIMENT_BATCH_SIZE = 32
MAX_SENTIMENT_TOKENS = 512
NUM_TOPICS = 8
LDA_MAX_FEATURES = 3000
MIN_TEXT_LENGTH = 50

# ---------------------------------------------------------------------------
# PARTY NORMALIZATION
# ---------------------------------------------------------------------------
PARTY_MAP = {
    "lab": "Labour", "labour": "Labour", "lab/co-op": "Labour", "lab co-op": "Labour",
    "con": "Conservative", "conservative": "Conservative", "cons": "Conservative",
    "ld": "Liberal Democrat", "liberal democrat": "Liberal Democrat", "liberal democrats": "Liberal Democrat",
    "libdem": "Liberal Democrat",
    "snp": "SNP",
    "cb": "Crossbench", "crossbench": "Crossbench",
    "dup": "DUP",
    "gp": "Green", "green": "Green", "green party": "Green",
    "pc": "Plaid Cymru", "plaid cymru": "Plaid Cymru",
    "ind": "Independent", "independent": "Independent",
    "non-afl": "Non-affiliated", "non-affiliated": "Non-affiliated",
    "bi": "Bishops", "bishops": "Bishops",
    "na": "Non-affiliated",
}

def normalize_party(party):
    if not party or party == "Unknown":
        return "Unknown"
    key = party.strip().lower()
    mapped = PARTY_MAP.get(key)
    if mapped:
        return mapped
    if key in ("in the chair", "speaker", "deputy speaker", "v", "i", ""):
        return "Unknown"
    cleaned = party.strip()
    if " " in cleaned and cleaned[0].isupper():
        return "Unknown"
    if len(cleaned) <= 2 and key not in PARTY_MAP:
        return "Unknown"
    return cleaned

# ---------------------------------------------------------------------------
# DATA LOADING — files in /content/ root
# ---------------------------------------------------------------------------
def load_parlamint():
    for fn in ["parlamint_ai_debates.json", "parlamint_ai_debates_ALL.json"]:
        fp = os.path.join(BASE_DIR, fn)
        if os.path.exists(fp):
            with open(fp, "r", encoding="utf-8") as f:
                data = json.load(f)
            records = []
            for item in data:
                text = item.get("text", "").strip()
                if len(text) < MIN_TEXT_LENGTH:
                    continue
                records.append({
                    "text": text,
                    "speaker": item.get("speakerName", "Unknown"),
                    "party": normalize_party(item.get("partyAbbrev", "") or item.get("partyName", "") or item.get("party", "Unknown")),
                    "date": item.get("date", ""),
                    "arena": "parliament",
                    "source": "ParlaMint",
                    "house": "Commons" if "commons" in item.get("sourceFile", item.get("file", "")).lower() else "Lords",
                })
            return records
    print("  WARNING: ParlaMint data not found")
    return []

def load_hansard():
    fp = os.path.join(BASE_DIR, "hansard_all_speeches.json")
    if not os.path.exists(fp):
        print("  WARNING: Hansard data not found")
        return []
    with open(fp, "r", encoding="utf-8") as f:
        data = json.load(f)
    records = []
    for item in data:
        text = item.get("text", "").strip()
        if len(text) < MIN_TEXT_LENGTH:
            continue
        records.append({
            "text": text,
            "speaker": item.get("speakerName", item.get("speaker", "Unknown")),
            "party": normalize_party(item.get("party", "Unknown")),
            "date": item.get("debateDate", item.get("date", "")),
            "arena": "parliament",
            "source": "Hansard",
            "house": item.get("chamber", item.get("house", "Unknown")),
        })
    return records

def load_media():
    raw_dir = os.path.join(BASE_DIR, "raw")
    if not os.path.exists(raw_dir):
        print("  WARNING: Media raw/ folder not found")
        return []
    records = []
    for fname in sorted(os.listdir(raw_dir)):
        if not fname.endswith(".json"):
            continue
        with open(os.path.join(raw_dir, fname), "r", encoding="utf-8") as f:
            data = json.load(f)
        pol = data.get("politician", {})
        for art in data.get("articles", []):
            text = art.get("text", "").strip()
            if len(text) < MIN_TEXT_LENGTH:
                continue
            if len(text) > 5000:
                text = text[:5000]
            records.append({
                "text": text,
                "speaker": pol.get("name", art.get("politician", "Unknown")),
                "party": normalize_party(pol.get("party", art.get("party", "Unknown"))),
                "date": art.get("date", ""),
                "arena": "media",
                "source": art.get("source", "Unknown"),
                "house": pol.get("house", "Unknown"),
                "headline": art.get("headline", ""),
                "url": art.get("URL", ""),
            })
    return records

# ---------------------------------------------------------------------------
# TEXT CLEANING
# ---------------------------------------------------------------------------
def clean_text(text):
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"\S+@\S+", " ", text)
    text = re.sub(r"(?i)(accept|reject|manage)\s*(all\s*)?(additional\s*)?cookies?", " ", text)
    text = re.sub(r"(?i)cookie\s*(settings?|preferences?|policy|notice|banner)", " ", text)
    text = re.sub(r"(?i)skip to (main )?content", " ", text)
    text = re.sub(r"(?i)sign\s*in|log\s*in|subscribe|newsletter", " ", text)
    text = re.sub(r"(?i)gov\.uk", "government", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) >= MIN_TEXT_LENGTH else ""

# ---------------------------------------------------------------------------
# TOPIC MODELLING
# ---------------------------------------------------------------------------
TOPIC_LABELS = {
    frozenset(["online", "children", "content", "safety", "social", "media", "platforms"]): "Online Safety & Children",
    frozenset(["police", "recognition", "facial", "abuse", "crime", "surveillance"]): "Facial Recognition & Policing",
    frozenset(["data", "health", "nhs", "protection", "immigration", "digital"]): "Data Protection & Public Services",
    frozenset(["creative", "copyright", "industries", "economy", "businesses", "sector"]): "Creative Industries & AI Economy",
    frozenset(["act", "eu", "section", "agreement", "person", "european"]): "Legislation & EU Relations",
    frozenset(["ai", "regulation", "risks", "safety", "innovation", "ai safety"]): "AI Regulation & Safety",
    frozenset(["security", "future", "support", "work", "hope", "report"]): "General Parliamentary Debate",
    frozenset(["ai", "services", "science", "business", "technology", "environment"]): "AI in Science & Business",
}

def auto_label(top_words):
    top_set = set(top_words[:8])
    best_label, best_overlap = None, 0
    for key_set, label in TOPIC_LABELS.items():
        overlap = len(top_set & key_set)
        if overlap > best_overlap:
            best_overlap = overlap
            best_label = label
    return best_label or "Topic (misc)"

def run_topic_modelling(texts):
    print(f"\n{'='*60}\nTOPIC MODELLING (LDA, {NUM_TOPICS} topics)\n{'='*60}")
    custom_stops = set(ENGLISH_STOP_WORDS) | {
        "guardian", "bbc", "telegraph", "independent", "sky", "news",
        "cookies", "cookie", "search", "menu", "edition", "subscribe",
        "said", "says", "told", "read", "app", "google",
        "image", "video", "caption", "photograph", "fullscreen",
        "opinion", "sport", "culture", "lifestyle", "football",
        "home", "travel", "weather", "recipes", "departments",
        "mr", "mrs", "ms", "dr", "sir", "dame",
        "uk", "government", "gov", "hon", "noble", "lord", "lords",
        "lady", "baroness", "friend", "member", "minister",
        "house", "debate", "committee", "clause", "amendment",
        "secretary", "state",
        "new", "also", "would", "like", "just", "going", "know",
        "think", "way", "make", "need", "want", "right", "time",
        "say", "does", "set", "really", "let", "thing", "things",
        "people", "country", "world", "point", "years", "important",
        "2020", "2021", "2022", "2023", "2024", "2025", "2026",
    }
    vectorizer = CountVectorizer(max_features=LDA_MAX_FEATURES, stop_words=list(custom_stops),
                                  min_df=5, max_df=0.85, ngram_range=(1, 2))
    dtm = vectorizer.fit_transform(texts)
    feature_names = vectorizer.get_feature_names_out()
    print(f"Vocabulary: {len(feature_names)}, Documents: {dtm.shape[0]}")

    lda = LatentDirichletAllocation(n_components=NUM_TOPICS, max_iter=30, learning_method="online", random_state=42)
    doc_topics = lda.fit_transform(dtm)

    topics = []
    for idx, topic in enumerate(lda.components_):
        top_idx = topic.argsort()[-15:][::-1]
        top_words = [feature_names[i] for i in top_idx]
        label = auto_label(top_words)
        topics.append({"topic_id": idx, "top_words": top_words, "label": label})
        print(f"  Topic {idx} [{label}]: {', '.join(top_words[:10])}")

    return topics, doc_topics.argmax(axis=1), doc_topics

# ---------------------------------------------------------------------------
# SENTIMENT ANALYSIS
# ---------------------------------------------------------------------------
def run_vader(texts):
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    analyzer = SentimentIntensityAnalyzer()
    results = []
    for text in texts:
        scores = analyzer.polarity_scores(text[:2000])
        c = scores["compound"]
        label = "POSITIVE" if c >= 0.05 else ("NEGATIVE" if c <= -0.05 else "NEUTRAL")
        results.append({"label": label, "sentiment_score": c,
                         "vader_pos": scores["pos"], "vader_neg": scores["neg"], "vader_neu": scores["neu"]})
    return results

def run_distilbert(texts):
    print(f"\n{'='*60}\nSENTIMENT ANALYSIS (DistilBERT)\n{'='*60}")
    pipe = hf_pipeline("sentiment-analysis", model=SENTIMENT_MODEL, device=-1,
                        truncation=True, max_length=MAX_SENTIMENT_TOKENS)
    results = []
    total = len(texts)
    for i in range(0, total, SENTIMENT_BATCH_SIZE):
        batch = [t[:1500] for t in texts[i:i+SENTIMENT_BATCH_SIZE]]
        try:
            preds = pipe(batch)
            for pred in preds:
                score = -pred["score"] if pred["label"] == "NEGATIVE" else pred["score"]
                results.append({"label": pred["label"], "sentiment_score": score})
        except Exception as e:
            print(f"  Batch error at {i}: {e}")
            for _ in batch:
                results.append({"label": "NEUTRAL", "sentiment_score": 0.0})
        if (i + SENTIMENT_BATCH_SIZE) % 200 == 0 or i + SENTIMENT_BATCH_SIZE >= total:
            print(f"  Processed {min(i+SENTIMENT_BATCH_SIZE, total)}/{total}")
    return results

# ---------------------------------------------------------------------------
# FUTURES FRAMES
# ---------------------------------------------------------------------------
FUTURES_FRAMES = {
    "utopian_opportunity": ["opportunity", "transform", "revolution", "breakthrough", "prosperity",
        "growth", "innovation", "benefit", "potential", "empower", "enable",
        "progress", "exciting", "superpower", "competitive advantage", "productivity", "efficiency", "world-leading"],
    "dystopian_risk": ["risk", "threat", "danger", "existential", "catastroph", "harm",
        "destroy", "replace", "displace", "unemployment", "surveillance",
        "bias", "discriminat", "deepfake", "misinformation", "autonomous weapon",
        "loss of control", "uncontrollable"],
    "regulatory_governance": ["regulation", "regulate", "legislation", "framework", "governance",
        "oversight", "accountability", "transparency", "audit", "compliance",
        "standard", "guideline", "safeguard", "guardrail", "red line", "pro-innovation", "proportionate"],
    "economic_industrial": ["economy", "industry", "business", "investment", "startup", "sector",
        "market", "competition", "trade", "export", "skills", "workforce",
        "training", "education", "jobs", "employment", "GDP", "industrial strategy"],
    "ethical_rights": ["ethics", "ethical", "rights", "human rights", "privacy", "consent",
        "fairness", "justice", "equality", "inclusion", "diversity", "dignity", "autonomy", "freedom", "democratic"],
}

def classify_frames(texts):
    results = []
    for text in texts:
        tl = text.lower()
        scores = {f: sum(1 for kw in kws if kw in tl) for f, kws in FUTURES_FRAMES.items()}
        dominant = max(scores, key=scores.get)
        if scores[dominant] == 0:
            dominant = "unclassified"
        results.append({"dominant_frame": dominant, "frame_scores": scores})
    return results

# ---------------------------------------------------------------------------
# COMPARATIVE ANALYSIS
# ---------------------------------------------------------------------------
def compute_comparisons(df):
    comparisons = {}

    # By arena
    arena_stats = {}
    for arena in df["arena"].unique():
        s = df[df["arena"] == arena]
        arena_stats[arena] = {
            "count": len(s), "avg_sentiment": float(s["sentiment_score"].mean()),
            "std_sentiment": float(s["sentiment_score"].std()),
            "pct_positive": float((s["sentiment_label"] == "POSITIVE").mean() * 100),
            "pct_negative": float((s["sentiment_label"] == "NEGATIVE").mean() * 100),
            "top_topics": s["dominant_topic"].value_counts().head(3).to_dict(),
            "top_frames": s["dominant_frame"].value_counts().head(3).to_dict(),
        }
    comparisons["by_arena"] = arena_stats

    # By party
    party_stats = {}
    for party in sorted(df["party"].unique()):
        if party in ("Unknown", "Non-affiliated", ""):
            continue
        s = df[df["party"] == party]
        if len(s) < 5:
            continue
        party_stats[party] = {
            "count": len(s), "avg_sentiment": float(s["sentiment_score"].mean()),
            "pct_positive": float((s["sentiment_label"] == "POSITIVE").mean() * 100),
            "top_topics": s["dominant_topic"].value_counts().head(3).to_dict(),
            "top_frames": s["dominant_frame"].value_counts().head(3).to_dict(),
            "parliament_count": int((s["arena"] == "parliament").sum()),
            "media_count": int((s["arena"] == "media").sum()),
        }
    comparisons["by_party"] = party_stats

    # By party x arena
    cross = {}
    for party in sorted(df["party"].unique()):
        if party in ("Unknown", "Non-affiliated", ""):
            continue
        for arena in ["parliament", "media"]:
            s = df[(df["party"] == party) & (df["arena"] == arena)]
            if len(s) < 3:
                continue
            cross[f"{party}_{arena}"] = {
                "count": len(s), "avg_sentiment": float(s["sentiment_score"].mean()),
                "top_frame": s["dominant_frame"].value_counts().index[0] if len(s) > 0 else "n/a",
            }
    comparisons["by_party_arena"] = cross
    return comparisons

# ---------------------------------------------------------------------------
# SAVE OUTPUTS
# ---------------------------------------------------------------------------
def save_outputs(df, topics, comparisons):
    # Data matrix CSV
    df["frame_utopian"] = df["frame_scores"].apply(lambda x: x.get("utopian_opportunity", 0))
    df["frame_dystopian"] = df["frame_scores"].apply(lambda x: x.get("dystopian_risk", 0))
    df["frame_regulatory"] = df["frame_scores"].apply(lambda x: x.get("regulatory_governance", 0))
    df["frame_economic"] = df["frame_scores"].apply(lambda x: x.get("economic_industrial", 0))
    df["frame_ethical"] = df["frame_scores"].apply(lambda x: x.get("ethical_rights", 0))
    df["text_preview"] = df["text"].str[:200]
    df["text_length"] = df["text"].str.len()

    cols = ["arena", "source", "speaker", "party", "house", "date", "text_length",
            "vader_label", "vader_score", "distilbert_label", "distilbert_score",
            "sentiment_label", "sentiment_score",
            "dominant_topic", "dominant_frame",
            "frame_utopian", "frame_dystopian", "frame_regulatory", "frame_economic", "frame_ethical",
            "text_preview"]
    export_cols = [c for c in cols if c in df.columns]
    csv_path = os.path.join(OUT_DIR, "data_matrix.csv")
    df[export_cols].to_csv(csv_path, index=False, encoding="utf-8")
    print(f"\nData matrix: {csv_path} ({len(df)} rows)")

    # JSON summary
    summary = {
        "dataset_summary": {
            "total_records": len(df),
            "parliament_records": int((df["arena"] == "parliament").sum()),
            "media_records": int((df["arena"] == "media").sum()),
            "unique_speakers": int(df["speaker"].nunique()),
            "unique_parties": int(df["party"].nunique()),
            "date_range": f"{df['date'].min()} to {df['date'].max()}",
        },
        "topics": topics,
        "comparisons": comparisons,
    }
    json_path = os.path.join(OUT_DIR, "analysis_summary.json")
    with open(json_path, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"Summary: {json_path}")

    # Markdown report
    rpt = os.path.join(OUT_DIR, "analysis_report.md")
    with open(rpt, "w") as f:
        f.write("# NLP Analysis Report: Imagined Futures of AI in UK Politics\n\n")
        s = summary["dataset_summary"]
        f.write(f"**Records:** {s['total_records']} (Parliament: {s['parliament_records']}, Media: {s['media_records']})\n\n")
        f.write("## Topics (LDA)\n\n")
        for t in topics:
            f.write(f"- **{t['label']}**: {', '.join(t['top_words'][:10])}\n")
        f.write("\n## Sentiment by Arena\n\n")
        for arena, st in comparisons.get("by_arena", {}).items():
            f.write(f"- **{arena.title()}**: avg={st['avg_sentiment']:.3f}, {st['pct_positive']:.1f}% positive, {st['pct_negative']:.1f}% negative (n={st['count']})\n")
        f.write("\n## Sentiment by Party\n\n")
        for party, st in comparisons.get("by_party", {}).items():
            f.write(f"- **{party}**: avg={st['avg_sentiment']:.3f}, {st['pct_positive']:.1f}% positive (n={st['count']})\n")
        f.write("\n## Frames by Arena\n\n")
        for arena in ["parliament", "media"]:
            subset = df[df["arena"] == arena]
            if len(subset) == 0: continue
            f.write(f"### {arena.title()}\n")
            for frame, count in subset["dominant_frame"].value_counts().items():
                f.write(f"- {frame}: {count} ({count/len(subset)*100:.1f}%)\n")
            f.write("\n")
    print(f"Report: {rpt}")

# ---------------------------------------------------------------------------
# MAIN PIPELINE
# ---------------------------------------------------------------------------
print("=" * 60)
print("NLP ANALYSIS PIPELINE")
print("Imagined Futures of AI in UK Politics")
print("=" * 60)

# 1. Load
print("\n1. LOADING DATA...")
parlamint = load_parlamint()
print(f"  ParlaMint: {len(parlamint)} records")
hansard = load_hansard()
print(f"  Hansard:   {len(hansard)} records")
media = load_media()
print(f"  Media:     {len(media)} records")
all_records = parlamint + hansard + media
print(f"  TOTAL:     {len(all_records)} records")

# 2. Clean
print("\n2. CLEANING TEXT...")
for rec in all_records:
    rec["text_clean"] = clean_text(rec["text"])
all_records = [r for r in all_records if r["text_clean"]]
print(f"  After cleaning: {len(all_records)} records")

df = pd.DataFrame(all_records)
texts = df["text_clean"].tolist()

# 3. Topics
print("\n3. TOPIC MODELLING...")
topics, dominant_topics, topic_dist = run_topic_modelling(texts)
df["dominant_topic"] = dominant_topics

# 4. Frames
print("\n4. FUTURES FRAME CLASSIFICATION...")
frame_results = classify_frames(texts)
df["dominant_frame"] = [r["dominant_frame"] for r in frame_results]
df["frame_scores"] = [r["frame_scores"] for r in frame_results]
for frame, count in df["dominant_frame"].value_counts().items():
    print(f"  {frame}: {count} ({count/len(df)*100:.1f}%)")

# 5. Sentiment — BOTH models
print("\n5. SENTIMENT ANALYSIS...")
print("  5a. VADER (rule-based)...")
vader_results = run_vader(texts)
df["vader_label"] = [r["label"] for r in vader_results]
df["vader_score"] = [r["sentiment_score"] for r in vader_results]
df["vader_pos"] = [r["vader_pos"] for r in vader_results]
df["vader_neg"] = [r["vader_neg"] for r in vader_results]
df["vader_neu"] = [r["vader_neu"] for r in vader_results]
for label, count in df["vader_label"].value_counts().items():
    print(f"    VADER {label}: {count} ({count/len(df)*100:.1f}%)")

print("  5b. DistilBERT (transformer)...")
hf_results = run_distilbert(texts)
df["distilbert_label"] = [r["label"] for r in hf_results]
df["distilbert_score"] = [r["sentiment_score"] for r in hf_results]
for label, count in df["distilbert_label"].value_counts().items():
    print(f"    DistilBERT {label}: {count} ({count/len(df)*100:.1f}%)")

# Combined (triangulation)
df["sentiment_score"] = (df["vader_score"] + df["distilbert_score"]) / 2
df["sentiment_label"] = df["sentiment_score"].apply(
    lambda x: "POSITIVE" if x > 0.05 else ("NEGATIVE" if x < -0.05 else "NEUTRAL"))
print("  Combined (VADER + DistilBERT average):")
for label, count in df["sentiment_label"].value_counts().items():
    print(f"    {label}: {count} ({count/len(df)*100:.1f}%)")

# 6. Comparisons
print("\n6. COMPARATIVE ANALYSIS...")
comparisons = compute_comparisons(df)

# 7. Save
print("\n7. SAVING OUTPUTS...")
save_outputs(df, topics, comparisons)

# Key findings
print(f"\n{'='*60}\nKEY FINDINGS\n{'='*60}")
by_arena = comparisons.get("by_arena", {})
if "parliament" in by_arena and "media" in by_arena:
    p, m = by_arena["parliament"], by_arena["media"]
    print(f"\nParliament: avg sentiment {p['avg_sentiment']:.3f} ({p['pct_positive']:.1f}% positive)")
    print(f"Media:      avg sentiment {m['avg_sentiment']:.3f} ({m['pct_positive']:.1f}% positive)")
print("\nSentiment by party:")
for party, stats in comparisons.get("by_party", {}).items():
    print(f"  {party:20s}: {stats['avg_sentiment']:+.3f} (n={stats['count']})")
print("\nDone!")
