#!/usr/bin/env python3
"""
Check for required Piper voice model files (*.onnx + *.onnx.json)
based on models/map.json configuration.
"""

import json
import sys
from pathlib import Path


def check_model_files(map_json_path: Path) -> tuple[bool, list[str]]:
    """
    Check if all model files referenced in map.json exist.
    
    Returns:
        (all_valid, messages) - tuple of (bool, list of status messages)
    """
    if not map_json_path.exists():
        return False, [f"ERROR: {map_json_path} not found"]
    
    try:
        with open(map_json_path, 'r') as f:
            config = json.load(f)
    except json.JSONDecodeError as e:
        return False, [f"ERROR: Invalid JSON in {map_json_path}: {e}"]
    
    messages = []
    all_valid = True
    base_dir = map_json_path.parent
    
    for lang_code, entry in config.items():
        if isinstance(entry, str):
            # Legacy format: just the config path
            config_path = Path(entry)
        elif isinstance(entry, dict):
            # New format: { "config": "...", "speaker": ... }
            config_path = Path(entry.get("config", ""))
        else:
            messages.append(f"❌ {lang_code}: Invalid entry format")
            all_valid = False
            continue
        
        # Resolve relative to map.json's directory
        if not config_path.is_absolute():
            # Handle paths that start with "models/" - remove the redundant prefix
            # since map.json is already in the models/ directory
            config_str = str(config_path)
            if config_str.startswith("models/"):
                config_path = base_dir / config_str[7:]  # Remove "models/" prefix
            else:
                config_path = base_dir / config_path
        
        # Check .onnx.json file
        if not config_path.exists():
            messages.append(f"❌ {lang_code}: Config file missing: {config_path}")
            all_valid = False
            continue
        
        # Check corresponding .onnx file (remove .json extension)
        onnx_path = config_path.with_suffix('')  # Remove .json
        if not onnx_path.exists():
            messages.append(f"❌ {lang_code}: Model file missing: {onnx_path}")
            all_valid = False
            continue
        
        # Get file sizes
        try:
            config_size = config_path.stat().st_size / 1024  # KB
            onnx_size = onnx_path.stat().st_size / (1024 * 1024)  # MB
            messages.append(
                f"✅ {lang_code}: {config_path.name} ({config_size:.1f} KB), "
                f"{onnx_path.name} ({onnx_size:.1f} MB)"
            )
        except OSError as e:
            messages.append(f"⚠️  {lang_code}: Could not read file sizes: {e}")
    
    return all_valid, messages


def main():
    project_root = Path(__file__).parent.parent
    map_json_path = project_root / "models" / "map.json"
    
    all_valid, messages = check_model_files(map_json_path)
    
    print("Piper Voice Model Files Check")
    print("=" * 50)
    print(f"Checking: {map_json_path}\n")
    
    for msg in messages:
        print(msg)
    
    print()
    if all_valid:
        print("✅ All model files are present!")
        sys.exit(0)
    else:
        print("❌ Some model files are missing.")
        print("\nTo download missing models, run:")
        print("  python scripts/download_voices.py")
        sys.exit(1)


if __name__ == "__main__":
    main()

