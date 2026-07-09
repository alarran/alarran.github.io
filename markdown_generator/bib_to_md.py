#!/usr/bin/env python3
"""Turn a BibTeX citation into a ready-to-use _publications/*.md file.

Fast path for adding a paper: copy a BibTeX entry (e.g. from the "Cite ->
BibTeX" link on a Google Scholar paper page), then run:

    # from a file containing one or more BibTeX entries:
    python3 markdown_generator/bib_to_md.py path/to/refs.bib

    # or paste directly and press Ctrl-D when done:
    python3 markdown_generator/bib_to_md.py

For each entry it writes one file into _publications/ with the title, venue,
date, paper URL, and a formatted citation already filled in.

The ONE thing BibTeX from Scholar does not contain is the abstract, so:
  * if the entry has an `abstract = {...}` field, it is used as the page body;
  * otherwise a "TODO: paste abstract" placeholder is written and the script
    warns you, so you just open the file and drop the abstract in.

Uses only the Python standard library. No pip installs.
"""

import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
OUT_DIR = SCRIPT_DIR.parent / "_publications"

MONTHS = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
    "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
}

# Common LaTeX accent escapes -> unicode. Extend as needed.
LATEX_ACCENTS = {
    r"{\~n}": "ñ", r"\~n": "ñ", r"{\~N}": "Ñ",
    r"{\'a}": "á", r"\'a": "á", r"{\'e}": "é", r"\'e": "é",
    r"{\'i}": "í", r"\'i": "í", r"{\'o}": "ó", r"\'o": "ó",
    r"{\'u}": "ú", r"\'u": "ú", r"{\'A}": "Á", r"{\'E}": "É",
    r"{\'I}": "Í", r"{\'O}": "Ó", r"{\'U}": "Ú",
    r'{\"a}': "ä", r'{\"o}': "ö", r'{\"u}': "ü", r'{\"A}': "Ä",
    r'{\"O}': "Ö", r'{\"U}': "Ü",
    r"{\`a}": "à", r"{\`e}": "è", r"{\`o}": "ò",
    r"{\^a}": "â", r"{\^e}": "ê", r"{\^o}": "ô",
    r"{\c c}": "ç", r"{\c{c}}": "ç", r"{\cc}": "ç",
    r"{\ss}": "ß",
}

CONFERENCE_TYPES = {"inproceedings", "conference", "proceedings"}


