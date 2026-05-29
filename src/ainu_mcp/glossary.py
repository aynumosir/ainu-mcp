"""Google Sheets read/write for the Itak-uoeroskip glossary.

The sheet has one `all_sheets` meta tab listing content tabs, plus one tab per
semantic category. Each content tab is a table whose first row is column headers
(commonly: `Aynu`, `日本語`, `English`, `中文`, `註 / Notes`).

Behavior:
- Reads are cached per process for `_READ_TTL` seconds — search/list calls
  across many categories no longer hammer the 60-reads/min Sheets quota.
- `search` uses a single batchGet to fetch every category in one API call.
- 429s are retried with exponential backoff.
- Writes invalidate the cache for the affected tab so the next read is fresh.
- Updates support optimistic locking via a row hash.
"""

from __future__ import annotations

import hashlib
import random
import time
from dataclasses import dataclass
from functools import cache
from typing import Any, Callable, TypeVar

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from .config import get_config

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
_READ_TTL = 60.0  # seconds — short enough to pick up external edits, long enough to absorb burst reads

T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class SheetMeta:
    is_content: bool
    sheet_name: str
    description: str
    count: int
    sheet_gid: int


@cache
def _sheets_service() -> Any:
    cfg = get_config()
    if cfg.google_credentials and cfg.google_credentials.exists():
        creds = service_account.Credentials.from_service_account_file(
            str(cfg.google_credentials), scopes=SCOPES
        )
    elif cfg.google_credentials_info:
        creds = service_account.Credentials.from_service_account_info(
            cfg.google_credentials_info, scopes=SCOPES
        )
    else:
        raise RuntimeError(
            "No Google credentials configured. Set GOOGLE_APPLICATION_CREDENTIALS "
            "to a service-account JSON path, or set the PRIVATE_GOOGLE_API_* env vars "
            "(compatible with the ainu-glossary site)."
        )
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def _row_hash(row: list[str]) -> str:
    """Stable 12-hex-char hash of a row's cell contents — used for optimistic locking."""
    joined = "".join(row)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:12]


def _col_letter(n: int) -> str:
    """1-indexed column number → spreadsheet letter (1→A, 27→AA)."""
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def _with_retry(fn: Callable[[], T], *, retries: int = 5) -> T:
    """Run `fn`, retrying on transient 429/5xx with exponential backoff + jitter."""
    delay = 1.0
    for attempt in range(retries):
        try:
            return fn()
        except HttpError as e:
            status = getattr(e.resp, "status", None)
            if status in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(delay + random.uniform(0, 0.5))
                delay *= 2
                continue
            raise


# ── TTL cache (process-local) ─────────────────────────────────────────────── #

_cache_categories: tuple[float, list[dict[str, Any]]] | None = None
_cache_tabs: dict[str, tuple[float, tuple[list[str], list[list[str]]]]] = {}


def _invalidate(tab: str | None = None) -> None:
    """Drop the categories cache and (optionally) one tab's cache."""
    global _cache_categories
    _cache_categories = None
    if tab is None:
        _cache_tabs.clear()
    else:
        _cache_tabs.pop(tab, None)


def list_categories(*, force: bool = False) -> list[dict[str, Any]]:
    """Read the `all_sheets` tab and return the list of category sheets.

    Cached for `_READ_TTL` seconds. Pass `force=True` to bypass.
    """
    global _cache_categories
    now = time.monotonic()
    if not force and _cache_categories and now - _cache_categories[0] < _READ_TTL:
        return _cache_categories[1]

    svc = _sheets_service()
    cfg = get_config()
    resp = _with_retry(
        lambda: svc.spreadsheets()
        .values()
        .get(spreadsheetId=cfg.glossary_sheet_id, range="all_sheets")
        .execute()
    )
    rows = resp.get("values", [])
    out: list[dict[str, Any]] = []
    for r in rows[1:]:
        r = (r + [""] * 5)[:5]
        is_content, sheet_name, description, count, gid = r
        if not sheet_name:
            continue
        out.append(
            {
                "isContent": str(is_content).upper() == "TRUE",
                "sheetName": sheet_name,
                "description": description,
                "count": int(count) if str(count).strip().isdigit() else 0,
                "id": int(gid) if str(gid).strip().lstrip("-").isdigit() else None,
            }
        )
    _cache_categories = (now, out)
    return out


