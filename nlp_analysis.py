"""
NLP Analysis Pipeline for UK AI Politics Research
===================================================

Performs:
  1. Data loading & merging (Dataset 1: parliamentary, Dataset 2: media)
  2. Topic modelling (LDA via scikit-learn)
  3. Sentiment analysis (HuggingFace distilbert-base-uncased-finetuned-sst-2-english)
  4. Comparative analysis by party and arena (parliament vs media)
  5. Outputs: CSV data matrix + JSON summary + charts data

Uses ONLY HuggingFace pre-trained models (no GPT/Gemini).

Usage:
  python nlp_analysis.py [--outDir ./analysis_output]
"""

import os
import sys
import json
import csv
import re
import argparse
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer
from sklearn.decomposition import LatentDirichletAllocation
from transformers import pipeline

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT_DIR = os.path.join(BASE_DIR, "analysis_output")

# Sentiment model — rule-based fallback if HF model fails
SENTIMENT_MODEL = "distilbert-base-uncased-finetuned-sst-2-english"
SENTIMENT_BATCH_SIZE = 32
MAX_SENTIMENT_TOKENS = 512  # model max

# LDA config
NUM_TOPICS = 8
LDA_MAX_FEATURES = 3000
LDA_MAX_ITER = 20

# Text cleaning
MIN_TEXT_LENGTH = 50  # skip very short utterances


# ---------------------------------------------------------------------------
# DATA LOADING
# ---------------------------------------------------------------------------

def load_dataset1_parlamint(base_dir):
    """Load ParlaMint AI debates (2020-2022)."""
    fp = os.path.join(base_dir, "parlamint_parsed", "parlamint_ai_debates.json")
    if not os.path.exists(fp):
        fp = os.path.join(base_dir, "parlamint_parsed", "parlamint_ai_debates_ALL.json")
    if not os.path.exists(fp):
        print(f"  WARNING: ParlaMint data not found at {fp}")
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
            "speaker": item.get("speakerName", "Unknown"),
            "party": normalize_party(item.get("partyAbbrev", "") or item.get("partyName", "") or item.get("party", "Unknown")),
            "date": item.get("date", ""),
            "arena": "parliament",
            "source": "ParlaMint",
            "house": "Commons" if "commons" in item.get("sourceFile", item.get("file", "")).lower() else "Lords",
        })
    return records


def load_dataset1_hansard(base_dir):
    """Load Hansard AI debate speeches (2020-2026)."""
    fp = os.path.join(base_dir, "hansard_debates", "hansard_all_speeches.json")
    if not os.path.exists(fp):
        print(f"  WARNING: Hansard data not found at {fp}")
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
            "speaker": item.get("speaker", "Unknown"),
            "party": normalize_party(item.get("party", "Unknown")),
            "date": item.get("date", ""),
            "arena": "parliament",
            "source": "Hansard",
            "house": item.get("house", "Unknown"),
        })
    return records


def load_dataset2_media(base_dir):
    """Load media statements (Dataset 2)."""
    raw_dir = os.path.join(base_dir, "media_statements", "raw")
    if not os.path.exists(raw_dir):
        print(f"  WARNING: Media data not found at {raw_dir}")
        return []

    records = []
    for fname in sorted(os.listdir(raw_dir)):
        if not fname.endswith(".json"):
            continue
        fp = os.path.join(raw_dir, fname)
        with open(fp, "r", encoding="utf-8") as f:
            data = json.load(f)

        pol = data.get("politician", {})
        articles = data.get("articles", [])

        for art in articles:
            text = art.get("text", "").strip()
            if len(text) < MIN_TEXT_LENGTH:
                continue
            # Truncate very long articles to first 5000 chars for analysis
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
    # Known junk values (chairs, speakers, procedural roles)
    if key in ("in the chair", "speaker", "deputy speaker", "v", "i", ""):
        return "Unknown"
    # Valid UK party abbreviations/names are short and don't contain person-name patterns.
    # If a value has a space and starts with an uppercase letter, it's likely a leaked speaker name.
    cleaned = party.strip()
    if " " in cleaned and cleaned[0].isupper():
        return "Unknown"
    # Single word but not a known abbreviation — likely junk
    if len(cleaned) <= 2 and key not in PARTY_MAP:
        return "Unknown"
    return cleaned


