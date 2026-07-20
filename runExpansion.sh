#!/bin/bash
# === Dataset 2 Expansion: 50 new politicians, max web search ===
# Uses latest OpenAI model with maximum search coverage
#
# BEFORE RUNNING:
#   1. cd F:\PoliticsBigData  (or the equivalent path)
#   2. npm install openai@latest
#   3. bash runExpansion.sh
#
# The script is resumable - if it stops, just run again.

cd "$(dirname "$0")"

echo ""
echo "============================================================"
echo " Dataset 2 Expansion: 50 new politicians"
echo " Model: gpt-4.1 (latest), 8 keywords, 10 results per query"
echo " Provider: OpenAI Responses API with web_search"
echo "============================================================"
echo ""

node fetchMediaStatements.js \
  --provider openai \
  --model gpt-4.1 \
  --politiciansFile ./media_statements/media_expansion_candidates.json \
  --keywords 8 \
  --results 10 \
  --delay 2000 \
  --onlyNew

echo ""
echo "Done! Check media_statements/media_statements_all.csv"
