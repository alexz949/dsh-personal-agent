#!/usr/bin/env python3
"""Read the user's public Google Scholar profile and compare it with USER_PROFILE.md.

Read-only: it fetches one page and prints JSON; it never edits USER_PROFILE.md. The agent shows
the differences to the user and edits the profile only after they agree. No third-party packages.

    python3 scripts/scholar.py              # papers on the profile
    python3 scripts/scholar.py --compare    # plus which ones USER_PROFILE.md does not list yet
"""

import argparse
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "shared" / "USER_PROFILE.md"
LINK = re.compile(r"https://scholar\.google\.com/citations\?user=([\w-]+)")
AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def text(fragment):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def plain(title):
    return re.sub(r"[^a-z0-9]+", "", title.lower())


def scholar_user(profile_text):
    match = LINK.search(profile_text)
    if not match:
        raise SystemExit("USER_PROFILE.md has no Google Scholar link (https://scholar.google.com/citations?user=...)")
    return match.group(1)


def parse(page):
    if re.search(r"unusual traffic|captcha", page, re.I) and "gsc_a_tr" not in page:
        raise SystemExit("Google Scholar asked for a CAPTCHA; try again later or open the profile in a browser")
    name = re.search(r'id="gsc_prf_in">(.*?)</div>', page, re.S)
    papers = []
    for row in re.findall(r'<tr class="gsc_a_tr">(.*?)</tr>', page, re.S):
        anchor = re.search(r'<a\b([^>]*\bclass="gsc_a_at"[^>]*)>(.*?)</a>', row, re.S)
        title = anchor and anchor.group(2)
        link = anchor and re.search(r'\bhref="([^"]+)"', anchor.group(1))
        grays = [text(part) for part in re.findall(r'<div class="gs_gray">(.*?)</div>', row, re.S)]
        year = re.search(r'class="gsc_a_h gsc_a_hc gs_ibl">(\d{4})</span>', row)
        cites = re.search(r'class="gsc_a_ac[^"]*"[^>]*>(\d*)</a>', row)
        if not title:
            continue
        papers.append({
            "title": text(title),
            "authors": grays[0] if grays else "",
            "venue": re.sub(r",\s*\d{4}$", "", grays[1]).strip() if len(grays) > 1 else "",
            "year": int(year.group(1)) if year else None,
            "citations": int(cites.group(1)) if cites and cites.group(1) else 0,
            "link": "https://scholar.google.com" + html.unescape(link.group(1)) if link else None,
        })
    return {"name": text(name.group(1)) if name else None, "papers": papers}


def fetch(user):
    url = f"https://scholar.google.com/citations?user={user}&hl=en&cstart=0&pagesize=100"
    request = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return url, response.read().decode("utf-8", "replace")


def compare(papers, profile_text):
    """Papers whose titles are not in USER_PROFILE.md yet, and listed titles no longer on Scholar."""
    known = plain(profile_text)
    new = [paper for paper in papers if plain(paper["title"]) not in known]
    on_scholar = {plain(paper["title"]) for paper in papers}
    section = re.search(r"Own papers.*?\n((?:\s+- .*\n?)+)", profile_text)
    listed = re.findall(r"^\s+- (.+?)(?:\.\s|$)", section.group(1), re.M) if section else []
    missing = [title for title in listed if plain(title) not in on_scholar]
    return {"not_in_profile": new, "in_profile_not_on_scholar": missing}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Read the user's Google Scholar profile (read-only)")
    parser.add_argument("--compare", action="store_true", help="also compare with shared/USER_PROFILE.md")
    parser.add_argument("--profile", default=str(PROFILE), help=argparse.SUPPRESS)
    parser.add_argument("--page", help=argparse.SUPPRESS)  # a saved page, for tests
    args = parser.parse_args(argv)
    profile_text = Path(args.profile).read_text(encoding="utf-8")
    if args.page:
        url, page = args.page, Path(args.page).read_text(encoding="utf-8")
    else:
        url, page = fetch(scholar_user(profile_text))
    result = {"source": url, **parse(page)}
    if args.compare:
        result.update(compare(result["papers"], profile_text))
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    print()


if __name__ == "__main__":
    main()