# ---------------------------------------------------------------------------
# TEXT CLEANING
# ---------------------------------------------------------------------------

def clean_text(text):
    """Clean text for NLP analysis."""
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Remove URLs
    text = re.sub(r"https?://\S+", " ", text)
    # Remove email addresses
    text = re.sub(r"\S+@\S+", " ", text)

    # Remove web scraping artifacts from media articles
    # Cookie consent banners
    text = re.sub(r"(?i)(accept|reject|manage)\s*(all\s*)?(additional\s*)?cookies?", " ", text)
    text = re.sub(r"(?i)cookie\s*(settings?|preferences?|policy|notice|banner)", " ", text)
    # Navigation boilerplate
    text = re.sub(r"(?i)skip to (main )?content", " ", text)
    text = re.sub(r"(?i)skip to navigation", " ", text)
    text = re.sub(r"(?i)(uk|us|australia|international|europe)\s*edition", " ", text)
    text = re.sub(r"(?i)back to home", " ", text)
    text = re.sub(r"(?i)sign\s*in|log\s*in|subscribe|newsletter|print subscriptions?", " ", text)
    text = re.sub(r"(?i)search\s*(input|jobs|docs)", " ", text)
    text = re.sub(r"(?i)view\s*all\s*(news|opinion|sport|culture|lifestyle)", " ", text)
    # Guardian-specific
    text = re.sub(r"(?i)the guardian[\s\-]*back to home", " ", text)
    text = re.sub(r"(?i)toggle caption", " ", text)
    text = re.sub(r"(?i)(previous|next) image", " ", text)
    text = re.sub(r"(?i)close dialogue", " ", text)
    text = re.sub(r"(?i)view image in fullscreen", " ", text)
    # Gov.uk boilerplate
    text = re.sub(r"(?i)gov\.uk", "government", text)
    # BBC boilerplate
    text = re.sub(r"(?i)bbc\s*(news|home|sport|weather|iplayer)", "BBC", text)
    # Menu/nav items
    text = re.sub(r"(?i)\bmenu\b", " ", text)

    # Remove extra whitespace
    text = re.sub(r"\s+", " ", text).strip()
    # Remove very short residual
    if len(text) < MIN_TEXT_LENGTH:
        return ""
    return text


# ---------------------------------------------------------------------------
# TOPIC MODELLING (LDA)
# ---------------------------------------------------------------------------

