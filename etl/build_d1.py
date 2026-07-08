"""Build the reference-data seed for the hosted Ainu MCP Worker (loaded into Turso).

This is the ETL that bridges the Python toolchain and the TypeScript Worker. It
*reuses the existing `ainu_mcp` loaders* — which already encode every dictionary
quirk (column aliases, preferred files, Ota-reversed, Nakagawa `latn`→`lemma`,
etc.) — so the hosted server reads byte-identical data without re-implementing
any of that logic in TS.

Output: chunked `*.sql` files under `worker/seed/` containing INSERTs that match
`worker/migrations/0001_init.sql` + later migrations.
The reference store is Turso (libSQL); apply the schema then load the seed via the
batched libSQL loader (see worker/README.md / docs/REFRESHING-DATA.md):

    cd worker
    turso db shell ainu-mcp < migrations/0001_init.sql
    turso db shell ainu-mcp < migrations/0002_frequency.sql
    turso db shell ainu-mcp < migrations/0003_localizations.sql
    turso db shell ainu-mcp < migrations/0004_grammar_public_text.sql
    TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \\
      bun scripts/load-turso.mjs seed/reset.sql $(... seed/MANIFEST.txt ...)

(The filename `build_d1.py` is a historical name — it builds the seed for Turso
(libSQL) now, not Cloudflare D1. Kept as-is to avoid churning the ~dozen doc and
workflow path references; the script is invoked directly, never imported.)

Run from the repo root:

    AINU_ROOT=/home/mkpoli/projects/Ainu uv run python etl/build_d1.py

Everything the runtime needs to be cheap is PRECOMPUTED here: corpus stats,
dictionary counts, and the vocabulary-gap candidate list.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from ainu_mcp import corpus, dictionaries, gaps, grammar, localizations, stopwords
from ainu_mcp.config import get_config

SEED_DIR = Path(__file__).resolve().parent.parent / "worker" / "seed"
DATA_DIR = SEED_DIR / "data"

# Rows per multi-row INSERT statement (upper bound for small rows).
BATCH = 200
# Max bytes per INSERT statement. Originally D1's 100 KB single-statement cap;
# retained as a conservative bound so the batched libSQL loader (load-turso.mjs,
# 50 statements per transaction) keeps each request well within libSQL's limits.
MAX_STMT_BYTES = 90_000
# Max UTF-8 BYTES per text chunk (rows / append-updates). Must be by bytes, not
# chars: the per-statement bound above is in bytes, and CJK text is ~3 bytes/char.
# 35 KB leaves headroom for quote-escaping + the INSERT/UPDATE prefix.
TEXT_CHUNK = 35_000
GRAMMAR_OVERLAP = 200  # overlap (chars) between grammar chunks to avoid boundary misses
# Rows per chunk file: bounds each seed file's size so the loader's readFileSync
# + per-file batching stay memory-bounded and give progress/restart granularity.
CHUNK_ROWS = 50_000
# Vocabulary-gap candidates are stored down to this corpus frequency so the
# runtime tool can honor a `min_count` as low as this without a corpus scan.
VOCAB_MIN_COUNT = 5

# Short dictionary names reported by glossary_missing_high_frequency (mirrors
# ainu_mcp.gaps.dict_short).
DICT_SHORT = {
    "1996_Kayano_Kayanos-Ainu-Dictionary": "Kayano",
    "1996_Tamura_Ainu-Saru-Dialect-Dictionary": "Tamura",
    "1987_Chiri_Categorized-Ainu-Dictionary": "Chiri",
    "1995_Nakagawa_Ainu-Chitose-Dialect-Dictionary": "Nakagawa",
    "2022_Ota_Japanese-Ainu_Dictionary": "Ota",
}


def chunk_text(s: str, max_bytes: int = TEXT_CHUNK, overlap_chars: int = 0) -> list[str]:
    """Split a string into pieces whose UTF-8 size is <= max_bytes, without
    splitting a multibyte character. Optionally overlap consecutive pieces by
    overlap_chars (to avoid losing matches that straddle a boundary)."""
    if len(s.encode("utf-8")) <= max_bytes:
        return [s]
    out: list[str] = []
    n = len(s)
    i = 0
    while i < n:
        j, b = i, 0
        while j < n:
            cb = len(s[j].encode("utf-8"))
            if b + cb > max_bytes:
                break
            b += cb
            j += 1
        if j == i:
            j = i + 1  # guarantee forward progress
        out.append(s[i:j])
        if j >= n:
            break
        i = max(i + 1, j - overlap_chars) if overlap_chars else j
    return out


def append_updates(table: str, id_val: int, col: str, text: str) -> list[str]:
    """UPDATE statements that append `text` to `table.col` in <=TEXT_CHUNK pieces
    (keyed by id). Lets us store a value larger than the per-statement byte bound."""
    return [
        f"UPDATE {table} SET {col} = {col} || {q(piece)} WHERE id = {id_val};"
        for piece in chunk_text(text, TEXT_CHUNK)
    ]


def q(v: Any) -> str:
    """Render a Python value as a SQL literal (single-quote escaped)."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    # Strip NUL — SQLite text literals cannot contain U+0000.
    return "'" + str(v).replace("\x00", "").replace("'", "''") + "'"


