import sys
import json
from pathlib import Path

def update_version(new_version: str, addon_dir: str):
    # Update VERSION file
    version_file = Path(addon_dir) / "VERSION"
    version_file.write_text(new_version.strip())
    print(f"Updated {version_file}")

    # Update manifest.json
    manifest_file = Path(addon_dir) / "manifest.json"
    if manifest_file.exists():
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        manifest["version"] = new_version.strip()
        manifest_file.write_text(json.dumps(manifest, indent=4), encoding="utf-8")
        print(f"Updated {manifest_file}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python new_version.py <new_version> <addon_dir>")
        sys.exit(1)
    
    update_version(sys.argv[1], sys.argv[2])