def clean(text):
    """Convert common LaTeX escapes to unicode and strip stray braces."""
    if not text:
        return ""
    for latex, uni in LATEX_ACCENTS.items():
        text = text.replace(latex, uni)
    text = text.replace(r"\&", "&").replace(r"\_", "_").replace(r"\%", "%")
    text = text.replace("{", "").replace("}", "").replace("\\", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_bibtex(text):
    """Return a list of (entry_type, fields_dict). Tolerant of % inside values."""
    entries = []
    i, n = 0, len(text)
    while True:
        at = text.find("@", i)
        if at == -1:
            break
        brace = text.find("{", at)
        if brace == -1:
            break
        etype = text[at + 1:brace].strip().lower()
        # find the matching closing brace for the whole entry
        depth, j = 0, brace
        while j < n:
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        body = text[brace + 1:j]
        i = j + 1
        comma = body.find(",")
        if comma == -1:
            continue
        fields = parse_fields(body[comma + 1:])
        entries.append((etype, fields))
    return entries


def parse_fields(s):
    """Parse `name = {value}` / `name = "value"` / `name = bareword` pairs."""
    fields = {}
    i, n = 0, len(s)
    while i < n:
        while i < n and s[i] in " \t\r\n,":
            i += 1
        eq = s.find("=", i)
        if eq == -1:
            break
        name = s[i:eq].strip().lower()
        i = eq + 1
        while i < n and s[i] in " \t\r\n":
            i += 1
        if i >= n:
            break
        if s[i] == "{":
            depth, start = 0, i
            while i < n:
                if s[i] == "{":
                    depth += 1
                elif s[i] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            val = s[start + 1:i]
            i += 1
        elif s[i] == '"':
            start = i + 1
            i += 1
            while i < n and s[i] != '"':
                i += 1
            val = s[start:i]
            i += 1
        else:
            start = i
            while i < n and s[i] not in ",\r\n":
                i += 1
            val = s[start:i].strip()
        if name:
            fields[name] = val
    return fields


def format_author(raw):
    """Normalize one author to 'First Last'. Accepts 'Last, First' or 'First Last'."""
    raw = clean(raw)
    if "," in raw:
        last, first = [p.strip() for p in raw.split(",", 1)]
        return f"{first} {last}".strip()
    return raw


def build_authors(field):
    people = [format_author(a) for a in re.split(r"\s+and\s+", field) if a.strip()]
    if not people:
        return ""
    if len(people) == 1:
        return people[0]
    return ", ".join(people[:-1]) + ", and " + people[-1]


def build_citation(fields, venue, year):
    authors = build_authors(fields.get("author", ""))
    title = clean(fields.get("title", ""))
    parts = []
    if authors:
        parts.append(authors + ".")
    if title:
        parts.append(title + ".")
    tail = venue
    vol = clean(fields.get("volume", ""))
    num = clean(fields.get("number", ""))
    pages = clean(fields.get("pages", "").replace("--", "-"))
    if vol:
        tail += f", {vol}"
        if num:
            tail += f"({num})"
        if pages:
            tail += f":{pages}"
    elif pages:
        tail += f", {pages}"
    if year:
        tail += f", {year}"
    parts.append(tail + ".")
    return " ".join(parts)


def yaml_dq(v):
    return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'


def yaml_sq(v):
    return "'" + v.replace("'", "''") + "'"


def slugify(text, maxwords=6):
    words = re.sub(r"[^a-zA-Z0-9\s-]", "", text).lower().split()
    return "-".join(words[:maxwords]) or "untitled"


def make_filename(fields, year, existing):
    author = fields.get("author", "")
    last = ""
    if author:
        first_author = re.split(r"\s+and\s+", author)[0]
        last = clean(first_author.split(",")[0]).split()[-1].lower() if first_author else ""
    stem = "-".join(p for p in [year or "undated", last, slugify(clean(fields.get("title", "")), 4)] if p)
    stem = re.sub(r"-+", "-", stem).strip("-")
    name = stem
    k = 2
    while name in existing:
        name = f"{stem}-{k}"
        k += 1
    existing.add(name)
    return name


def render(fields, etype):
    year = clean(fields.get("year", ""))
    month = clean(fields.get("month", "")).lower()[:3]
    mm = MONTHS.get(month, "01")
    date = f"{year}-{mm}-01" if year else "1900-01-01"

    venue = clean(fields.get("journal") or fields.get("booktitle") or fields.get("publisher") or "")
    category = "conferences" if etype in CONFERENCE_TYPES else "manuscripts"

    url = fields.get("url", "").strip()
    doi = fields.get("doi", "").strip()
    paperurl = url or (f"https://doi.org/{doi}" if doi else "")

    title = clean(fields.get("title", ""))
    citation = build_citation(fields, venue, year)

    abstract = clean(fields.get("abstract", ""))
    has_abstract = bool(abstract)
    if not has_abstract:
        abstract = "TODO: paste the abstract here."

    front = [
        "---",
        f"title: {yaml_dq(title)}",
        "collection: publications",
        f"category: {category}",
        f"date: {date}",
        f"venue: {yaml_sq(venue)}",
        f"paperurl: {yaml_sq(paperurl)}",
        f"citation: {yaml_sq(citation)}",
        "---",
    ]
    return "\n".join(front) + "\n\n" + abstract + "\n", has_abstract, title


def main():
    if len(sys.argv) > 1:
        raw = Path(sys.argv[1]).read_text(encoding="utf-8")
    else:
        print("Paste BibTeX, then press Ctrl-D:", file=sys.stderr)
        raw = sys.stdin.read()

    entries = parse_bibtex(raw)
    if not entries:
        sys.exit("ERROR: no BibTeX entries found in the input.")

    OUT_DIR.mkdir(exist_ok=True)
    existing_names = {p.stem for p in OUT_DIR.glob("*.md")}
    needs_abstract = []

    for etype, fields in entries:
        md, has_abstract, title = render(fields, etype)
        name = make_filename(fields, clean(fields.get("year", "")), existing_names)
        out = OUT_DIR / f"{name}.md"
        out.write_text(md, encoding="utf-8")
        flag = "" if has_abstract else "   <-- add abstract"
        print(f"  wrote _publications/{out.name}{flag}")
        if not has_abstract:
            needs_abstract.append(out.name)

    print(f"\nDone: {len(entries)} file(s) written.")
    if needs_abstract:
        print("\nThese have no abstract in the BibTeX — open each and replace the")
        print("'TODO: paste the abstract here.' line with the real abstract:")
        for f in needs_abstract:
            print(f"  - _publications/{f}")


if __name__ == "__main__":
    main()
