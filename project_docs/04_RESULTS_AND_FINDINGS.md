# Results and Findings

## Dataset Summary

| Metric | Value |
|--------|-------|
| Total texts | 4,356 |
| Parliamentary utterances | 3,141 (72.1%) |
| Media statements | 1,215 (27.9%) |
| Unique speakers | 1,151 |
| Unique parties | 19 (9 major) |
| Date range | 2020–2026 |

## Finding 1: Frame Distribution by Arena

Parliament sustains a pluralistic spread of imagined futures. Media compresses discourse into a single dominant frame.

### Parliament frame distribution:
- Utopian-Opportunity: 25.0% (786 texts)
- Regulatory-Governance: 20.0% (627)
- Unclassified: 19.5% (611)
- Economic-Industrial: 17.7% (555)
- Dystopian-Risk: 12.8% (402)
- Ethical-Rights: 5.0% (157)

### Media frame distribution:
- Economic-Industrial: **45.5%** (553 texts)
- Dystopian-Risk: 20.8% (253)
- Utopian-Opportunity: 16.2% (197)
- Regulatory-Governance: 8.2% (100)
- Ethical-Rights: 4.1% (50)
- Unclassified: 5.1% (62)

**Interpretation**: Parliament operates as a deliberative space where multiple futures coexist. Media flattens AI discourse into economic framings (jobs, investment, competitiveness), consistent with media logic prioritising economic narratives (Beckert 2016). The regulatory and ethical frames that occupy 25% of parliamentary discourse shrink to 12.3% in media.

## Finding 2: Sentiment by Arena

| Arena | VADER | DistilBERT | Combined | % Positive | % Negative |
|-------|-------|------------|----------|-----------|-----------|
| Parliament | +0.633 | +0.224 | **+0.429** | 63.3% | 25.5% |
| Media | +0.741 | −0.941 | **−0.100** | 4.8% | 36.5% |

**The triangulation divergence**: VADER and DistilBERT agree on parliament (both positive). On media, they diverge dramatically: VADER rates media *more* positive than parliament, while DistilBERT rates it strongly negative. This validates the dual-method approach — a single method would give a misleading picture.

**Why VADER and DistilBERT disagree on media**: Media articles use positive vocabulary in negatively framed contexts. A sentence like "AI threatens thousands of jobs but ministers say it will create new opportunities" contains many positive words that VADER counts, but DistilBERT's contextual understanding captures the overall cautionary framing. Parliamentary language, being more straightforwardly deliberative, doesn't create this divergence.

## Finding 3: Universal Party Shift (Arena Effect)

Every single party shifts from positive sentiment in parliament to negative in media. This is the strongest evidence that arena, not party ideology, drives the sentiment difference.

| Party | Parliament | Media | Shift |
|-------|-----------|-------|-------|
| Conservative | +0.509 | −0.073 | −0.582 |
| Labour | +0.491 | −0.071 | −0.562 |
| Liberal Democrat | +0.237 | −0.137 | −0.374 |
| Crossbench | +0.283 | −0.170 | −0.453 |
| SNP | +0.262 | −0.181 | −0.443 |
| Green | +0.255 | −0.293 | −0.548 |
| Bishops | +0.275 | −0.112 | −0.387 |
| Independent | +0.304 | −0.008 | −0.312 |

**Top frames also shift**: Every party's top frame in parliament is utopian or regulatory. Every party's top frame in media is economic-industrial.

## Finding 4: Party-Level Differences

Despite the universal arena effect, parties differ in their baseline tendencies:

- **Conservative** (n=1,497): Highest overall sentiment (+0.287). Emphasises economic-industrial frames (31% of texts). Strong utopian framing in parliament.
- **Labour** (n=1,203): Similar to Conservative in overall sentiment (+0.308). More balanced frame distribution. Slightly more regulatory emphasis.
- **Liberal Democrat** (n=374): Lower sentiment (+0.042). Highest proportion of dystopian-risk framing (16.8%). Strongest regulatory emphasis (26.7%).
- **Crossbench** (n=274): Moderate sentiment (+0.170). Regulatory and economic frames balanced.
- **SNP** (n=65): Moderate sentiment (+0.113). Dystopian-risk frames relatively prominent.
- **Green** (n=43): Near-neutral sentiment (−0.008). Most negative of all parties overall.
- **DUP** (n=22): Highest sentiment (+0.741) but only parliamentary texts (no media presence).

## Finding 5: Topic Modelling Results

8 LDA topics identified. Key substantive topics:

- **Topic 6 — AI Regulation & Safety**: "ai safety", "systems", "companies", "models", "risks", "institute", "regulation". Captures AI Safety Institute discourse and Bletchley Summit era.
- **Topic 7 — Online Safety & Children**: "online", "police", "facial recognition", "children", "content", "media". Maps to Online Safety Bill debates.
- **Topic 3 — Legislation & EU Relations**: "data", "EU", "act", "protection", "rights", "agreement". Post-Brexit data adequacy discussions.
- **Topic 4 — General Parliamentary Debate**: Largest topic. Broad parliamentary language about technology and public services.

Topics 0, 1, 2, 5 contain web scraping artefacts mixed with substantive content — a limitation of applying LDA to mixed-source corpora with different noise profiles.

## Answering the Research Questions

### RQ1: What imagined futures do UK officials communicate about AI?

All five hypothesised frames are present. Utopian-opportunity (22.6% overall) and economic-industrial (25.4%) dominate, followed by regulatory-governance (16.7%), dystopian-risk (15.0%), and ethical-rights (4.8%). UK AI discourse is predominantly future-oriented and optimistic in parliament, but becomes more cautious and commercially focused in media.

### RQ2: Does the arena of communication shape the futures articulated?

Yes — arena is a stronger determinant than party. The sentiment shift from parliament to media is universal across all parties (−0.31 to −0.58 point drops). The frame composition shifts dramatically: parliament is pluralistic (no single frame exceeds 25%), while media concentrates on economic-industrial (45.5%). This supports the hypothesis that parliamentary settings foster deliberative pluralism while media logic compresses discourse into commercially relevant narratives.