def run_topic_modelling(texts, n_topics=NUM_TOPICS):
    """Run LDA topic modelling."""
    print(f"\n{'='*60}")
    print(f"TOPIC MODELLING (LDA, {n_topics} topics)")
    print(f"{'='*60}")

    # Custom stop words: English + web/parliamentary artifacts
    from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
    custom_stops = set(ENGLISH_STOP_WORDS) | {
        # Web scraping artifacts
        "guardian", "bbc", "telegraph", "independent", "sky", "news",
        "cookies", "additional", "cookie", "search", "menu", "edition",
        "view", "share", "subscribe", "newsletter", "sign", "login",
        "said", "says", "told", "read", "app", "google",
        "image", "video", "caption", "photograph", "fullscreen",
        "opinion", "sport", "culture", "lifestyle", "football", "cup",
        "home", "travel", "passports", "living", "weather", "recipes",
        "consultations", "departments", "guidance", "reports",
        "statistics", "local", "office",
        # Parliamentary procedure words
        "mr", "mrs", "ms", "dr", "sir", "dame",
        "uk", "government", "gov", "hon", "noble", "lord", "lords",
        "lady", "baroness", "friend", "member", "minister",
        "house", "debate", "committee", "clause", "amendment",
        "secretary", "state", "secretary state",
        # Generic filler
        "new", "also", "would", "like", "just", "going", "know",
        "think", "way", "make", "need", "want", "right", "time",
        "say", "does", "set", "really", "let", "thing", "things",
        "people", "country", "world", "point", "years", "important",
        "2020", "2021", "2022", "2023", "2024", "2025", "2026",
    }

    # TF-IDF vectorization
    vectorizer = CountVectorizer(
        max_features=LDA_MAX_FEATURES,
        stop_words=list(custom_stops),
        min_df=5,
        max_df=0.85,
        ngram_range=(1, 2),
    )
    doc_term_matrix = vectorizer.fit_transform(texts)
    feature_names = vectorizer.get_feature_names_out()

    print(f"Vocabulary size: {len(feature_names)}")
    print(f"Documents: {doc_term_matrix.shape[0]}")

    # Fit LDA
    lda = LatentDirichletAllocation(
        n_components=n_topics,
        max_iter=30,
        learning_method="online",
        random_state=42,
    )
    doc_topics = lda.fit_transform(doc_term_matrix)

    # Auto-label topics based on top words
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
        """Match topic to a label based on word overlap."""
        top_set = set(top_words[:8])
        best_label = None
        best_overlap = 0
        for key_set, label in TOPIC_LABELS.items():
            overlap = len(top_set & key_set)
            if overlap > best_overlap:
                best_overlap = overlap
                best_label = label
        return best_label or f"Topic (misc)"

    # Extract topic words
    topics = []
    for idx, topic in enumerate(lda.components_):
        top_words_idx = topic.argsort()[-15:][::-1]
        top_words = [feature_names[i] for i in top_words_idx]
        label = auto_label(top_words)
        topics.append({
            "topic_id": idx,
            "top_words": top_words,
            "label": label,
        })
        print(f"\n  Topic {idx} [{label}]: {', '.join(top_words[:10])}")

    # Assign dominant topic to each document
    dominant_topics = doc_topics.argmax(axis=1)

    return topics, dominant_topics, doc_topics


# ---------------------------------------------------------------------------
# SENTIMENT ANALYSIS (HuggingFace)
# ---------------------------------------------------------------------------

def run_sentiment_analysis(texts):
    """Run sentiment analysis using HuggingFace pre-trained model."""
    print(f"\n{'='*60}")
    print("SENTIMENT ANALYSIS (HuggingFace DistilBERT)")
    print(f"{'='*60}")

    try:
        sentiment_pipe = pipeline(
            "sentiment-analysis",
            model=SENTIMENT_MODEL,
            device=-1,  # CPU
            truncation=True,
            max_length=MAX_SENTIMENT_TOKENS,
        )
    except Exception as e:
        print(f"  Error loading model: {e}")
        print("  Falling back to rule-based sentiment...")
        return run_rule_based_sentiment(texts)

    results = []
    total = len(texts)

    for i in range(0, total, SENTIMENT_BATCH_SIZE):
        batch = texts[i : i + SENTIMENT_BATCH_SIZE]
        # Truncate each text to ~500 chars for the model
        batch_truncated = [t[:1500] for t in batch]
        try:
            preds = sentiment_pipe(batch_truncated)
            for pred in preds:
                label = pred["label"]  # POSITIVE or NEGATIVE
                score = pred["score"]
                # Convert to -1 to 1 scale
                if label == "NEGATIVE":
                    sentiment_score = -score
                else:
                    sentiment_score = score
                results.append({
                    "label": label,
                    "score": score,
                    "sentiment_score": sentiment_score,
                })
        except Exception as e:
            print(f"  Batch error at {i}: {e}")
            for _ in batch:
                results.append({"label": "NEUTRAL", "score": 0.5, "sentiment_score": 0.0})

        if (i + SENTIMENT_BATCH_SIZE) % 200 == 0 or i + SENTIMENT_BATCH_SIZE >= total:
            print(f"  Processed {min(i + SENTIMENT_BATCH_SIZE, total)}/{total}")

    return results


