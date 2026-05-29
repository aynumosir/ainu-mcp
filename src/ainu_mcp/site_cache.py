"""Refresh the itak.aynu.org website's R2 cache.

The website doesn't read from Google Sheets directly — it reads two JSON files
from a Cloudflare R2 bucket (`table.json` flattened entries + `sheets.json`
metadata) refreshed by a weekly cron worker in `ainu-glossary/workers/`. This
module ports that worker logic into the MCP so edits can be pushed live on
demand (instead of waiting up to a week).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import cache
from typing import Any

import boto3
from botocore.client import Config

from . import glossary


@dataclass(frozen=True, slots=True)
class R2Creds:
    access_key_id: str
    secret_access_key: str
    bucket: str
    endpoint: str


@cache
def _r2_creds() -> R2Creds:
    """Read R2 credentials from env (same names the website uses)."""
    missing = [
        k
        for k in (
            "PRIVATE_CLOUDFLARE_R2_S3_ACCESS_KEY_ID",
            "PRIVATE_CLOUDFLARE_R2_S3_SECRET_ACCESS_KEY",
            "PRIVATE_CLOUDFLARE_R2_S3_BUCKET",
            "PRIVATE_CLOUDFLARE_R2_S3_ENDPOINT",
        )
        if not os.environ.get(k)
    ]
    if missing:
        raise RuntimeError(
            f"Missing Cloudflare R2 env vars: {missing}. "
            "Copy from ainu-glossary/.env into ainu-mcp/.env."
        )
    return R2Creds(
        access_key_id=os.environ["PRIVATE_CLOUDFLARE_R2_S3_ACCESS_KEY_ID"],
        secret_access_key=os.environ["PRIVATE_CLOUDFLARE_R2_S3_SECRET_ACCESS_KEY"],
        bucket=os.environ["PRIVATE_CLOUDFLARE_R2_S3_BUCKET"],
        endpoint=os.environ["PRIVATE_CLOUDFLARE_R2_S3_ENDPOINT"],
    )


@cache
def _r2_client() -> Any:
    c = _r2_creds()
    return boto3.client(
        "s3",
        endpoint_url=c.endpoint,
        aws_access_key_id=c.access_key_id,
        aws_secret_access_key=c.secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def refresh_site_cache(*, dry_run: bool = False) -> dict[str, Any]:
    """Rebuild and upload `table.json` and `sheets.json` to R2.

    Mirrors `ainu-glossary/workers/cron-maintenance.ts`:

    1. Read the `all_sheets` meta tab → list of category sheets with `isContent`.
    2. For each content sheet, read its rows, build dicts keyed by header.
    3. Flatten all entries, tagging each with its `sheetName`, into one array.
    4. Upload `table.json` (entries) and `sheets.json` (content-sheet metadata).

    When `dry_run=True`, builds the payloads and reports their size but skips
    the upload — useful to verify the data shape without publishing.
    """
    glossary._invalidate()  # always read fresh for a publish

    sheets_meta = glossary.list_categories(force=True)
    content_sheets = [s for s in sheets_meta if s["isContent"]]
    names = [s["sheetName"] for s in content_sheets]

    # Single batchGet for every content tab — keeps us well under the 60/min
    # read quota even if other reads have happened recently.
    tab_data = glossary._batch_read_tabs(names)

    flattened: list[dict[str, str]] = []
    for name in names:
        headers, rows = tab_data.get(name, ([], []))
        if not headers:
            continue
        for row in rows:
            entry = {h: c for h, c in zip(headers, row) if h}
            entry["sheetName"] = name
            flattened.append(entry)

    table_json = json.dumps(flattened, ensure_ascii=False).encode("utf-8")
    sheets_json = json.dumps(content_sheets, ensure_ascii=False).encode("utf-8")

    result: dict[str, Any] = {
        "content_sheets": len(content_sheets),
        "entries": len(flattened),
        "table_bytes": len(table_json),
        "sheets_bytes": len(sheets_json),
        "dry_run": dry_run,
    }

    if dry_run:
        result["uploaded"] = False
        return result

    creds = _r2_creds()
    s3 = _r2_client()
    s3.put_object(
        Bucket=creds.bucket,
        Key="table.json",
        Body=table_json,
        ContentType="application/json",
    )
    s3.put_object(
        Bucket=creds.bucket,
        Key="sheets.json",
        Body=sheets_json,
        ContentType="application/json",
    )
    result["uploaded"] = True
    result["bucket"] = creds.bucket
    return result
