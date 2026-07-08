# Proposal: correcting POSS-CV-EPENTH-I over-generation (C-final possessive allomorphy)

Scope: Hokkaido Ainu, Saru (Tamura 1996) primary, Chitose (Nakagawa 1995) cross-checked; Mukawa (Chiba 2002) + corpus for attestation. Orthography: morphophonemic ⟨n⟩ before p.

## Core finding
`POSS-CV-EPENTH-I` must STOP being the universal C-final default. The C-final
possessive partitions **five ways**, two of which are large principled classes,
not a short exception list:

| Outcome | Trigger | Examples |
|---|---|---|
| **-i / -ihi** (residual default) | most C-final | cikir→cikiri, am→ami, hon→honi, ekas→ekasi, cup→cupi |
| **-u / -uhu** (lexical class) | listed body-part/-utur/-sut/-ap stems | mor→moru, setur→seturu, nan→nanu, kap→kapu, kat→katu |
| **-e / -he** (lexical) | y/w-final + listed k-final body parts | haw→hawe, tek→teke, imak→imakake |
| **-a / -aha** (NEW class, currently unmodeled) | -am 'bottom/edge/surface' nouns | asam→asama, tumam→tumama, sam→sama |
| **location: -o/-oho or -ke/-kehe** | locative/positional nouns | or→oro, kotor→kotoro, corpok→corpokke, kim→kimke |

Plus: final **-t** palatalizes before -i (mat→maci, kut→kuci) but NOT before -u (at→atu).

## Proposed rule cascade (highest priority first)
1. Suppletive / `blocks_rule_output` / `preferred_attested_form` (unchanged).
2. `noun_class = locative_relational` → **POSS-LOC** (new): per-lemma `loc_suffix ∈ {o, ke, e, si}`. Location nouns NEVER take -i.
3. Lexical declension override (expand from 2 → 4): `u_class` (-u/-uhu), `e_class` (-e/-he), **`a_class` (-a/-aha, NEW)**.
4. Phonological default: /t/→palatalize+-i (high conf); vowel-final→-hV; **else C-final → POSS-CV-EPENTH-I (-i), emitted source=rule, NO attested_ref, low confidence, FLAGGED.**

## Corrections this surfaces
- **asam→asama**: needs a new `a_class`; currently only a negative test, no positive form was generable.
- **nan→nanuhu**: attested in BOTH Saru (Tamura) AND Chitose (Nakagawa) — current note saying Nakagawa-only is wrong.
- Location nouns (or, kotor, par, corpok, kim, ror…) were fabricating *ori/*kimi — POSS-LOC fixes this.

## Class-membership lists to encode (the JSON data)
- **u_class**: mor, rar, asur, setur, nan, ram, ham, kewtum, montum, penram, kap, rap, hurkap, mokrap, sikrap, nankap, kankap, sikkap, pokinkap, notarap, kisanrap, kat, at, kewsut, nisut, kursut, oksut, oattapsut, omkursut, askekursut, haruramat, mimakutur, rarutur, petutur, kiyutur, utur, put.
- **e_class**: tek, imak, harkitek, inawsantek, etupsik.
- **a_class (NEW)**: asam, tumam, nitumam, ureasam, harkisam, katcam, kutcam, símoysam, kesupasam, teksam, utorsam (and sam→samake).
- **locative_relational** with loc_suffix:
  - o: or, kotor, níkotor, ipor, páipor, osor, par, kiror, kanpar, kotpar, nikor, upsor, ruwor, urekotor, hunakor, etok.
  - ke: ror, parur, corpok, kim, mak, koypok, kotpok, monpok, osmak, oka, noski, onnay, kotca, sam, rep, ous.
  - e: cupkes, honkes, sikkes, sikokes.
  - si (ka/enka 'top' family): ka→kasi, enka→enkasi, koyka→koykasi, mawka→mawkasi, rewka→rewkasi.

## Open questions needing expert judgment
1. **tek / eC# tension**: keep `tek` as a lexical `e_class` (matches teke + the reki→reki counterexample), even though Tamura's own prose groups eC# as phonological. Descriptive tension, not a bug.
2. **-ke vs -o split among location nouns is lexical, not phonologically derivable** (kotor→kotoro but ror→rorke, both -r). Must be listed.
3. **long-form -hi/-hu is prosodic** (rhythm/3rd-person), not segmental — keep the "emit both short+long" design but don't claim long is obligatory.
4. **Dialect**: Hokkaido Saru/Chitose only; Sakhalin not surveyed.
5. **Bugaeva's grammar wasn't loadable** via the grammar_search tool — all generalizations are grounded in Tamura 1996 (which encodes the paradigm in suffix headwords), Nakagawa 1995, Chiba 2002, and the aligned corpus. Worth confirming the location-noun augment classes against Bugaeva's positional-noun analysis if available.

Evidence: Tamura `original.tsv` suffix headwords (lines 2, 10, 12–17, 58–60) + `所は…` annotations; Nakagawa `nakagawa_terms.tsv` (nan,-u / setur,-u / par,-o / mat,-i).