def run_rule_based_sentiment(texts):
    """VADER sentiment analysis — rule-based, designed for social/political text."""
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        analyzer = SentimentIntensityAnalyzer()
        results = []
        for text in texts:
            scores = analyzer.polarity_scores(text[:2000])
            compound = scores["compound"]
            if compound >= 0.05:
                label = "POSITIVE"
            elif compound <= -0.05:
                label = "NEGATIVE"
            else:
                label = "NEUTRAL"
            results.append({
                "label": label,
                "score": abs(compound),
                "sentiment_score": compound,
                "vader_pos": scores["pos"],
                "vader_neg": scores["neg"],
                "vader_neu": scores["neu"],
            })
        return results
    except ImportError:
        print("  VADER not available, using simple keyword fallback")
        return _simple_keyword_sentiment(texts)


def _simple_keyword_sentiment(texts):
    """Minimal keyword-based fallback."""
    positive_words = {
        "opportunity", "benefit", "innovation", "growth", "progress", "improve",
        "advance", "potential", "positive", "success", "transform", "enhance",
        "empower", "enable", "prosperity", "breakthrough", "exciting", "promising",
    }
    negative_words = {
        "risk", "threat", "danger", "harm", "concern", "worry", "fear",
        "challenge", "problem", "crisis", "catastroph", "destroy", "bias",
        "surveillance", "discriminat", "unsafe", "exploit", "misuse", "abuse",
    }
    results = []
    for text in texts:
        words = set(text.lower().split())
        pos = len(words & positive_words)
        neg = len(words & negative_words)
        if pos > neg:
            results.append({"label": "POSITIVE", "score": 0.7, "sentiment_score": 0.7})
        elif neg > pos:
            results.append({"label": "NEGATIVE", "score": 0.7, "sentiment_score": -0.7})
        else:
            results.append({"label": "NEUTRAL", "score": 0.5, "sentiment_score": 0.0})
    return results


# ---------------------------------------------------------------------------
# KEYWORD / FUTURES FRAME ANALYSIS
# ---------------------------------------------------------------------------

# "Imagined futures" frame categories based on the literature
FUTURES_FRAMES = {
    "utopian_opportunity": [
        "opportunity", "transform", "revolution", "breakthrough", "prosperity",
        "growth", "innovation", "benefit", "potential", "empower", "enable",
        "progress", "exciting", "superpower", "competitive advantage",
        "productivity", "efficiency", "world-leading", "global leader",
    ],
    "dystopian_risk": [
        "risk", "threat", "danger", "existential", "catastroph", "harm",
        "destroy", "replace", "displace", "unemployment", "surveillance",
        "bias", "discriminat", "deepfake", "misinformation", "autonomous weapon",
        "loss of control", "uncontrollable", "skynet", "terminator",
    ],
    "regulatory_governance": [
        "regulation", "regulate", "legislation", "framework", "governance",
        "oversight", "accountability", "transparency", "audit", "compliance",
        "standard", "guideline", "safeguard", "guardrail", "red line",
        "sandox", "pro-innovation", "proportionate",
    ],
    "economic_industrial": [
        "economy", "industry", "business", "investment", "startup", "sector",
        "market", "competition", "trade", "export", "skills", "workforce",
        "training", "education", "jobs", "employment", "productivity",
        "GDP", "economic growth", "industrial strategy",
    ],
    "ethical_rights": [
        "ethics", "ethical", "rights", "human rights", "privacy", "consent",
        "fairness", "justice", "equality", "inclusion", "diversity",
        "dignity", "autonomy", "freedom", "democratic", "civil liberties",
    ],
}


def classify_futures_frames(texts):
    """Classify each text by imagined futures frame."""
    results = []
    for text in texts:
        text_lower = text.lower()
        frame_scores = {}
        for frame, keywords in FUTURES_FRAMES.items():
            score = sum(1 for kw in keywords if kw in text_lower)
            frame_scores[frame] = score

        # Dominant frame
        dominant = max(frame_scores, key=frame_scores.get)
        if frame_scores[dominant] == 0:
            dominant = "unclassified"

        results.append({
            "dominant_frame": dominant,
            "frame_scores": frame_scores,
        })
    return results


# ---------------------------------------------------------------------------
# COMPARATIVE ANALYSIS
# ---------------------------------------------------------------------------

