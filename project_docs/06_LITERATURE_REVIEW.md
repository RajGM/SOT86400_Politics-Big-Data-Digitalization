# Literature Review and Theoretical Framework

## Core Concept: Imagined Futures

### Jens Beckert — *Imagined Futures* (2016)

Central theoretical foundation. Beckert argues that economic actors make decisions under "fundamental uncertainty" — the future is unknowable, not merely risky. In response, actors construct "fictional expectations": narratives about the future that coordinate present-day action. These fictional expectations are not false beliefs but pragmatic tools that enable decision-making.

**Application to this project**: Politicians constructing AI discourse are creating fictional expectations about technological futures. When a minister says "AI will make the UK a global leader," this is not a prediction but a performative narrative that shapes policy, investment, and public opinion.

### Lisa Suckert — "The Mutual Constitution of Imagined Futures and Capitalist Dynamics" (2022)

Extends Beckert by arguing that imagined futures are not merely individual cognitive acts but are socially produced in specific institutional contexts. The *arena* in which futures are articulated shapes their form: parliamentary deliberation, media commentary, corporate lobbying, and academic discourse each produce different kinds of futures.

**Application**: This is the theoretical basis for our arena comparison. Suckert's framework predicts that parliament (a deliberative arena) should produce more varied, contested futures, while media (an attention-driven arena) should produce simpler, more dramatic ones.

### Mark Thompson — "Enough Said: What's Gone Wrong with the Language of Politics" (2016)

Analyses how political language has diverged between institutional and public-facing contexts. Politicians use different rhetorical strategies depending on their audience: nuanced, hedged language in parliament vs. simplified, attention-seeking language in media.

**Application**: Supports the hypothesis that the arena effect is systematic, not incidental. Thompson's work predicts the sentiment and framing shifts we observed.

## AI Governance Literature

### Sara Constantino et al. — "The Future Is Not Fate" (2024)

Examines how imagined futures of AI influence public attitudes and policy preferences. Finds that optimistic framings increase support for laissez-faire regulation, while risk framings increase support for government intervention. The framing of AI futures is not neutral — it has material policy consequences.

**Application**: Connects our frame classification to real policy outcomes. The dominance of economic-industrial framing in media may shape public expectations toward commercial rather than regulatory responses to AI.

### Carsten Friedrich et al. — "Mapping Imagined Futures of AI" (2024)

Develops a typology of AI futures based on German parliamentary debates. Identifies utopian, dystopian, and pragmatic frames. Uses manual coding of parliamentary speeches.

**Application**: Our five-frame typology (utopian, dystopian, regulatory, economic, ethical) extends Friedrich's work by adding economic and ethical categories and automating classification via keyword dictionaries. We also extend the analysis beyond parliament into media.

## Methodological References

### C.J. Hutto & Eric Gilbert — "VADER: A Parsimonious Rule-based Model for Sentiment Analysis of Social Media Text" (2014)

Presents the VADER (Valence Aware Dictionary and sEntiment Reasoner) lexicon and rule-based sentiment analysis tool. Designed for social media but applicable to political text. Advantages: fast, transparent, no training required. Limitations: lexicon-based, misses contextual framing.

**Application**: VADER is our first sentiment method. Its limitations (positive words in negative contexts score positively) are precisely what motivates the triangulation approach.

### Victor Sanh et al. — "DistilBERT, a distilled version of BERT" (2019)

Presents a compressed transformer model retaining 97% of BERT's performance at 60% the size. Fine-tuned on SST-2 (Stanford Sentiment Treebank) for binary sentiment classification.

**Application**: DistilBERT is our second sentiment method. Its contextual understanding complements VADER's lexical approach, enabling the triangulation that revealed the VADER-DistilBERT divergence on media texts.

### ParlaMint Consortium — "ParlaMint: Comparable Parliamentary Corpora" (2022)

Describes the ParlaMint project: standardised TEI-encoded parliamentary corpora from 29 national parliaments. Version 4.0 includes linguistically annotated data with named entity recognition and syntactic parsing.

**Application**: ParlaMint-GB is our primary data source for the 2020–2022 parliamentary period. The standardised TEI format enables reproducible extraction.

## How the Framework Connects

The theoretical chain:

1. **Beckert**: Actors create fictional expectations about the future under uncertainty
2. **Suckert**: These fictional expectations are shaped by the institutional arena
3. **Thompson**: Political language systematically differs between institutional and public contexts
4. **Constantino**: AI-specific imagined futures have measurable policy consequences
5. **Friedrich**: Parliamentary AI futures can be categorised into typologies
6. **Our contribution**: Quantitative comparison of two arenas (parliament vs. media) using dual-method sentiment analysis and keyword-based frame classification, finding that arena is a stronger driver than party ideology

## Full Bibliography

The complete bibliography (12 sources) is in `ReportTemplate/literature.bib` in BibLaTeX-APA format. Key entries: `beckert2016`, `suckert2022`, `thompson2016`, `constantino2024`, `friedrich2024`, `hutto2014`, `sanh2019`, `parlamint2022`.
