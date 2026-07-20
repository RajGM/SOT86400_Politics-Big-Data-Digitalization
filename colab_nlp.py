# ============================================================
# NLP Analysis Pipeline — Google Colab Setup
# ============================================================
# 1. Upload these files to Colab (or mount from Google Drive):
#    - nlp_analysis.py
#    - parlamint_parsed/parlamint_ai_debates.json
#    - hansard_debates/hansard_all_speeches.json
#    - media_statements/raw/*.json  (all 126 files)
#
# 2. Paste this entire cell into Colab and run it.
# ============================================================

import os, subprocess

# --- Step 1: Install dependencies ---
subprocess.run(["pip", "install", "-q", "vaderSentiment", "transformers", "torch",
                 "scikit-learn", "pandas", "numpy"], check=True)

# --- Step 2: Create folder structure ---
os.makedirs("parlamint_parsed", exist_ok=True)
os.makedirs("hansard_debates", exist_ok=True)
os.makedirs("media_statements/raw", exist_ok=True)
os.makedirs("analysis_output_v2", exist_ok=True)

# --- Step 3: Check all required files exist ---
required = [
    "nlp_analysis.py",
    "parlamint_parsed/parlamint_ai_debates.json",
    "hansard_debates/hansard_all_speeches.json",
]
missing = [f for f in required if not os.path.exists(f)]
raw_count = len([f for f in os.listdir("media_statements/raw") if f.endswith(".json")])

if missing:
    print("❌ MISSING FILES — upload these before running:")
    for f in missing:
        print(f"   {f}")
else:
    print(f"✅ All core files found. Media raw JSONs: {raw_count}")
    if raw_count == 0:
        print("⚠️  No media_statements/raw/*.json files found — media analysis will be empty")

# --- Step 4: Run the pipeline ---
if not missing:
    print("\n" + "="*60)
    print("Running NLP pipeline with DistilBERT + VADER + LDA...")
    print("="*60 + "\n")
    !python nlp_analysis.py --outDir ./analysis_output_v2 --useHF

    # --- Step 5: Download results ---
    if os.path.exists("analysis_output_v2/analysis_summary.json"):
        print("\n✅ Done! Downloading results...")
        from google.colab import files
        files.download("analysis_output_v2/data_matrix.csv")
        files.download("analysis_output_v2/analysis_summary.json")
        files.download("analysis_output_v2/analysis_report.md")
    else:
        print("\n❌ Pipeline failed — check errors above")
