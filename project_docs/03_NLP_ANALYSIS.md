# NLP Analysis Pipeline

## Overview

The NLP pipeline processes the merged corpus (4,356 texts) through three parallel analyses: topic modelling, sentiment analysis (dual-method triangulation), and imagined-futures frame classification.

**Scripts**: `nlp_analysis.py` (local), `colab_nlp_final.py` (Google Colab with T4 GPU)

## Data Loading & Merging

### Three input sources loaded sequentially:

1. **ParlaMint JSON** (`parlamint_parsed/parlamint_ai_debates.json`) — 1,013 records. Fields: `speakerName`, `partyAbbrev`/`partyName`, `text`, `date`, `sourceFile`. House inferred from filename ("commons" → Commons, else Lords).

2. **Hansard JSON** (`hansard_debates/hansard_all_speeches.json`) — 2,224 speeches. Fields: `speaker`, `party`, `text`, `date`, `house`.

3. **Media JSON** (`media_statements/raw/*.json`) — 127 politician files → 1,215 articles. Long articles truncated to 5,000 chars.

### Party Normalisation

`normalize_party()` maps raw party strings to canonical names via `PARTY_MAP`:

```python
PARTY_MAP = {
    "lab": "Labour", "con": "Conservative", "cons": "Conservative",
    "ld": "Liberal Democrat", "libdem": "Liberal Democrat",
    "snp": "SNP", "cb": "Crossbench", "dup": "DUP",
    "gp": "Green", "green party": "Green",
    "pc": "Plaid Cymru", "bi": "Bishops", "na": "Non-affiliated",
    "ind": "Independent", ...
}
```

**Critical fix**: The Hansard API sometimes leaks speaker names into the `party` field (e.g., "Saqib Bhatti" appearing as a party). Detection heuristic: any value containing a space and starting with an uppercase letter is rejected as "Unknown".

### Text Cleaning

`clean_text()` removes:
- HTML tags, URLs, email addresses
- Cookie consent banners (`accept.*cookies`, `cookie settings`)
- Navigation boilerplate (`skip to content`, `sign in`, `subscribe`)
- Source-specific noise (Guardian nav, BBC headers, gov.uk boilerplate)
- Texts shorter than 50 characters are dropped

## Topic Modelling (LDA)

**Method**: Latent Dirichlet Allocation via scikit-learn's `LatentDirichletAllocation`

**Configuration**:
- 8 topics (`NUM_TOPICS = 8`)
- 3,000 max features (`LDA_MAX_FEATURES = 3000`)
- Unigrams + bigrams (`ngram_range=(1, 2)`)
- `min_df=5`, `max_df=0.85`
- 30 iterations, online learning, `random_state=42`

**Custom stop words**: ~150 words combining sklearn's `ENGLISH_STOP_WORDS` with:
- Web scraping artefacts: "guardian", "bbc", "telegraph", "cookies", "subscribe", "newsletter"
- Parliamentary procedure: "hon", "noble", "lord", "baroness", "committee", "clause", "amendment", "secretary state"
- Generic filler: "would", "going", "think", "really", "important"
- Year strings: "2020" through "2026"

**Auto-labelling**: Topics are labelled by matching their top 8 words against predefined keyword sets (e.g., `{"online", "children", "safety"}` → "Online Safety & Children").

**Resulting topics** (from analysis_summary.json):
- Topic 3: Legislation & EU Relations (data, EU, act, protection, rights)
- Topic 6: AI Regulation & Safety (ai safety, systems, companies, models, risks)
- Topic 7: Online Safety & Children (online, police, facial recognition, children)
- Topic 4: General Parliamentary Debate (work, public, support, future, technology)
- Topics 0, 1, 2, 5: Various (regulation, media/web artefacts, services/innovation)

## Sentiment Analysis (Triangulation)

### Why triangulation?

Rule-based and transformer methods have complementary blind spots. VADER excels at lexical sentiment but misses context; DistilBERT captures nuance but can be thrown off by domain-specific language. Running both and comparing reveals where they agree (robust signal) and where they diverge (requires interpretation).

### Method 1: VADER (Rule-Based)

**Library**: `vaderSentiment 3.3.2` (Hutto & Gilbert, 2014)

- Lexicon-based with rules for capitalisation, punctuation, degree modifiers, and negation
- Compound score: −1 to +1
- Thresholds: ≥ +0.05 = POSITIVE, ≤ −0.05 = NEGATIVE, else NEUTRAL
- Input truncated to 2,000 characters

