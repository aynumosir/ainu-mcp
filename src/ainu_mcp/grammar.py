"""Grammar bibliography + searchable/reference plain-text grammar sources.

The historical ``ainu-grammar`` repo holds PDFs of grammar books and articles,
plus selectively transcribed plaintext/markdown sources. Two newer, project-
authored grammar sites also live beside this repo and should be freely readable
by AI assistants for Ainu correction/help:

- ``ainu-grammar-hokkaido`` — Hokkaido Ainu reference grammar (Svelte chapters).
- ``aynu-itah`` — Sakhalin Ainu reference grammar (Svelte chapters).

We expose:

- ``list_materials()`` — list bibliography/searchable materials.
- ``search_materials(query)`` — substring search over filenames/metadata and
  full text.
- ``get_plain_text(path)`` — retrieve a whole plain-text source by path.
"""

from __future__ import annotations

import json
import logging
import re
from functools import cache
from html import unescape
from pathlib import Path
from typing import Any

from .config import get_config

_DATA_DIR = Path(__file__).resolve().parent / "data"
_AUTHORED_GRAMMAR_SNAPSHOT = _DATA_DIR / "authored_grammar_texts.json"
_FILENAME_RE = re.compile(r"^(?P<year>\d{4})_(?P<author>[^_]+)_(?P<title>.+)\.(pdf|epub|md|txt)$")
_TEXT_SUFFIXES = {".md", ".txt"}
_MATERIAL_SUFFIXES = {".pdf", ".epub", ".md", ".txt"}

logger = logging.getLogger(__name__)
_WRITTEN_GRAMMAR_SITES = {
    "hokkaido": {
        "repo": "ainu-grammar-hokkaido",
        "kind": "hokkaido_grammar",
        "title": "A Grammar of Hokkaido Ainu",
        "variant": "Hokkaido Ainu",
    },
    "sakhalin": {
        "repo": "aynu-itah",
        "kind": "sakhalin_grammar",
        "title": "A Grammar of Sakhalin Ainu",
        "variant": "Sakhalin Ainu",
    },
}


def _under_ocr_workdir(rel: Path) -> bool:
    """Whether a path lives inside a raw OCR working dir (``<paper>.ocr/``). Those
    are gitignored, noisy per-page intermediates (page images + per-page text)
    that must NOT be indexed. The consolidated, committed OCR text lives in
    ``articles/ocr/`` — a dir literally named ``ocr``, not ``*.ocr`` — which is
    kept. Skipping these keeps a local build's output identical to a fresh
    clone's (what the refresh pipeline seeds from)."""
    return any(part.endswith(".ocr") for part in rel.parts)


def _public_grammar_roots() -> list[tuple[str, Path]]:
    """Return authored public grammar sites adjacent to ``ainu-mcp``.

    These repos are written by the project, not copyrighted third-party grammar
    scans, so the MCP surface indexes their complete plain text and lets clients
    retrieve it with ``grammar_get_text`` / ``get_plain_text``.
    """
    root = get_config().ainu_root
    out: list[tuple[str, Path]] = []
    for source, spec in _WRITTEN_GRAMMAR_SITES.items():
        p = root / str(spec["repo"])
        if p.exists():
            out.append((source, p))
    return out


def _attr(tag: str, name: str) -> str:
    m = re.search(rf"\b{re.escape(name)}=([\"'])(.*?)\1", tag, flags=re.S)
    return unescape(m.group(2)) if m else ""