class ChunkWriter:
    """Accumulates multi-row INSERTs and rolls over to a new file every
    CHUNK_ROWS rows. Produces files like data/corpus_0001.sql."""

    def __init__(self, name: str, columns_clause: str):
        self.name = name
        self.columns_clause = columns_clause  # e.g. "corpus_fts(text, translation, ...)"
        self.file_index = 0
        self.rows_in_file = 0
        self.buffer: list[str] = []
        self.buffer_bytes = 0
        self.fh = None
        self.files: list[str] = []
        self._open_new()

    def _open_new(self) -> None:
        self._flush_buffer()
        if self.fh:
            self.fh.close()
        self.file_index += 1
        fname = f"{self.name}_{self.file_index:04d}.sql"
        self.files.append(fname)
        self.fh = (DATA_DIR / fname).open("w", encoding="utf-8")
        self.fh.write(f"-- {self.name} chunk {self.file_index}\n")
        self.rows_in_file = 0

    def _flush_buffer(self) -> None:
        if not self.buffer or not self.fh:
            return
        self.fh.write(
            f"INSERT INTO {self.columns_clause} VALUES\n"
            + ",\n".join(self.buffer)
            + ";\n"
        )
        self.buffer = []
        self.buffer_bytes = 0

    def add(self, values: Iterable[Any]) -> None:
        row_sql = "(" + ", ".join(q(v) for v in values) + ")"
        rb = len(row_sql.encode("utf-8")) + 2
        # Flush BEFORE appending if this row would push the statement over the
        # limit — guarantees each statement stays <= MAX_STMT_BYTES (assuming a
        # single row fits; oversized rows go through write_raw instead).
        if self.buffer and self.buffer_bytes + rb > MAX_STMT_BYTES:
            self._flush_buffer()
        self.buffer.append(row_sql)
        self.buffer_bytes += rb
        self.rows_in_file += 1
        if len(self.buffer) >= BATCH:
            self._flush_buffer()
        if self.rows_in_file >= CHUNK_ROWS:
            self._open_new()

    def write_raw(self, statements: list[str]) -> None:
        """Emit pre-built statements (each must be <= MAX_STMT_BYTES). Used for
        rows too large for a single INSERT — split into INSERT + UPDATE-append."""
        self._flush_buffer()
        if self.fh:
            for s in statements:
                self.fh.write(s + "\n")
        self.rows_in_file += 1
        if self.rows_in_file >= CHUNK_ROWS:
            self._open_new()

    def close(self) -> int:
        self._flush_buffer()
        if self.fh:
            self.fh.close()
            self.fh = None
        return self.file_index


