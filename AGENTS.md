# Agent guidance: editing the Itak-uoeroskip glossary

This file is meant for any LLM agent (Claude, Codex, Cursor, etc.) connected to
this MCP server. It documents the workflow that produces high-quality glossary
edits — based on lexicographic conventions used throughout `itak.aynu.org` and
on lessons from past editing mistakes. Follow it before adding or updating any
entry.

## Why this matters

The glossary is published and used by other translators. Sloppy entries
(ungrammatical Ainu, padded glosses, parenthetical examples, multi-clause
notes, wrong attributions) damage its credibility and have to be cleaned up by
hand. **Most mistakes come from skipping research and writing from intuition.**

## Editing workflow

Run these steps in order for every add/update. Tool names refer to the
[`ainu-mcp`](README.md) MCP server.

### 1. Research the word (always)

```text
entry_research("<word>")
```

One call returns:
- Script renditions (Latin / Katakana / Cyrillic) — copy the canonical Latin form.
- Existing glossary hits — **if one exists, prefer updating it over adding a duplicate.**
- All dictionary attestations — read every gloss, note transitivity markers like Chiri's `(-an)`.
- Corpus example sentences — read them; they often reveal real usage patterns the dictionaries don't spell out.

### 2. Survey the target category (always)

```text
glossary_list_entries("<category>", limit=200)
```

Skim ~20+ existing rows in the category you intend to write to. Confirm:
- What placeholder convention is used here? (`N1`/`N2` for transitive args, `V1` for verb args, etc.)
- How transitive vs intransitive verbs are formatted.
- Average gloss length (don't pad to twice the local norm).
- Note style — almost always `< source` only.

### 3. Verify transitivity against corpus + grammar

If you think a verb is transitive or intransitive, confirm it:

```text
corpus_search("<form>", lang="ain", limit=20)
grammar_search("<keyword>")
```

Look for:
- `=an` suffix → intransitive subject marker.
- `a=`, `c=`, `e=`, `ku=`, `ci=`, `eci=` prefixes → personal subject markers (occur on both transitive and intransitive verbs, but the bare form's transitivity matters).
- Postpositions / spatial nouns following an NP: `kasi`, `or`, `ta`, `peka`, `corpok`, `enka`, `etok` → these form adverbial NPs that can attach to **intransitive** verbs without making them transitive.

### 4. Pick the right Aynu form

Style rules observed across the glossary (each rule is enforced — survey will confirm):

- **Transitive verb**: `N1 a=<verb>` (or `N1 N2 a=<verb>` for ditransitives, or `N1 <particle> a=<verb>` like `N1 ka opiwki`).
- **Intransitive verb**: bare form, often with `=an` (`inkar=an`, `siruwante`, `hetuku`, `sinki`). Never `N1 V=an` as direct object.
- **Intransitive verb with a locative complement**: form is `N1 <spatial-noun> <postposition> V=an`. The locative NP must be syntactically complete — spatial nouns like `kasi`, `corpok`, `enka`, `etok` are nouns, not postpositions, so they need a real postposition (`ta`, `peka`, `wa`, `un`, …) before the verb. Right: `N1 kasi ta sikuyruke=an` ("watch over N1's surface" — fully parallel to corpus's `eci=uni kasi ta rewsi=an`, `kotan kasi peka arpa=an`). Wrong: `N1 kasi sikuyruke=an` (no postposition — 0 productive corpus attestations across ~2000 `kasi` sentences; only Kayano's elliptical dictionary phrase).
- **Alternative forms**: list them comma-separated (`N1 a=resu, N1 a=respa`).

### 5. Write tight glosses

| Column | Style |
| --- | --- |
| `日本語` | 3–5 dictionary-form synonyms separated by `、`. **No parentheses.** No "例: …", no "(〜など)". |
| `English` | Same, comma-separated. Match the transitivity (`monitor N1` for transitive entries, `keep watch` for intransitive). |
| `中文` | Same, separated by `，`. **No parentheses.** Mirror the N1 usage. |
| `Aynu` | The form decided in step 4. |
| `註 / Notes` | Minimal: `< source` or `< source1, < source2`. Sources include `田村`, `萱野`, `鵡川`, `太田`, `中川`, `知里`, `アタ`, `アア`, `ウア`, `鍋沢`, `神謡`, `平取`, `音声`, `会話`, **`まぽ`** (for modern coinages introduced by the project owner). Occasionally one short usage gloss like `< 太田 「思い切り～を見る」` is acceptable. Never put cross-references, morpheme breakdowns, or example sentences here. |

### 6. Add or update with optimistic locking

```text
glossary_add_entry("<category>", {…})

# or, if updating:
glossary_get_entry("<category>", <row>)   # capture row_hash
glossary_update_entry("<category>", <row>, {…}, expected_row_hash="<hash>")
```

Always pass `expected_row_hash` when updating. If the row has changed since you
read it, the call is refused — re-read and re-decide.

### 7. Report back

State which row(s) changed, the final field values, and a one-line rationale
per non-obvious choice (which category, transitivity decision, source). Don't
dump your reasoning into the Notes column — that's what the chat is for.

## Common mistakes (already made — don't repeat)

- ❌ `N1 sikuyruke=an` treating N1 as direct object of an intransitive verb.
- ❌ `N1 ka sikuyruke=an` and `N1 kasi sikuyruke=an` listed as equivalent variants when the project owner prefers `kasi` here.
- ❌ `N1 kasi sikuyruke=an` without a postposition. `kasi` is a spatial noun, not a postposition; it needs `ta`/`peka`/`wa`/`un` to form a complete adverbial. Use `N1 kasi ta sikuyruke=an`. Don't be misled by a single bare illustrative phrase in one dictionary — check the corpus for the productive pattern.
- ❌ Parenthetical examples in Japanese: `（プロセス・ログ・ダッシュボードなど）`.
- ❌ Multi-clause Notes: `< 萱野（現代的な拡張用法）；cf. general_verb sikuyruke=an; 同義 N1 a=nukarus`.
- ❌ Padding glosses with five English synonyms when the row's neighbours have two or three.
- ❌ Attributing a modern coinage to a historical dictionary author instead of `< まぽ`.

## Quick reference: the MCP tools

| Tool | When to call |
| --- | --- |
| `entry_research(word)` | Always, first. |
| `glossary_list_categories` | When unsure which category to use. |
| `glossary_list_entries(category, limit=200)` | Before writing — survey style. |
| `glossary_search(query, category=…)` | Check for duplicates or similar entries. |
| `corpus_search(query, lang=…, dialect=…)` | Verify actual usage / transitivity. |
| `dictionary_lookup(word)` | Cross-check dictionary glosses. |
| `grammar_search(keyword)` | Look up syntactic constructions. |
| `convert_script` / `script_all` | Get Kana / Cyrillic renditions. |
| `glossary_add_entry` / `glossary_update_entry` | Write — with `expected_row_hash` for updates. |