def compute_comparisons(df):
    """Compute comparative statistics."""
    comparisons = {}

    # --- By Arena (parliament vs media) ---
    arena_stats = {}
    for arena in df["arena"].unique():
        subset = df[df["arena"] == arena]
        arena_stats[arena] = {
            "count": len(subset),
            "avg_sentiment": float(subset["sentiment_score"].mean()),
            "std_sentiment": float(subset["sentiment_score"].std()),
            "pct_positive": float((subset["sentiment_label"] == "POSITIVE").mean() * 100),
            "pct_negative": float((subset["sentiment_label"] == "NEGATIVE").mean() * 100),
            "top_topics": subset["dominant_topic"].value_counts().head(3).to_dict(),
            "top_frames": subset["dominant_frame"].value_counts().head(3).to_dict(),
        }
    comparisons["by_arena"] = arena_stats

    # --- By Party ---
    party_stats = {}
    for party in sorted(df["party"].unique()):
        if party in ("Unknown", "Non-affiliated", ""):
            continue
        subset = df[df["party"] == party]
        if len(subset) < 5:
            continue
        party_stats[party] = {
            "count": len(subset),
            "avg_sentiment": float(subset["sentiment_score"].mean()),
            "pct_positive": float((subset["sentiment_label"] == "POSITIVE").mean() * 100),
            "top_topics": subset["dominant_topic"].value_counts().head(3).to_dict(),
            "top_frames": subset["dominant_frame"].value_counts().head(3).to_dict(),
            "parliament_count": int((subset["arena"] == "parliament").sum()),
            "media_count": int((subset["arena"] == "media").sum()),
        }
    comparisons["by_party"] = party_stats

    # --- By Party × Arena ---
    cross_stats = {}
    for party in sorted(df["party"].unique()):
        if party in ("Unknown", "Non-affiliated", ""):
            continue
        for arena in ["parliament", "media"]:
            subset = df[(df["party"] == party) & (df["arena"] == arena)]
            if len(subset) < 3:
                continue
            key = f"{party}_{arena}"
            cross_stats[key] = {
                "count": len(subset),
                "avg_sentiment": float(subset["sentiment_score"].mean()),
                "top_frame": subset["dominant_frame"].value_counts().index[0] if len(subset) > 0 else "n/a",
            }
    comparisons["by_party_arena"] = cross_stats

    return comparisons


# ---------------------------------------------------------------------------
# OUTPUT
# ---------------------------------------------------------------------------

def save_data_matrix(df, out_dir):
    """Save the organized CSV data matrix."""
    csv_path = os.path.join(out_dir, "data_matrix.csv")
    cols = [
        "arena", "source", "speaker", "party", "house", "date",
        "text_length", "sentiment_label", "sentiment_score",
        "dominant_topic", "dominant_frame",
        "frame_utopian", "frame_dystopian", "frame_regulatory",
        "frame_economic", "frame_ethical",
        "text_preview",
    ]

    # Add frame scores as columns
    df["frame_utopian"] = df["frame_scores"].apply(lambda x: x.get("utopian_opportunity", 0))
    df["frame_dystopian"] = df["frame_scores"].apply(lambda x: x.get("dystopian_risk", 0))
    df["frame_regulatory"] = df["frame_scores"].apply(lambda x: x.get("regulatory_governance", 0))
    df["frame_economic"] = df["frame_scores"].apply(lambda x: x.get("economic_industrial", 0))
    df["frame_ethical"] = df["frame_scores"].apply(lambda x: x.get("ethical_rights", 0))
    df["text_preview"] = df["text"].str[:200]
    df["text_length"] = df["text"].str.len()

    # Select and save
    export_cols = [c for c in cols if c in df.columns]
    df[export_cols].to_csv(csv_path, index=False, encoding="utf-8")
    print(f"\nData matrix saved: {csv_path} ({len(df)} rows)")
    return csv_path