def build_corpus() -> tuple[list[str], dict[str, Any]]:
    print("corpus: loading…")
    rows = corpus._load()
    w = ChunkWriter(
        "corpus",
        "corpus_fts(text, translation, id, dialect, author, collection, document, uri)",
    )
    dialects: dict[str, int] = {}
    for r in rows:
        w.add(
            [
                r.get("text"),
                r.get("translation"),
                r.get("id"),
                r.get("dialect"),
                r.get("author"),
                r.get("collection_lv1"),
                r.get("document"),
                r.get("uri"),
            ]
        )
        d = r.get("dialect") or "(unknown)"
        dialects[d] = dialects.get(d, 0) + 1
    n = w.close()
    top_dialects = dict(sorted(dialects.items(), key=lambda kv: -kv[1])[:10])
    stats = {"sentences": len(rows), "top_dialects": top_dialects}
    print(f"corpus: {len(rows)} rows → {n} file(s)")
    return w.files, stats


def build_dictionaries() -> tuple[list[str], dict[str, int]]:
    print("dictionaries: loading…")
    names = dictionaries._list_dicts()
    cols = "dict_entries(id, dictionary, source_file, lemma, lemma_lower, definition, fields_json, field_order, all_text_lower)"
    entries_w = ChunkWriter("dict_entries", cols)
    counts: dict[str, int] = {}
    next_id = 1
    for name in names:
        entries = dictionaries._load_dict(name)
        counts[name] = len(entries)
        for e in entries:
            fields = {k: v for k, v in e.items() if k != "_file"}
            lemma = e.get("lemma")
            all_text = " ".join(
                str(v).lower()
                for k, v in fields.items()
                if isinstance(v, str) and v
            )
            fields_json = json.dumps(fields, ensure_ascii=False)
            # Preserve original key order — JS Object.keys() reorders integer-like
            # keys, which would corrupt `matched_in` for dicts with numeric headers.
            field_order = json.dumps(list(fields.keys()), ensure_ascii=False)
            lemma_lower = (lemma or "").strip().lower() if isinstance(lemma, str) else None
            row = [next_id, name, e.get("_file"), lemma, lemma_lower, e.get("definition", ""), fields_json, field_order, all_text]

            # If the row would exceed the per-statement cap (rare — a few
            # dictionaries have giant concatenated fields), insert it with the
            # two large columns empty, then append them in chunks (lossless).
            approx = sum(len(q(v).encode("utf-8")) for v in row) + 32
            if approx > MAX_STMT_BYTES:
                base = [next_id, name, e.get("_file"), lemma, lemma_lower, e.get("definition", ""), "", field_order, ""]
                stmts = [f"INSERT INTO {cols} VALUES (" + ", ".join(q(v) for v in base) + ");"]
                stmts += append_updates("dict_entries", next_id, "fields_json", fields_json)
                stmts += append_updates("dict_entries", next_id, "all_text_lower", all_text)
                entries_w.write_raw(stmts)
            else:
                entries_w.add(row)
            next_id += 1
    files = entries_w.files[:]
    entries_w.close()

    # Rebuild the external-content FTS index from dict_entries, CHUNKED by id
    # range: a single INSERT...SELECT would rebuild ~284k FTS rows in one
    # transaction. Chunking keeps each libSQL transaction bounded. Each chunk's
    # statement text is tiny (it's a SELECT, not literals), so the per-statement
    # byte bound doesn't apply here — only the row volume does.
    max_id = next_id - 1
    fts_files: list[str] = []
    fi = 0
    for start in range(1, max_id + 1, CHUNK_ROWS):
        fi += 1
        end = min(start + CHUNK_ROWS - 1, max_id)
        fname = f"dict_fts_{fi:04d}.sql"
        (DATA_DIR / fname).write_text(
            f"-- rebuild external-content FTS5 index for dict_entries id {start}..{end}\n"
            "INSERT INTO dict_fts(rowid, lemma, all_text_lower) "
            f"SELECT id, lemma, all_text_lower FROM dict_entries WHERE id BETWEEN {start} AND {end};\n",
            encoding="utf-8",
        )
        fts_files.append(fname)
    files.extend(fts_files)

    # dictionaries(name, entries)
    dict_list_path = DATA_DIR / "dictionaries_list.sql"
    with dict_list_path.open("w", encoding="utf-8") as f:
        for name, cnt in counts.items():
            f.write(f"INSERT INTO dictionaries(name, entries) VALUES ({q(name)}, {cnt});\n")
    files.append("dictionaries_list.sql")

    print(f"dictionaries: {next_id - 1} entries across {len(names)} dicts")
    return files, counts