def _read_tab(sheet_name: str, *, force: bool = False) -> tuple[list[str], list[list[str]]]:
    """Return (headers, rows) for a content tab. Cached for `_READ_TTL` seconds."""
    now = time.monotonic()
    cached = _cache_tabs.get(sheet_name)
    if not force and cached and now - cached[0] < _READ_TTL:
        return cached[1]

    svc = _sheets_service()
    cfg = get_config()
    resp = _with_retry(
        lambda: svc.spreadsheets()
        .values()
        .get(spreadsheetId=cfg.glossary_sheet_id, range=f"'{sheet_name}'")
        .execute()
    )
    values = resp.get("values", [])
    if not values:
        result = ([], [])
    else:
        headers, *rows = values
        width = len(headers)
        rows = [(r + [""] * width)[:width] for r in rows]
        result = (headers, rows)
    _cache_tabs[sheet_name] = (now, result)
    return result


def _batch_read_tabs(sheet_names: list[str]) -> dict[str, tuple[list[str], list[list[str]]]]:
    """Fetch many tabs in one batchGet call (and cache them).

    Skips tabs already fresh in cache.
    """
    now = time.monotonic()
    needed = [
        n
        for n in sheet_names
        if not (
            (c := _cache_tabs.get(n)) and now - c[0] < _READ_TTL
        )
    ]
    if needed:
        svc = _sheets_service()
        cfg = get_config()
        resp = _with_retry(
            lambda: svc.spreadsheets()
            .values()
            .batchGet(
                spreadsheetId=cfg.glossary_sheet_id,
                ranges=[f"'{n}'" for n in needed],
            )
            .execute()
        )
        value_ranges = resp.get("valueRanges", [])
        for name, vr in zip(needed, value_ranges):
            values = vr.get("values", [])
            if not values:
                result = ([], [])
            else:
                headers, *rows = values
                width = len(headers)
                rows = [(r + [""] * width)[:width] for r in rows]
                result = (headers, rows)
            _cache_tabs[name] = (now, result)
    return {n: _cache_tabs[n][1] for n in sheet_names}


# ── Public surface ────────────────────────────────────────────────────────── #


def get_entry(category: str, row_number: int) -> dict[str, Any]:
    headers, rows = _read_tab(category)
    idx = row_number - 2
    if idx < 0 or idx >= len(rows):
        raise IndexError(f"row {row_number} out of range for '{category}' (has {len(rows)} data rows)")
    row = rows[idx]
    return {
        "category": category,
        "row": row_number,
        "row_hash": _row_hash(row),
        "fields": dict(zip(headers, row)),
    }