def save_summary(comparisons, topics, out_dir, df):
    """Save JSON summary of all analysis."""
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

    fp = os.path.join(out_dir, "analysis_summary.json")
    with open(fp, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"Summary saved: {fp}")

    # Also save a human-readable report
    report_path = os.path.join(out_dir, "analysis_report.md")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("# NLP Analysis Report: Imagined Futures of AI in UK Politics\n\n")

        f.write("## Dataset Overview\n\n")
        s = summary["dataset_summary"]
        f.write(f"- Total records analysed: {s['total_records']}\n")
        f.write(f"- Parliamentary utterances: {s['parliament_records']}\n")
        f.write(f"- Media articles: {s['media_records']}\n")
        f.write(f"- Unique speakers: {s['unique_speakers']}\n")
        f.write(f"- Date range: {s['date_range']}\n\n")

        f.write("## Topics Discovered (LDA)\n\n")
        for t in topics:
            f.write(f"### {t['label']}\n")
            f.write(f"Top words: {', '.join(t['top_words'][:10])}\n\n")

        f.write("## Sentiment by Arena\n\n")
        for arena, stats in comparisons.get("by_arena", {}).items():
            f.write(f"### {arena.title()}\n")
            f.write(f"- Count: {stats['count']}\n")
            f.write(f"- Average sentiment: {stats['avg_sentiment']:.3f}\n")
            f.write(f"- % Positive: {stats['pct_positive']:.1f}%\n")
            f.write(f"- % Negative: {stats['pct_negative']:.1f}%\n\n")

        f.write("## Sentiment by Party\n\n")
        for party, stats in comparisons.get("by_party", {}).items():
            f.write(f"### {party}\n")
            f.write(f"- Count: {stats['count']}\n")
            f.write(f"- Average sentiment: {stats['avg_sentiment']:.3f}\n")
            f.write(f"- % Positive: {stats['pct_positive']:.1f}%\n")
            f.write(f"- Top frame: {list(stats['top_frames'].keys())[0] if stats['top_frames'] else 'n/a'}\n\n")

        f.write("## Imagined Futures Frames by Arena\n\n")
        for arena in ["parliament", "media"]:
            subset = df[df["arena"] == arena]
            if len(subset) == 0:
                continue
            frame_counts = subset["dominant_frame"].value_counts()
            f.write(f"### {arena.title()}\n")
            for frame, count in frame_counts.items():
                pct = count / len(subset) * 100
                f.write(f"- {frame}: {count} ({pct:.1f}%)\n")
            f.write("\n")

    print(f"Report saved: {report_path}")


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="NLP Analysis Pipeline")
    parser.add_argument("--outDir", default=DEFAULT_OUT_DIR)
    parser.add_argument("--skipSentiment", action="store_true", help="Skip HF sentiment (use VADER)")
    parser.add_argument("--useHF", action="store_true", help="Use HuggingFace DistilBERT for sentiment (slower, needs GPU or patience)")
    args = parser.parse_args()

    out_dir = args.outDir
    os.makedirs(out_dir, exist_ok=True)

    print("=" * 60)
    print("NLP ANALYSIS PIPELINE")
    print("Imagined Futures of AI in UK Politics")
    print("=" * 60)

    # --- Load data ---
    print("\n1. LOADING DATA...")
    parlamint = load_dataset1_parlamint(BASE_DIR)
    print(f"  ParlaMint: {len(parlamint)} records")

    hansard = load_dataset1_hansard(BASE_DIR)
    print(f"  Hansard:   {len(hansard)} records")

    media = load_dataset2_media(BASE_DIR)
    print(f"  Media:     {len(media)} records")

    all_records = parlamint + hansard + media
    print(f"  TOTAL:     {len(all_records)} records")

    if len(all_records) == 0:
        print("ERROR: No data loaded. Check file paths.")
        sys.exit(1)

    # --- Clean text ---
    print("\n2. CLEANING TEXT...")
    for rec in all_records:
        rec["text_clean"] = clean_text(rec["text"])

    all_records = [r for r in all_records if r["text_clean"]]
    print(f"  After cleaning: {len(all_records)} records")

    # Build dataframe
    df = pd.DataFrame(all_records)
    texts = df["text_clean"].tolist()

    # --- Topic Modelling ---
    print("\n3. TOPIC MODELLING...")
    topics, dominant_topics, topic_distributions = run_topic_modelling(texts)
    df["dominant_topic"] = dominant_topics
    for i in range(len(topics)):
        df[f"topic_{i}_weight"] = topic_distributions[:, i]

    # --- Futures Frame Classification ---
    print("\n4. FUTURES FRAME CLASSIFICATION...")
    frame_results = classify_futures_frames(texts)
    df["dominant_frame"] = [r["dominant_frame"] for r in frame_results]
    df["frame_scores"] = [r["frame_scores"] for r in frame_results]

    frame_counts = df["dominant_frame"].value_counts()
    for frame, count in frame_counts.items():
        print(f"  {frame}: {count} ({count/len(df)*100:.1f}%)")

    # --- Sentiment Analysis ---
    print("\n5. SENTIMENT ANALYSIS...")

    # Always run VADER (fast, rule-based)
    print("  5a. VADER (rule-based)...")
    vader_results = run_rule_based_sentiment(texts)
    df["vader_label"] = [r["label"] for r in vader_results]
    df["vader_score"] = [r["sentiment_score"] for r in vader_results]
    if "vader_pos" in vader_results[0]:
        df["vader_pos"] = [r["vader_pos"] for r in vader_results]
        df["vader_neg"] = [r["vader_neg"] for r in vader_results]
        df["vader_neu"] = [r["vader_neu"] for r in vader_results]

    vader_counts = df["vader_label"].value_counts()
    for label, count in vader_counts.items():
        print(f"    VADER {label}: {count} ({count/len(df)*100:.1f}%)")

    # Run DistilBERT if --useHF
    if args.useHF:
        print("  5b. DistilBERT (transformer)...")
        hf_results = run_sentiment_analysis(texts)
        df["distilbert_label"] = [r["label"] for r in hf_results]
        df["distilbert_score"] = [r["sentiment_score"] for r in hf_results]

        hf_counts = df["distilbert_label"].value_counts()
        for label, count in hf_counts.items():
            print(f"    DistilBERT {label}: {count} ({count/len(df)*100:.1f}%)")

        # Primary sentiment = average of both models (triangulation)
        df["sentiment_score"] = (df["vader_score"] + df["distilbert_score"]) / 2
        df["sentiment_label"] = df["sentiment_score"].apply(
            lambda x: "POSITIVE" if x > 0.05 else ("NEGATIVE" if x < -0.05 else "NEUTRAL")
        )
        print("  Combined (VADER + DistilBERT average):")
    else:
        df["sentiment_score"] = df["vader_score"]
        df["sentiment_label"] = df["vader_label"]

    sent_counts = df["sentiment_label"].value_counts()
    for label, count in sent_counts.items():
        print(f"  {label}: {count} ({count/len(df)*100:.1f}%)")

    # --- Comparative Analysis ---
    print("\n6. COMPARATIVE ANALYSIS...")
    comparisons = compute_comparisons(df)

    # --- Save outputs ---
    print("\n7. SAVING OUTPUTS...")
    save_data_matrix(df, out_dir)
    save_summary(comparisons, topics, out_dir, df)

    # Print key findings
    print(f"\n{'='*60}")
    print("KEY FINDINGS")
    print(f"{'='*60}")

    by_arena = comparisons.get("by_arena", {})
    if "parliament" in by_arena and "media" in by_arena:
        p = by_arena["parliament"]
        m = by_arena["media"]
        print(f"\nParliament: avg sentiment {p['avg_sentiment']:.3f} ({p['pct_positive']:.1f}% positive)")
        print(f"Media:      avg sentiment {m['avg_sentiment']:.3f} ({m['pct_positive']:.1f}% positive)")

    print("\nSentiment by party:")
    for party, stats in comparisons.get("by_party", {}).items():
        print(f"  {party:20s}: {stats['avg_sentiment']:+.3f} (n={stats['count']})")

    print(f"\nDone. Results in: {out_dir}")


if __name__ == "__main__":
    main()