def build_grammar() -> list[str]:
    print("grammar: walking…")
    cfg = get_config()
    root = cfg.grammar_dir
    files: list[str] = []

    # Bibliography metadata (books + articles, pdf/md/txt) plus project-authored
    # Hokkaido/Sakhalin grammar chapters whose complete plain text is public.
    mats = grammar._walk_materials()
    mw = ChunkWriter(
        "grammar_materials",
        "grammar_materials(source, kind, path, filename, year, author, title, summary, part, variant, license, plain_text_available)",
    )
    for m in mats:
        mw.add(
            [
                m.get("source") or "ainu-grammar",
                m.get("kind"),
                m.get("path"),
                m.get("filename"),
                m.get("year"),
                m.get("author"),
                m.get("title"),
                m.get("summary"),
                m.get("part"),
                m.get("variant"),
                m.get("license"),
                1 if m.get("plain_text_available") else 0,
            ]
        )
    files.extend(mw.files)
    mw.close()

    # Fulltext: every md/txt under the legacy grammar root (snippet search only)
    # plus the project-authored Hokkaido/Sakhalin grammar chapters (snippet search
    # AND full-chapter retrieval via grammar_get_text). Files larger than the
    # statement cap are split into overlapping chunks (multiple rows, same path);
    # grammar.ts regroups hits by path. Project-authored chapters are kept as
    # single rows when possible so grammar_get_text can return the complete text.
    gw = ChunkWriter(
        "grammar_fts",
        "grammar_fts(content, path, source, kind, title, summary, part, variant, license, plain_text_available, repo_path)",
    )
    count = 0
    # Add authored grammars first so low-limit grammar_search calls surface the
    # freely-readable correction-oriented sources before legacy OCR snippets.
    authored = 0
    for doc in grammar._written_plain_texts():
        text = doc["text"]
        chunks = chunk_text(text, TEXT_CHUNK, 0)
        # The current chapters fit under TEXT_CHUNK; if that changes, the chunks
        # share the same path and grammar_get_text reassembles them in row order.
        for chunk in chunks:
            gw.add(
                [
                    chunk,
                    doc.get("path"),
                    doc.get("source"),
                    doc.get("kind"),
                    doc.get("title"),
                    doc.get("summary"),
                    doc.get("part"),
                    doc.get("variant"),
                    doc.get("license"),
                    1,
                    doc.get("repo_path"),
                ]
            )
        authored += 1

    if root.exists():
        for p in sorted(root.rglob("*")):
            if not p.is_file() or p.suffix.lower() not in {".md", ".txt"}:
                continue
            if grammar._under_ocr_workdir(p.relative_to(root)):
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            rel = str(p.relative_to(root))
            for chunk in chunk_text(text, TEXT_CHUNK, GRAMMAR_OVERLAP):
                gw.add([chunk, rel, "ainu-grammar", None, None, None, None, None, None, 0, None])
            count += 1
    files.extend(gw.files)
    gw.close()
    print(f"grammar: {len(mats)} materials, {count} legacy transcribed files, {authored} authored grammar chapters")
    return files


