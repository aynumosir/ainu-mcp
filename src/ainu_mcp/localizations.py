"""Software-localization (i18n) strings from real Ainu-language software.

Gathers the Ainu message catalogues shipped by a curated set of public GitHub
projects (inlang, next-intl, and MediaWiki i18n) so the MCP can answer "how has
this UI concept actually been translated into Ainu?". Each message becomes one
row: the Ainu string, its message key, and — where the project ships a
source-language catalogue alongside it — the original (usually English/Japanese)
string for the same key.

Discovery is automatic per repo: the GitHub git-trees API is walked for every
file named ``ain.json`` / ``ain-Latn.json`` / etc., so new MediaWiki extensions
or message files are picked up without editing this list. Only the *repos* are
curated (``PROJECTS``).

Like ``ainu_mcp.stopwords`` this fetches straight from public GitHub at build
time (no clone needed) and degrades gracefully: an unreachable repo or file is
skipped, never fatal, so a transient GitHub hiccup can't break the seed build
(CI validates the critical corpus/dictionary data separately). Set ``GITHUB_TOKEN``
(or ``GH_TOKEN``) to raise the API rate limit — the CI job passes the standard
``GITHUB_TOKEN``.
"""

from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from functools import cache
from typing import Any

# Curated repos. Discovery within each is automatic (see _tree). `format` only
# steers where the source-language original is looked for and is also surfaced
# as metadata.
PROJECTS: list[dict[str, str]] = [
    {
        "repo": "mkpoli/word-order",
        "title": "Word Order Illustrator",
        "description": "Visualizes word-order / syntax links across two languages.",
        "format": "inlang",
    },
    {
        "repo": "mkpoli/contexto-multilang",
        "title": "Contexto (multilingual)",
        "description": "Semantic word-guessing game, in Ainu.",
        "format": "inlang",
    },
    {
        "repo": "mkpoli/ainu-itah",
        "title": "Aynu Itah",
        "description": "Sakhalin Ainu dictionary / learning app.",
        "format": "inlang",
    },
    {
        "repo": "mkpoli/ainu-morpheme-tagger",
        "title": "Ainu Morpheme Tagger",
        "description": "Morphological tagger; ships an Ainu lemma-lookup table.",
        "format": "lookup",
    },
    {
        "repo": "mkpoli/mediawiki-ainu-i18n",
        "title": "MediaWiki Ainu i18n",
        "description": "Ainu translations of MediaWiki core, skins and extensions.",
        "format": "mediawiki",
    },
    {
        "repo": "aynumosir/tunci",
        "title": "Tunci",
        "description": "Ainu⇄Japanese translation web app.",
        "format": "next-intl",
    },
    {
        "repo": "aynumosir/kampisos",
        "title": "Kampisos",
        "description": "Ainu/Japanese parallel-corpus search.",
        "format": "next-intl",
    },
    {
        "repo": "aynumosir/mosem",
        "title": "Mosem (aynu.io)",
        "description": "Ainu-language portal (aynu.io).",
        "format": "next-intl",
    },
]

# A localized message file: ain.json, ain-Latn.json, ain-Kana.json, … (a BCP-47
# tag whose primary subtag is `ain`). Matched against the file basename.
_AIN_FILE = re.compile(r"^ain(-[A-Za-z][A-Za-z0-9]*)*\.json$")

# Source-language candidates per format, tried in order; the first file that
# exists in the same directory as the Ainu file supplies the originals. Ainu
# tags are filtered out so a file never sources itself.
_SOURCE_CANDIDATES: dict[str, list[str]] = {
    "inlang": ["en"],          # plus the inlang settings sourceLanguageTag (prepended)
    "next-intl": ["en", "ja"],
    "mediawiki": ["en"],
    "lookup": [],
}

_TIMEOUT = 20


def _headers() -> dict[str, str]:
    h = {"User-Agent": "ainu-mcp-etl", "Accept": "application/vnd.github+json"}
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if tok:
        h["Authorization"] = f"Bearer {tok}"
    return h


@cache
def _get(url: str) -> str | None:
    """GET a URL, returning the body text or None on any network/HTTP failure."""
    req = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            return resp.read().decode("utf-8")
    except OSError:
        return None


@cache
def _default_branch(repo: str) -> str | None:
    raw = _get(f"https://api.github.com/repos/{repo}")
    if not raw:
        return None
    try:
        return json.loads(raw).get("default_branch")
    except ValueError:
        return None


