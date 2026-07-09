#!/usr/bin/env python3
"""Generate _publications/*.md from markdown_generator/publications.toml.

publications.toml is the single source of truth for the publication list.
Edit that file, then run:

    python3 markdown_generator/generate_publications.py

One Markdown file is written per [[publication]] entry, in the exact format the
academicpages template expects (front matter + abstract as the page body).

Uses only the Python standard library (tomllib, Python 3.11+). No pip installs.
"""

import sys
import tomllib
from pathlib import Path

REQUIRED_FIELDS = ("filename", "title", "category", "date", "venue", "paperurl", "citation")

# Repo layout: this script lives in markdown_generator/, publications live in _publications/
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
SOURCE = SCRIPT_DIR / "publications.toml"
OUT_DIR = REPO_ROOT / "_publications"


def yaml_double_quote(value):
    """Quote a string for a double-quoted YAML scalar (used for `title`)."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def yaml_single_quote(value):
    """Quote a string for a single-quoted YAML scalar (venue/paperurl/citation)."""
    return "'" + value.replace("'", "''") + "'"


def render(pub):
    front = [
        "---",
        f"title: {yaml_double_quote(pub['title'])}",
        "collection: publications",
        f"category: {pub['category']}",
        f"date: {pub['date']}",
        f"venue: {yaml_single_quote(pub['venue'])}",
        f"paperurl: {yaml_single_quote(pub['paperurl'])}",
        f"citation: {yaml_single_quote(pub['citation'])}",
        "---",
    ]
    abstract = pub.get("abstract", "").strip("\n")
    return "\n".join(front) + "\n\n" + abstract + "\n"


def main():
    if not SOURCE.exists():
        sys.exit(f"ERROR: source file not found: {SOURCE}")

    with open(SOURCE, "rb") as f:
        data = tomllib.load(f)

    pubs = data.get("publication", [])
    if not pubs:
        sys.exit("ERROR: no [[publication]] entries found in publications.toml")

    OUT_DIR.mkdir(exist_ok=True)

    written = set()
    seen_names = set()
    for i, pub in enumerate(pubs, 1):
        missing = [k for k in REQUIRED_FIELDS if not pub.get(k)]
        if missing:
            sys.exit(f"ERROR: publication #{i} is missing required field(s): {', '.join(missing)}")

        name = pub["filename"]
        if name in seen_names:
            sys.exit(f"ERROR: duplicate filename '{name}' in publications.toml")
        seen_names.add(name)

        out_path = OUT_DIR / f"{name}.md"
        out_path.write_text(render(pub), encoding="utf-8")
        written.add(out_path.name)
        print(f"  wrote _publications/{out_path.name}  ({pub['title'][:55]}{'…' if len(pub['title']) > 55 else ''})")

    print(f"\nDone: {len(written)} publication file(s) written.")

    # Warn about stray .md files in _publications/ that this run did NOT produce
    # (e.g. a paper you removed from the TOML, or a leftover template file).
    strays = sorted(
        p.name for p in OUT_DIR.glob("*.md") if p.name not in written
    )
    if strays:
        print("\nNOTE: these files in _publications/ are NOT in publications.toml:")
        for s in strays:
            print(f"  - {s}")
        print("Delete them by hand if they should no longer appear on the site.")


if __name__ == "__main__":
    main()