def _strip_svelte_to_text(raw: str) -> str:
    """Collapse a grammar chapter Svelte component to readable plain text.

    This mirrors the grammar-site search-index generators, but stays dependency-
    free for the Python ETL. It keeps text hidden in the custom grammar component
    attributes (section titles, examples, word/gloss pairs, references) before
    stripping tags.
    """
    body = re.sub(r"<script[\s\S]*?</script>", " ", raw, flags=re.I)

    # Section headings: <S t="…" id="…">.
    body = re.sub(r"<S\b[^>]*>", lambda m: f"\n\n{_attr(m.group(0), 't')}\n", body)

    # Interlinear examples: keep Ainu, gloss, translation, note, source metadata.
    def ex_repl(m: re.Match[str]) -> str:
        tag = m.group(0)
        fields = [
            _attr(tag, a)
            for a in ("m", "g", "ain", "orig", "surface", "tr", "lit", "note", "cite", "dial", "place")
        ]
        return "\n" + " | ".join(f for f in fields if f) + "\n"

    body = re.sub(r"<Ex\b[\s\S]*?/?>", ex_repl, body)

    # Dictionary-token helper: <A w="ru" gl="track, path" />.
    body = re.sub(
        r"<A\b[^>]*?/?>",
        lambda m: " " + " ".join(f for f in (_attr(m.group(0), "w"), _attr(m.group(0), "gl")) if f) + " ",
        body,
    )

    # Cross-reference/ref helpers: keep their labels/keys/pages where available.
    body = re.sub(
        r"<Xr\b[^>]*>",
        lambda m: " " + " ".join(f for f in (_attr(m.group(0), "ch"), _attr(m.group(0), "s")) if f) + " ",
        body,
    )
    body = re.sub(
        r"<Ref\b[^>]*?/?>",
        lambda m: " " + " ".join(f for f in (_attr(m.group(0), "k"), _attr(m.group(0), "p")) if f) + " ",
        body,
    )

    # Add line breaks around structural tags before dropping markup.
    body = re.sub(r"</?(p|div|section|article|tr|table|thead|tbody|caption|ul|ol|li|h[1-6])\b[^>]*>", "\n", body, flags=re.I)
    body = re.sub(r"<br\s*/?>", "\n", body, flags=re.I)
    body = re.sub(r"<[^>]+>", " ", body)
    body = unescape(body)

    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in body.splitlines()]
    out: list[str] = []
    blank = False
    for line in lines:
        if line:
            out.append(line)
            blank = False
        elif not blank and out:
            out.append("")
            blank = True
    return "\n".join(out).strip()


def _ts_string_attr(obj: str, name: str) -> str:
    m = re.search(rf"\b{re.escape(name)}\s*:\s*(['\"])(.*?)\1", obj, flags=re.S)
    return m.group(2) if m else ""


@cache
def _site_toc(source: str) -> dict[str, dict[str, Any]]:
    """Best-effort slug → title/summary/part/number metadata from a site's toc.ts."""
    specs = _WRITTEN_GRAMMAR_SITES.get(source)
    if not specs:
        return {}
    toc = get_config().ainu_root / str(specs["repo"]) / "src" / "lib" / "grammar" / "toc.ts"
    if not toc.exists():
        return {}
    try:
        raw = toc.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}

    out: dict[str, dict[str, Any]] = {}
    num = 0
    # Good enough for the generated/literal TOC files in both grammar sites:
    # split on part blocks (objects that contain a `chapters: [...]` array), then
    # inspect the chapter objects inside each block. This avoids mistaking a
    # chapter's own `title:` property for the enclosing part title.
    part_re = re.compile(
        r"\{\s*title\s*:\s*(['\"])(?P<part>.*?)\1\s*,\s*chapters\s*:\s*\[(?P<body>[\s\S]*?)\]\s*\}",
        flags=re.S,
    )
    chap_re = re.compile(r"\{\s*slug\s*:\s*(['\"])(?P<slug>.*?)\1(?P<body>[\s\S]*?)\n\s*\}", flags=re.S)
    for part_m in part_re.finditer(raw):
        part = part_m.group("part")
        for chap_m in chap_re.finditer(part_m.group("body")):
            slug = chap_m.group("slug")
            obj = chap_m.group("body") or ""
            if not slug:
                continue
            num += 1
            title = _ts_string_attr(obj, "title") or slug.replace("-", " ").title()
            summary = _ts_string_attr(obj, "summary")
            out[slug] = {"num": num, "title": title, "summary": summary, "part": part}
    return out


def _plain_text_path(source: str, rel: str | Path) -> str:
    return f"{source}/{Path(rel).as_posix()}"


