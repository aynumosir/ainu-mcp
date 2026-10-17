"""Lexical lookup keys, kept separate from printed dictionary headings."""

import re

NAKAGAWA = "1995_Nakagawa_Ainu-Chitose-Dialect-Dictionary"


def nakagawa_lemma(heading: str, pos: str = "") -> str:
    """Remove a noun's abbreviated forms without truncating verbal phrases."""
    parts = re.split(r"[,，、]\s*", heading.strip())
    if len(parts) == 1 or "連動" in pos or parts[0].rstrip().endswith(("-", "=")):
        return heading.strip()
    if all(re.fullmatch(r"(?:-[^\s,，、]+|[aeiou]|ke)\??", p) for p in parts[1:]):
        return parts[0].strip()
    return heading.strip()


def dictionary_lemma(name: str, entry: dict) -> str:
    heading = entry.get("lemma") or ""
    if not isinstance(heading, str):
        return ""
    return nakagawa_lemma(heading, entry.get("pos") or "") if name == NAKAGAWA else heading.strip()
