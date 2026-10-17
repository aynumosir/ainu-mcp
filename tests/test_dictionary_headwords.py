import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from ainu_mcp import dictionaries, gaps
from ainu_mcp.headwords import NAKAGAWA, nakagawa_lemma
from etl import build_d1

ROWS = [
    {"lemma": "eawnarura", "definition": "運ぶ", "pos": "動2", "_file": "terms.tsv"},
    {"lemma": "rur, -i", "definition": "海の潮", "pos": "名", "_file": "terms.tsv"},
    {"lemma": "askepet, -i", "definition": "指", "pos": "名", "_file": "terms.tsv"},
    {"lemma": "ka,-si oyki", "definition": "面倒を見る", "pos": "連動", "_file": "terms.tsv"},
]


class HeadwordTests(unittest.TestCase):
    def test_notation_preserves_phrases_and_literal_bound_headwords(self):
        for suffix in ["-i", "-ke", "-i-ke", "-i=ke", "ke"]:
            self.assertEqual(nakagawa_lemma(f"rur, {suffix}"), "rur")
        for heading, pos in [("ka,-si oyki", ""), ("kip, -iniwkes", "連動"), ("-kar³", "")]:
            self.assertEqual(nakagawa_lemma(heading, pos), heading)
        self.assertEqual(nakagawa_lemma("rep², -ke"), "rep²")
        self.assertEqual(nakagawa_lemma("kimuyka, -si, -ke"), "kimuyka")

    @patch.object(dictionaries, "_load_dict", return_value=ROWS)
    def test_exact_headword_wins_at_limit_one_without_changing_display(self, _load):
        for query in ["rur", " RUR ", "rur, -i"]:
            result = dictionaries.reverse_lookup(query, dicts=[NAKAGAWA], limit=1)
            self.assertEqual(result[0]["lemma"], "rur, -i")
            self.assertEqual(result[0]["definition"], "海の潮")

    @patch.object(dictionaries, "_list_dicts", return_value=[NAKAGAWA])
    @patch.object(dictionaries, "_load_dict", return_value=ROWS)
    def test_gap_index_uses_headwords(self, _load, _list):
        gaps._dict_lemma_index.cache_clear()
        try:
            heads = gaps._dict_lemma_index()[NAKAGAWA]
            self.assertIn("rur", heads)
            self.assertNotIn("-i", heads)
            self.assertNotIn("ka", heads)
        finally:
            gaps._dict_lemma_index.cache_clear()

    @patch.object(dictionaries, "_list_dicts", return_value=[NAKAGAWA])
    @patch.object(dictionaries, "_load_dict", return_value=ROWS)
    def test_seed_keeps_printed_fields_with_canonical_lookup_key(self, _load, _list):
        with tempfile.TemporaryDirectory() as tmp, patch.object(build_d1, "DATA_DIR", Path(tmp)):
            build_d1.build_dictionaries()
            db = sqlite3.connect(":memory:")
            db.execute("CREATE TABLE dict_entries(id,dictionary,source_file,lemma,lemma_lower,definition,fields_json,field_order,all_text_lower)")
            for path in Path(tmp).glob("dict_entries_*.sql"):
                db.executescript(path.read_text())
            row = db.execute("SELECT lemma,definition FROM dict_entries WHERE lemma_lower='rur'").fetchone()
            self.assertEqual(row, ("rur, -i", "海の潮"))
            self.assertEqual(db.execute("SELECT count(*) FROM dict_entries WHERE lemma_lower IN ('-i','ka')").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