@cache
def _written_plain_texts() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for source, root in _public_grammar_roots():
        spec = _WRITTEN_GRAMMAR_SITES[source]
        toc = _site_toc(source)
        chapters = root / "src" / "lib" / "grammar" / "chapters"
        if not chapters.exists():
            continue
        for p in sorted(chapters.glob("*.svelte")):
            slug = p.stem
            meta = toc.get(slug, {})
            try:
                raw = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            title = str(meta.get("title") or slug.replace("-", " ").title())
            summary = str(meta.get("summary") or "")
            part = str(meta.get("part") or spec["title"])
            header = [
                str(spec["title"]),
                f"Variant: {spec['variant']}",
                f"Chapter: {title}",
            ]
            if part:
                header.append(f"Part: {part}")
            if summary:
                header.append(f"Summary: {summary}")
            text = "\n".join(header) + "\n\n" + _strip_svelte_to_text(raw)
            rel = Path("src/lib/grammar/chapters") / p.name
            out.append(
                {
                    "source": source,
                    "kind": spec["kind"],
                    "path": _plain_text_path(source, rel),
                    "repo_path": str(rel),
                    "filename": p.name,
                    "slug": slug,
                    "title": title,
                    "summary": summary,
                    "part": part,
                    "variant": spec["variant"],
                    "text": text,
                    "license": "project-authored public plain text",
                }
            )
    if out:
        return out

    # CI/prod refresh may not have credentials to clone every authored grammar
    # repo. Fall back to the committed snapshot so the public plain-text grammar
    # surface remains deployable/reseedable from this repo alone.
    try:
        return json.loads(_AUTHORED_GRAMMAR_SNAPSHOT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []


def _material_meta(kind: str, rel: str, filename: str) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "source": "ainu-grammar",
        "kind": kind,
        "path": rel,
        "filename": filename,
    }
    m = _FILENAME_RE.match(filename)
    if m:
        meta["year"] = int(m["year"])
        meta["author"] = m["author"]
        meta["title"] = m["title"]
    return meta


def _manifest_materials(root: Path) -> list[dict[str, Any]]:
    """Bibliography rows for scans held in the archive (R2), not in git.

    The PDF/EPUB scans were moved out of the repo into the ``aynumosir-archive``
    bucket; ``archive-manifest.jsonl`` (one JSON object per file: path, role,
    sha256, bytes, pages, …) is what a checkout carries in their place, so the
    bibliography walk reads it instead of expecting the binaries on disk.
    """
    out: list[dict[str, Any]] = []
    manifest = root / "archive-manifest.jsonl"
    try:
        lines = manifest.read_text(encoding="utf-8")
    except OSError:
        if root.exists():
            logger.warning(
                "grammar: %s is missing or unreadable — archived scans will be absent from the bibliography",
                manifest,
            )
        return out
    bad = 0
    for line in lines.splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            bad += 1
            continue
        if not isinstance(entry, dict):
            bad += 1
            continue
        rel = str(entry.get("path") or "")
        kind = rel.split("/", 1)[0]
        if kind not in ("books", "articles"):
            continue
        filename = rel.rsplit("/", 1)[-1]
        if "." not in filename:
            continue
        if f".{filename.rsplit('.', 1)[-1].lower()}" not in _MATERIAL_SUFFIXES:
            continue
        meta = _material_meta(kind, rel, filename)
        pages = entry.get("pages")
        if pages:
            meta["pages"] = pages
        out.append(meta)
    if bad:
        logger.warning("grammar: %d unparseable line(s) skipped in %s", bad, manifest)
    return out