@cache
def _tree(repo: str, branch: str) -> tuple[str, ...]:
    """All blob paths in `repo`@`branch` (recursive)."""
    raw = _get(f"https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=1")
    if not raw:
        return ()
    try:
        data = json.loads(raw)
    except ValueError:
        return ()
    # GitHub truncates very large trees; a partial listing would silently drop
    # some ain*.json files. Treat truncation like an unreachable repo (skip it
    # entirely) rather than ingesting an incomplete set. None of the curated
    # repos are anywhere near the limit, so this is a safety net.
    if data.get("truncated"):
        return ()
    return tuple(
        e["path"]
        for e in data.get("tree", [])
        if e.get("type") == "blob" and "path" in e
    )


def _raw(repo: str, branch: str, path: str) -> str | None:
    quoted = urllib.parse.quote(path, safe="/")
    return _get(f"https://raw.githubusercontent.com/{repo}/{branch}/{quoted}")


def _flatten(obj: Any, prefix: str = "") -> list[tuple[str, str]]:
    """Flatten a nested message object to (dot-path key, string) leaves. Skips
    keys starting with '@' (MediaWiki @metadata) or '$' (inlang $schema), and
    ignores non-string / empty leaves."""
    out: list[tuple[str, str]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if not isinstance(k, str) or k.startswith("@") or k.startswith("$"):
                continue
            key = f"{prefix}.{k}" if prefix else k
            out.extend(_flatten(v, key))
    elif isinstance(obj, str) and obj != "" and prefix:
        out.append((prefix, obj))
    return out


def _source_candidates(repo: str, branch: str, fmt: str) -> list[str]:
    cands = list(_SOURCE_CANDIDATES.get(fmt, ["en"]))
    if fmt == "inlang":
        settings = _get(
            f"https://raw.githubusercontent.com/{repo}/{branch}/project.inlang/settings.json"
        )
        if settings:
            try:
                s = json.loads(settings)
                src = s.get("sourceLanguageTag") or s.get("baseLocale")
                if isinstance(src, str) and src:
                    cands.insert(0, src)
            except ValueError:
                pass
    # De-dupe (preserve order) and never source an Ainu file from another Ainu file.
    seen: set[str] = set()
    out: list[str] = []
    for c in cands:
        if c in seen or c.startswith("ain"):
            continue
        seen.add(c)
        out.append(c)
    return out


def _resolve_source(
    repo: str, branch: str, directory: str, candidates: list[str]
) -> tuple[str | None, dict[str, str]]:
    """Find the source-language catalogue sitting next to an Ainu file and return
    (source_lang, {key: original}). Empty mapping if none is available."""
    for cand in candidates:
        path = f"{directory}/{cand}.json" if directory else f"{cand}.json"
        raw = _raw(repo, branch, path)
        if raw is None:
            continue
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        return cand, dict(_flatten(data))
    return None, {}


@cache
def load() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (projects, strings).

    projects: one row per curated repo (always all of them, with a `strings`
              count — 0 if the repo was unreachable).
    strings:  one row per gathered message.
    """
    projects: list[dict[str, Any]] = []
    strings: list[dict[str, Any]] = []

    for proj in PROJECTS:
        repo = proj["repo"]
        fmt = proj["format"]
        gathered = 0
        project_source_lang: str | None = None

        branch = _default_branch(repo)
        if branch:
            ain_files = [
                p
                for p in _tree(repo, branch)
                if _AIN_FILE.match(p.rsplit("/", 1)[-1])
                and "/node_modules/" not in f"/{p}"
            ]
            candidates = _source_candidates(repo, branch, fmt)
            source_cache: dict[str, tuple[str | None, dict[str, str]]] = {}

            for path in sorted(ain_files):
                raw = _raw(repo, branch, path)
                if raw is None:
                    continue
                try:
                    data = json.loads(raw)
                except ValueError:
                    continue
                base = path.rsplit("/", 1)[-1]
                lang = base[: -len(".json")]
                directory = path.rsplit("/", 1)[0] if "/" in path else ""

                if directory not in source_cache:
                    source_cache[directory] = _resolve_source(
                        repo, branch, directory, candidates
                    )
                source_lang, source_map = source_cache[directory]

                for key, text in _flatten(data):
                    src_text = source_map.get(key)
                    strings.append(
                        {
                            "project": repo,
                            "repo": repo,
                            "file_path": path,
                            "lang": lang,
                            "key": key,
                            "text": text,
                            "source_text": src_text,
                            "source_lang": source_lang if src_text is not None else None,
                        }
                    )
                    gathered += 1
                    if project_source_lang is None and source_lang:
                        project_source_lang = source_lang

        projects.append(
            {
                "slug": repo,
                "repo": repo,
                "title": proj.get("title"),
                "description": proj.get("description"),
                "url": f"https://github.com/{repo}",
                "format": fmt,
                "source_lang": project_source_lang,
                "strings": gathered,
            }
        )

    return projects, strings
