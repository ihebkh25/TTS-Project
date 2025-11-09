# scripts/download_voices.py
from huggingface_hub import snapshot_download
from pathlib import Path
import shutil
import sys

# IMPORTANT: this is a *model* repo, not a dataset repo
REPO_ID = "rhasspy/piper-voices"
REPO_TYPE = "model"  # <-- fix

# Each entry is (local_lang_dir, repo_dir_prefix)
# Use the folder prefixes shown in VOICES.md under this repo.
VOICE_DIRS = [
    # German (de_DE) - mls medium
    ("de_DE", "de/de_DE/mls/medium"),
    # French (fr_FR) - siwis medium
    ("fr_FR", "fr/fr_FR/siwis/medium"),
    # Dutch (nl_NL) - i6 medium
    ("nl_NL", "nl/nl_NL/i6/medium"),
    # Arabic (ar_JO) - ep medium
    ("ar_JO", "ar/ar_JO/ep/medium"),
    # Add more from VOICES.md as needed...
]

def download_dir(prefix_repo_dir: str, out_lang: str):
    print(f"\n>>> Downloading for {out_lang} from '{prefix_repo_dir}' ...")
    cache_dir = snapshot_download(
        repo_id=REPO_ID,
        repo_type=REPO_TYPE,
        allow_patterns=[
            f"{prefix_repo_dir}/*.onnx",
            f"{prefix_repo_dir}/*.onnx.json",
        ],
    )
    outdir = Path("models") / out_lang
    outdir.mkdir(parents=True, exist_ok=True)

    copied = 0
    for p in Path(cache_dir).rglob("*"):
        if p.suffix == ".onnx" or p.name.endswith(".onnx.json"):
            target = outdir / p.name
            shutil.copy2(p, target)
            size_mb = target.stat().st_size / (1024 * 1024)
            print(f"Saved {target} ({size_mb:.1f} MB)")
            copied += 1

    if copied == 0:
        print(f"ERROR: No .onnx or .onnx.json under '{prefix_repo_dir}'.", file=sys.stderr)
        print("Double-check the directory name against rhasspy/piper-voices VOICES.md.", file=sys.stderr)
        sys.exit(1)

def main():
    for lang, prefix in VOICE_DIRS:
        download_dir(prefix, lang)
    print("\nDone. Check the models/ folders for files.")

if __name__ == "__main__":
    main()