def count_corpus_tokens() -> tuple[Counter[str], dict[str, tuple[str, str]]]:
    """Count every normalized Ainu token in the corpus in a single pass, keeping
    a first-occurrence sample (text + translation) per token. Stopwords and
    single characters are kept here — they're needed by token_freq for honest
    word-frequency lookups; the vocab-gap pass filters them out itself."""
    print("tokens: counting corpus tokens…")
    counter: Counter[str] = Counter()
    sample: dict[str, tuple[str, str]] = {}
    for row in corpus._load():
        text = row.get("text") or ""
        if not text:
            continue
        for tok in gaps._TOKEN.findall(text):
            n = gaps._normalize(tok)
            if not n:
                continue
            counter[n] += 1
            if n not in sample:
                sample[n] = (text[:120], (row.get("translation") or "")[:120])
    print(f"tokens: {len(counter)} distinct, {sum(counter.values())} occurrences")
    return counter, sample


def build_stopwords() -> tuple[list[str], set[str]]:
    """Seed the stopwords table from aynumosir/ainu-stopwords. Returns the seed
    files and the normalized stopword set (for token_freq's is_stopword flag)."""
    words = stopwords.all_stopwords()
    norm = set(stopwords.normalized_set())
    path = DATA_DIR / "stopwords.sql"
    with path.open("w", encoding="utf-8") as f:
        for w in words:
            f.write(
                f"INSERT INTO stopwords(word, normalized) VALUES ({q(w)}, {q(gaps._normalize(w))});\n"
            )
    print(f"stopwords: {len(words)} words ({len(norm)} normalized) from {stopwords.SOURCE}")
    return ["stopwords.sql"], norm


def build_token_freq(counter: Counter[str], stop_norm: set[str]) -> list[str]:
    """Seed token_freq with every token's count + stopword flag, emitted in
    descending-count order so `ORDER BY count DESC, rowid` reproduces
    Counter.most_common (ties broken by first appearance)."""
    w = ChunkWriter("token_freq", "token_freq(token, count, is_stopword)")
    for tok, cnt in counter.most_common():
        w.add([tok, cnt, 1 if tok in stop_norm else 0])
    n = w.close()
    print(f"token_freq: {len(counter)} tokens → {n} file(s)")
    return w.files


def build_vocab_candidates(
    counter: Counter[str], sample: dict[str, tuple[str, str]], stop_norm: set[str]
) -> list[str]:
    """Precompute glossary_missing_high_frequency's heavy part: dictionary-
    attested corpus tokens with their count + sample. The glossary subtraction
    happens at runtime (live Sheets), so it is NOT applied here. Drops the
    stopwords (aynumosir/ainu-stopwords) / single characters that token_freq
    keeps — they never make sense as glossary candidates (mirrors ainu_mcp.gaps)."""
    dict_idx = gaps._dict_lemma_index()
    path = DATA_DIR / "vocab_candidates.sql"
    written = 0
    with path.open("w", encoding="utf-8") as f:
        for tok, cnt in counter.most_common():
            if cnt < VOCAB_MIN_COUNT:
                break
            if tok in stop_norm or len(tok) <= 1:
                continue
            attested = [DICT_SHORT[d] for d in dict_idx if d in DICT_SHORT and tok in dict_idx[d]]
            if not attested:
                continue
            text, tr = sample.get(tok, ("", ""))
            f.write(
                "INSERT INTO vocab_candidates(token, count, attested_in, sample_text, sample_translation) VALUES ("
                f"{q(tok)}, {cnt}, {q(json.dumps(attested, ensure_ascii=False))}, {q(text)}, {q(tr)});\n"
            )
            written += 1
    print(f"vocab: {written} gap candidates (count >= {VOCAB_MIN_COUNT})")
    return ["vocab_candidates.sql"]


def build_meta(corpus_stats: dict[str, Any], counter: Counter[str]) -> list[str]:
    path = DATA_DIR / "meta.sql"
    rows = {
        "corpus_stats": json.dumps(corpus_stats, ensure_ascii=False),
        "vocab_min_count": str(VOCAB_MIN_COUNT),
        # Corpus-wide token totals, so corpus_word_frequency reports them without
        # scanning token_freq.
        "token_total_distinct": str(len(counter)),
        "token_total_occurrences": str(sum(counter.values())),
    }
    with path.open("w", encoding="utf-8") as f:
        for k, v in rows.items():
            f.write(f"INSERT INTO meta(key, value) VALUES ({q(k)}, {q(v)});\n")
    return ["meta.sql"]