@cache
def _walk_materials() -> list[dict[str, Any]]:
    root = get_config().grammar_dir
    out: list[dict[str, Any]] = []
    disk_by_path: dict[str, dict[str, Any]] = {}
    if root.exists():
        for kind in ("books", "articles"):
            base = root / kind
            if not base.exists():
                continue
            for p in base.rglob("*"):
                if not p.is_file():
                    continue
                if p.suffix.lower() not in _MATERIAL_SUFFIXES:
                    continue
                rel = p.relative_to(root)
                if _under_ocr_workdir(rel):
                    continue
                meta = _material_meta(kind, str(rel), p.name)
                disk_by_path[str(rel)] = meta
                out.append(meta)
        for meta in _manifest_materials(root):
            on_disk = disk_by_path.get(meta["path"])
            if on_disk is None:
                out.append(meta)
            elif "pages" in meta and "pages" not in on_disk:
                # A checkout can hold both the binary and the manifest row —
                # the manifest's page count still belongs on the entry.
                on_disk["pages"] = meta["pages"]

    # Project-authored grammar chapters: expose their complete plain text. They
    # are not third-party PDFs/transcriptions, so include enough metadata for AI
    # clients to find and retrieve whole chapters.
    for t in _written_plain_texts():
        meta = {k: v for k, v in t.items() if k != "text"}
        meta["plain_text_available"] = True
        out.append(meta)
    return out


def list_materials(kind: str | None = None) -> list[dict[str, Any]]:
    mats = _walk_materials()
    if kind:
        mats = [m for m in mats if m["kind"] == kind]
    return mats


def _scan_transcribed(q: str, limit: int) -> list[dict[str, Any]]:
    """Search inside any transcribed markdown/text files and authored grammars."""
    root = get_config().grammar_dir
    hits: list[dict[str, Any]] = []

    # Prefer project-authored grammars: they are the freely reusable texts a
    # correction assistant can read in full. Legacy third-party OCR remains
    # searchable below, but can otherwise swamp low-limit queries.
    for doc in _written_plain_texts():
        hit = _text_hit(str(doc["path"]), str(doc["text"]), q)
        if hit:
            hit.update(
                {
                    "source": doc["source"],
                    "kind": doc["kind"],
                    "title": doc["title"],
                    "variant": doc["variant"],
                    "plain_text_available": True,
                }
            )
            hits.append(hit)
            if len(hits) >= limit:
                return hits

    if root.exists():
        for p in root.rglob("*"):
            if not p.is_file() or p.suffix.lower() not in _TEXT_SUFFIXES:
                continue
            if _under_ocr_workdir(p.relative_to(root)):
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            hit = _text_hit(str(p.relative_to(root)), text, q)
            if hit:
                hits.append(hit)
                if len(hits) >= limit:
                    return hits
    return hits


def _text_hit(path: str, text: str, q: str) -> dict[str, Any] | None:
    lower = text.lower()
    if q not in lower:
        return None
    snippets: list[str] = []
    start = 0
    while len(snippets) < 3:
        i = lower.find(q, start)
        if i < 0:
            break
        s = max(0, i - 80)
        e = min(len(text), i + len(q) + 80)
        snippets.append(text[s:e].replace("\n", " ").strip())
        start = i + len(q)
    return {"path": path, "snippets": snippets}


def search_materials(
    query: str,
    *,
    include_transcribed: bool = True,
    limit: int = 30,
) -> dict[str, Any]:
    q = query.lower().strip()
    if not q:
        return {"filename_hits": [], "transcribed_hits": []}
    name_hits = [
        m
        for m in _walk_materials()
        if q in m["filename"].lower()
        or q in (m.get("title", "").lower())
        or q in (m.get("author", "").lower())
        or q in (m.get("summary", "").lower())
        or q in (m.get("variant", "").lower())
        or q in (m.get("part", "").lower())
    ][:limit]
    transcribed_hits = _scan_transcribed(q, limit) if include_transcribed else []
    return {"filename_hits": name_hits, "transcribed_hits": transcribed_hits}


def get_plain_text(path: str) -> dict[str, Any] | None:
    """Return complete text for a project-authored public grammar chapter.

    ``path`` is the ``path`` returned by ``grammar_list`` or ``grammar_search``.
    Only the project-authored Hokkaido/Sakhalin grammar chapters are exposed as
    full text here. Third-party ``ainu-grammar`` OCR/transcriptions remain
    snippet-searchable only.
    """
    key = path.strip().lstrip("/")
    if not key:
        return None

    for doc in _written_plain_texts():
        if key == doc["path"] or key == doc["repo_path"]:
            return {**doc, "text": doc["text"]}
    return None
