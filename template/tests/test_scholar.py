"""No network needed: parses a small saved profile page."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "scholar.py"

PAGE = """<div id="gsc_prf_in">Ada (A) Lovelace</div><table>
<tr class="gsc_a_tr"><td><a href="/citations?view_op=view_citation&amp;citation_for_view=u:1" class="gsc_a_at">Notes on the
 Analytical Engine</a><div class="gs_gray">A Lovelace, C Babbage</div><div class="gs_gray">Taylor&#39;s Memoirs 3, 1843</div></td>
<td><a class="gsc_a_ac gs_ibl">12</a></td><td><span class="gsc_a_h gsc_a_hc gs_ibl">1843</span></td></tr>
<tr class="gsc_a_tr"><td><a href="/citations?x=2" class="gsc_a_at">A Brand-New Paper</a><div class="gs_gray">A Lovelace</div><div class="gs_gray">arXiv preprint arXiv:2611.00001, 2026</div></td>
<td><a class="gsc_a_ac gs_ibl"></a></td><td><span class="gsc_a_h gsc_a_hc gs_ibl">2026</span></td></tr>
</table>"""

PROFILE = """## Research

- Google Scholar: https://scholar.google.com/citations?user=abc_DEF-1
- Own papers (never suggest these as new finds):
  - Notes on the Analytical Engine. Taylor's Memoirs, 1843.
  - A Withdrawn Paper. arXiv, 2025.
- Preferred paper alert cadence:
"""


class ScholarTests(unittest.TestCase):
    def run_script(self, *extra):
        with tempfile.TemporaryDirectory() as tmp:
            page, profile = Path(tmp) / "page.html", Path(tmp) / "USER_PROFILE.md"
            page.write_text(PAGE, encoding="utf-8")
            profile.write_text(PROFILE, encoding="utf-8")
            before = profile.read_text(encoding="utf-8")
            out = subprocess.run([sys.executable, "-I", str(SCRIPT), "--page", str(page), "--profile", str(profile), *extra],
                                 capture_output=True, text=True, check=True).stdout
            self.assertEqual(profile.read_text(encoding="utf-8"), before)
            return json.loads(out)

    def test_profile_page_parses_into_papers(self):
        result = self.run_script()
        self.assertEqual(result["name"], "Ada (A) Lovelace")
        self.assertEqual(result["papers"][0], {
            "title": "Notes on the Analytical Engine",
            "authors": "A Lovelace, C Babbage",
            "venue": "Taylor's Memoirs 3",
            "year": 1843,
            "citations": 12,
            "link": "https://scholar.google.com/citations?view_op=view_citation&citation_for_view=u:1",
        })
        self.assertEqual(result["papers"][1]["citations"], 0)
        self.assertNotIn("not_in_profile", result)

    def test_compare_lists_new_papers_and_ones_gone_from_scholar(self):
        result = self.run_script("--compare")
        self.assertEqual([paper["title"] for paper in result["not_in_profile"]], ["A Brand-New Paper"])
        self.assertEqual(result["in_profile_not_on_scholar"], ["A Withdrawn Paper"])


if __name__ == "__main__":
    unittest.main()