### Method 2: DistilBERT (Transformer)

**Model**: `distilbert-base-uncased-finetuned-sst-2-english` (Hugging Face)

- 6-layer transformer, 66M parameters, fine-tuned on Stanford Sentiment Treebank (SST-2)
- Binary output: POSITIVE or NEGATIVE with confidence score (0–1)
- Rescaled to −1 to +1: NEGATIVE label → `−score`, POSITIVE → `+score`
- Input truncated to 512 tokens (model max) / 1,500 characters
- Batch size: 32
- GPU: T4 on Colab (`device=0`), CPU locally (`device=-1`)

### Combined Score

```python
combined_score = (vader_score + distilbert_score) / 2
```

Combined label thresholds: > +0.05 positive, < −0.05 negative, else neutral.

### Key Divergence (the critical finding)

| Arena | VADER | DistilBERT | Combined |
|-------|-------|------------|----------|
| Parliament | +0.633 | +0.224 | +0.429 |
| Media | +0.741 | −0.941 | −0.100 |

VADER rates media texts *more* positive than parliament (+0.741 vs +0.633). DistilBERT rates media texts *strongly* negative (−0.941). This divergence is the project's most important methodological finding: VADER's lexicon is fooled by positive vocabulary in negatively framed contexts (e.g., "AI threatens jobs but offers opportunities" scores high on positive words despite the overall framing being cautionary).

## Frame Classification

### Five "imagined futures" categories

Based on the theoretical framework (Beckert 2016; Suckert 2022):

1. **Utopian-Opportunity**: "opportunity", "transform", "revolution", "breakthrough", "prosperity", "empower", "world-leading", "global leader" (19 keywords)
2. **Dystopian-Risk**: "risk", "threat", "existential", "catastroph", "destroy", "surveillance", "deepfake", "autonomous weapon" (20 keywords)
3. **Regulatory-Governance**: "regulation", "framework", "governance", "oversight", "accountability", "transparency", "guardrail", "pro-innovation" (18 keywords)
4. **Economic-Industrial**: "economy", "industry", "investment", "startup", "market", "workforce", "training", "GDP", "industrial strategy" (20 keywords)
5. **Ethical-Rights**: "ethics", "human rights", "dignity", "consent", "privacy", "fairness", "explainab", "trustworthy" (keywords)

### Classification method

For each text, count keyword matches per category. Assign the frame with the highest count. Texts with no matches → "unclassified".

This is deliberately simple — keyword dictionaries are transparent and reproducible, unlike LLM-based classification which would introduce model-specific biases.

## Output Files

### data_matrix.csv (4,356 rows × 21 columns)

| Column | Description |
|--------|-------------|
| arena | "parliament" or "media" |
| source | "ParlaMint", "Hansard", or outlet name |
| speaker | Speaker name |
| party | Normalised party |
| house | "Commons", "Lords", or "Unknown" |
| date | ISO date string |
| text_length | Character count |
| vader_label | POSITIVE / NEGATIVE / NEUTRAL |
| vader_score | VADER compound (−1 to +1) |
| distilbert_label | POSITIVE / NEGATIVE |
| distilbert_score | Rescaled (−1 to +1) |
| sentiment_label | Combined label |
| sentiment_score | Mean of VADER + DistilBERT |
| dominant_topic | Topic ID (0–7) |
| dominant_frame | Winning frame name |
| frame_utopian | Keyword count |
| frame_dystopian | Keyword count |
| frame_regulatory | Keyword count |
| frame_economic | Keyword count |
| frame_ethical | Keyword count |
| text_preview | First 200 chars |

### analysis_summary.json

Aggregated statistics: dataset summary, 8 topic definitions with labels, comparisons by arena, by party, and by party × arena (sentiment averages, top frames, counts).

## Running the Pipeline

### Local (CPU)
```bash
python nlp_analysis.py --outDir ./analysis_output
```

### Google Colab (GPU — recommended)
1. Upload `colab_nlp_final.py` to Colab
2. Upload data files to `/content/`: `parlamint_ai_debates.json`, `hansard_all_speeches.json`, `media_statements/raw/*.json`
3. Run with T4 GPU runtime
4. Downloads `analysis_output.zip` automatically

**Colab differences**: `BASE_DIR = "/content"`, flat file structure, always runs both VADER + DistilBERT (no `--useHF` flag), `device=0` for GPU.