def build_localizations() -> list[str]:
    """Seed l10n_fts + l10n_projects from real Ainu-language software i18n files
    (src/ainu_mcp/localizations.py). Fetched live from public GitHub at build
    time; degrades gracefully (an unreachable repo just contributes 0 strings)."""
    print("localizations: gathering…")
    projects, strings = localizations.load()
    files: list[str] = []

    # strings → l10n_fts (standalone FTS5, same shape as corpus_fts). rowid =
    # emission order, so ORDER BY rowid is stable.
    w = ChunkWriter(
        "l10n_strings",
        "l10n_fts(text, source_text, key, project, repo, file_path, lang, source_lang)",
    )
    for s in strings:
        w.add(
            [
                s["text"],
                s.get("source_text"),
                s["key"],
                s["project"],
                s["repo"],
                s["file_path"],
                s["lang"],
                s.get("source_lang"),
            ]
        )
    files.extend(w.files)
    w.close()

    # projects → l10n_projects (always all curated repos, with a string count).
    path = DATA_DIR / "l10n_projects.sql"
    with path.open("w", encoding="utf-8") as f:
        for p in projects:
            f.write(
                "INSERT INTO l10n_projects(slug, repo, title, description, url, format, source_lang, strings) VALUES ("
                f"{q(p['slug'])}, {q(p['repo'])}, {q(p.get('title'))}, {q(p.get('description'))}, "
                f"{q(p.get('url'))}, {q(p['format'])}, {q(p.get('source_lang'))}, {int(p.get('strings', 0))});\n"
            )
    files.append("l10n_projects.sql")

    gathered = sum(1 for _ in strings)
    live = sum(1 for p in projects if p.get("strings"))
    print(f"localizations: {gathered} strings across {live}/{len(projects)} reachable projects")
    return files


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[str] = []

    corpus_files, corpus_stats = build_corpus()
    dict_files, _ = build_dictionaries()
    grammar_files = build_grammar()
    counter, sample = count_corpus_tokens()
    stopword_files, stop_norm = build_stopwords()
    token_freq_files = build_token_freq(counter, stop_norm)
    vocab_files = build_vocab_candidates(counter, sample, stop_norm)
    meta_files = build_meta(corpus_stats, counter)
    l10n_files = build_localizations()

    # Apply order matters: dict_entries before dict_fts rebuild. token_freq /
    # stopwords / vocab / localizations are independent (no FKs), so their order
    # is free.
    manifest = (
        dict_files          # dict_entries_*, dict_fts, dictionaries_list
        + grammar_files
        + stopword_files
        + token_freq_files
        + vocab_files
        + meta_files
        + l10n_files
        + corpus_files      # largest; apply last / spread across days
    )
    (SEED_DIR / "MANIFEST.txt").write_text(
        "# Reference store is Turso (libSQL). Apply ALL migrations first\n"
        "# (turso db shell ainu-mcp < migrations/0001_init.sql, then 0002_frequency.sql,\n"
        "# then 0003_localizations.sql, then 0004_grammar_public_text.sql), then\n"
        "# load these files IN THIS ORDER via the batched libSQL loader — e.g.\n"
        "#   cd worker && TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... \\\n"
        "#     bun scripts/load-turso.mjs seed/reset.sql <files below>\n"
        "# dict_entries_* MUST all be loaded before the dict_fts_* rebuild.\n"
        "# (The loader parses only the filenames below, not the line text.)\n\n"
        + "\n".join(f"seed/data/{f}" for f in manifest)
        + "\n",
        encoding="utf-8",
    )
    print(f"\n✓ Seed built in {SEED_DIR}")
    print(f"  {len(manifest)} SQL files; see worker/seed/MANIFEST.txt for apply order.")


if __name__ == "__main__":
    main()
