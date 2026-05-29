"""Runtime configuration: env loading and resource paths.

Two ways to supply Google Sheets credentials:

1. `GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json` (standard Google form)
2. The `PRIVATE_GOOGLE_API_*` env vars used by the existing ainu-glossary site
   (PRIVATE_GOOGLE_API_TYPE, PROJECT_ID, PRIVATE_KEY_ID, PRIVATE_KEY,
   CLIENT_EMAIL, CLIENT_ID). Useful when you already have these set.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True, slots=True)
class Config:
    ainu_root: Path
    glossary_sheet_id: str
    google_credentials: Path | None
    google_credentials_info: dict[str, Any] | None

    @property
    def corpora_jsonl(self) -> Path:
        return self.ainu_root / "ainu-corpora" / "data.jsonl"

    @property
    def dictionaries_dir(self) -> Path:
        return self.ainu_root / "ainu-dictionaries"

    @property
    def grammar_dir(self) -> Path:
        return self.ainu_root / "ainu-grammar"


def _build_credentials_info() -> dict[str, Any] | None:
    """Assemble a service-account info dict from PRIVATE_GOOGLE_API_* env vars,
    matching the shape used by the existing ainu-glossary site. Returns None if
    the required keys aren't all present."""
    required = {
        "type": "PRIVATE_GOOGLE_API_TYPE",
        "project_id": "PRIVATE_GOOGLE_API_PROJECT_ID",
        "private_key_id": "PRIVATE_GOOGLE_API_PRIVATE_KEY_ID",
        "private_key": "PRIVATE_GOOGLE_API_PRIVATE_KEY",
        "client_email": "PRIVATE_GOOGLE_API_CLIENT_EMAIL",
        "client_id": "PRIVATE_GOOGLE_API_CLIENT_ID",
    }
    values: dict[str, Any] = {}
    for k, env in required.items():
        v = os.environ.get(env)
        if not v:
            return None
        # private keys may be stored with escaped \n — unescape
        if k == "private_key":
            v = v.replace("\\n", "\n")
        values[k] = v
    # google-auth needs token_uri to make sense of the SA
    values.setdefault("token_uri", "https://oauth2.googleapis.com/token")
    return values


@cache
def get_config() -> Config:
    ainu_root = Path(os.environ.get("AINU_ROOT", "/home/mkpoli/projects/Ainu")).expanduser()
    sheet_id = os.environ.get(
        "AINU_GLOSSARY_SHEET_ID",
        "1zV0gl4TWV5fkf2r9i_1P1jmH_p7LOzbhZQgm7mPwDdE",
    )
    creds_env = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    creds = Path(creds_env).expanduser() if creds_env else None
    creds_info = _build_credentials_info() if not creds else None
    return Config(
        ainu_root=ainu_root,
        glossary_sheet_id=sheet_id,
        google_credentials=creds,
        google_credentials_info=creds_info,
    )
