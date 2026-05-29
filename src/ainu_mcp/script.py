"""Script conversion wrappers around the ainconv package.

ainconv unfortunately prints debug info to stdout, which would corrupt the MCP
stdio channel — every call is wrapped in a stdout-suppression context.
"""

from __future__ import annotations

import contextlib
import io
import os
from typing import Any, Callable, Literal

import ainconv

Script = Literal["latn", "kana", "cyrl"]

_CONVERTERS: dict[tuple[str, str], Callable[[str], str]] = {
    ("kana", "latn"): ainconv.kana2latn,
    ("latn", "kana"): ainconv.latn2kana,
    ("cyrl", "latn"): ainconv.cyrl2latn,
    ("latn", "cyrl"): ainconv.latn2cyrl,
    ("kana", "cyrl"): ainconv.kana2cyrl,
    ("cyrl", "kana"): ainconv.cyrl2kana,
}


@contextlib.contextmanager
def _muted():
    """Suppress library prints that would corrupt MCP stdio."""
    with open(os.devnull, "w") as devnull, contextlib.redirect_stdout(devnull):
        yield


def convert(text: str, from_script: Script, to_script: Script) -> str:
    if from_script == to_script:
        return text
    fn = _CONVERTERS.get((from_script, to_script))
    if fn is None:
        raise ValueError(f"unsupported conversion: {from_script} → {to_script}")
    with _muted():
        return fn(text)


def detect_script(text: str) -> str:
    with _muted():
        result = ainconv.detect(text)
    # `detect` may return a Script enum; coerce to a plain string for JSON.
    return getattr(result, "name", str(result)).lower()


def separate_syllables(word: str) -> list[str]:
    with _muted():
        result = ainconv.separate(word)
    return list(result) if result is not None else []


def all_scripts(text: str) -> dict[str, Any]:
    """Return the input text rendered in every script, given a detected source."""
    src = detect_script(text)
    out: dict[str, Any] = {"detected": src, "input": text}
    for tgt in ("latn", "kana", "cyrl"):
        if tgt == src:
            out[tgt] = text
            continue
        try:
            out[tgt] = convert(text, src, tgt)  # type: ignore[arg-type]
        except Exception as e:
            out[tgt] = f"(error: {e})"
    return out