def list_entries(category: str, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    headers, rows = _read_tab(category)
    sliced = rows[offset : offset + limit]
    entries = [
        {
            "category": category,
            "row": offset + 2 + i,
            "row_hash": _row_hash(r),
            "fields": dict(zip(headers, r)),
        }
        for i, r in enumerate(sliced)
    ]
    return {
        "category": category,
        "headers": headers,
        "total": len(rows),
        "returned": len(entries),
        "offset": offset,
        "entries": entries,
    }


def search(
    query: str,
    *,
    fields: list[str] | None = None,
    category: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    q = query.lower().strip()
    if not q:
        return []
    cats = (
        [category]
        if category
        else [c["sheetName"] for c in list_categories() if c["isContent"]]
    )
    tab_data = _batch_read_tabs(cats)
    hits: list[dict[str, Any]] = []
    for cat in cats:
        headers, rows = tab_data.get(cat, ([], []))
        target_fields = fields or headers
        for i, row in enumerate(rows):
            for h, cell in zip(headers, row):
                if h not in target_fields:
                    continue
                if q in cell.lower():
                    hits.append(
                        {
                            "category": cat,
                            "row": i + 2,
                            "row_hash": _row_hash(row),
                            "fields": dict(zip(headers, row)),
                            "matched_in": h,
                        }
                    )
                    break
            if len(hits) >= limit:
                return hits
    return hits


def untranslated(
    category: str | None = None,
    *,
    langs: list[str] | None = None,
    require_aynu: bool = True,
    limit: int = 200,
) -> dict[str, Any]:
    """Find rows where any of `langs` is empty.

    Default `langs` is ['日本語', 'English', '中文']. By default, rows missing
    the Aynu cell are skipped (since translation needs a source).
    Returns rows grouped by category, with which columns are missing per row.
    """
    target_langs = langs or ["日本語", "English", "中文"]
    cats = (
        [category]
        if category
        else [c["sheetName"] for c in list_categories() if c["isContent"]]
    )
    tab_data = _batch_read_tabs(cats)

    by_category: dict[str, list[dict[str, Any]]] = {}
    total_missing = 0
    for cat in cats:
        headers, rows = tab_data.get(cat, ([], []))
        if not headers:
            continue
        relevant_langs = [l for l in target_langs if l in headers]
        if not relevant_langs:
            continue
        cat_hits: list[dict[str, Any]] = []
        for i, row in enumerate(rows):
            fields = dict(zip(headers, row))
            if require_aynu and not (fields.get("Aynu") or "").strip():
                continue
            missing = [l for l in relevant_langs if not (fields.get(l) or "").strip()]
            if not missing:
                continue
            cat_hits.append(
                {
                    "category": cat,
                    "row": i + 2,
                    "row_hash": _row_hash(row),
                    "missing": missing,
                    "fields": fields,
                }
            )
            total_missing += 1
            if total_missing >= limit:
                if cat_hits:
                    by_category[cat] = cat_hits
                return {"total": total_missing, "by_category": by_category}
        if cat_hits:
            by_category[cat] = cat_hits
    return {"total": total_missing, "by_category": by_category}


def add_entry(category: str, fields: dict[str, str]) -> dict[str, Any]:
    headers, rows = _read_tab(category)
    new_row = [fields.get(h, "") for h in headers]
    svc = _sheets_service()
    cfg = get_config()
    resp = _with_retry(
        lambda: svc.spreadsheets()
        .values()
        .append(
            spreadsheetId=cfg.glossary_sheet_id,
            range=f"'{category}'",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": [new_row]},
        )
        .execute()
    )
    _invalidate(category)
    updated_range = resp.get("updates", {}).get("updatedRange", "")
    new_row_num = len(rows) + 2
    return {
        "category": category,
        "row": new_row_num,
        "row_hash": _row_hash(new_row),
        "fields": dict(zip(headers, new_row)),
        "updated_range": updated_range,
    }


def update_entry(
    category: str,
    row_number: int,
    fields: dict[str, str],
    expected_row_hash: str | None = None,
) -> dict[str, Any]:
    # Always read fresh for updates so we hash against the truth.
    headers, rows = _read_tab(category, force=True)
    idx = row_number - 2
    if idx < 0 or idx >= len(rows):
        raise IndexError(f"row {row_number} out of range for '{category}'")
    current = rows[idx]
    if expected_row_hash and _row_hash(current) != expected_row_hash:
        raise RuntimeError(
            f"row {row_number} in '{category}' has changed since last read "
            f"(expected hash {expected_row_hash}, got {_row_hash(current)}). "
            "Re-read the entry before updating."
        )

    unknown = [k for k in fields if k not in headers]
    if unknown:
        raise ValueError(f"unknown columns for '{category}': {unknown}; headers are {headers}")

    new_row = [fields.get(h, current[i]) for i, h in enumerate(headers)]
    end_col = _col_letter(len(headers))
    rng = f"'{category}'!A{row_number}:{end_col}{row_number}"
    svc = _sheets_service()
    cfg = get_config()
    _with_retry(
        lambda: svc.spreadsheets()
        .values()
        .update(
            spreadsheetId=cfg.glossary_sheet_id,
            range=rng,
            valueInputOption="USER_ENTERED",
            body={"values": [new_row]},
        )
        .execute()
    )
    _invalidate(category)
    return {
        "category": category,
        "row": row_number,
        "row_hash": _row_hash(new_row),
        "fields": dict(zip(headers, new_row)),
    }
