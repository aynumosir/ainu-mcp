export const meta = {
  name: 'morphogen-remediate',
  description: 'Remediate the generative-morphology blockers: full-bank generation sweep + build/publish wiring + short/long fix + real generator tests in MDB; retire the Turso morphology store in ainu-mcp and re-point tools at MDB /api/forms; re-run adversarial review.',
  phases: [
    { title: 'Recon', detail: 'confirm exact integration points for the fixes in both repos' },
    { title: 'Core fixes', detail: 'MDB full-bank sweep + cli/tests (parallel with) ainu-mcp Turso retire + proxy re-point' },
    { title: 'MDB serve', detail: 'wire forms.json/forms.sql into sync + publish-d1; validate /api/forms serves JSON locally' },
    { title: 'Review', detail: 'adversarial multi-dimension review of both repos' },
  ],
}

const MDB = '/home/mkpoli/projects/Ainu/ainu-morpheme-database'
const MCP = '/home/mkpoli/projects/Ainu/ainu-mcp'
const MORPHDATA = '/home/mkpoli/projects/Ainu/ainu-morphology-data'
const j = (x) => JSON.stringify(x)

const BRIEF = [
  'CONTEXT: A prior workflow built a GENERATIVE Ainu morphology foundation in MDB (' + MDB + ', served at mdb.aynu.org; Python stdlib+pyyaml -> SvelteKit/Cloudflare Worker + optional D1). It produces possessed-noun forms, plural-verb forms, and derivations, hybrid with provenance (source=rule|attested|exception + confidence). ainu-mcp (' + MCP + ') is a TS Cloudflare Worker MCP server that PROXIES MDB.',
  '',
  'ALREADY ON DISK (working tree, NOT committed):',
  '- ' + MDB + '/morpheme_db/morphology/{schema,realize,harvest,orthography,generation}.py + __init__.py (1900+ lines; 92 pytest pass).',
  '- ' + MDB + '/morpheme_db/seed/generation/{possession,plural,derivation,exceptions}.json (10+6+13 rules, 58 typed exceptions).',
  '- ' + MDB + '/morpheme_db/export_sqlite_forms.py ; ' + MDB + '/morpheme_db/output/forms.json (65 forms, 34 rule / 31 exception).',
  '- ' + MDB + '/web/src/routes/api/forms/+server.ts + web/src/lib/server/forms.ts + edits to web/src/lib/server/api-views.ts, web/src/lib/types.ts, web/scripts/sync-database.mjs.',
  '- ' + MCP + ' (on branch feat/morphology-tools): worker/src/tools/morphology.ts adds morphology_forms (proxy to MDB /api/forms) PLUS morphology_search/morphology_reverse_lookup backed by a Turso table.',
  '',
  'LOCKED DECISIONS (do not relitigate):',
  '- MDB hosts the engine; ainu-mcp is PROXY-ONLY. The Turso morphology store in ainu-mcp must be RETIRED and morphology_search/morphology_reverse_lookup RE-POINTED at MDB /api/forms.',
  '- Hybrid + provenance: rule-predicted-but-unattested forms are surfaced but FLAGGED (source=rule, no attested_ref, lower confidence).',
  '- ORTHOGRAPHY: morphophonemic <n> before p (write huskoanpe, not huskoampe).',
  '',
  'MDB /api/forms CONTRACT (already defined by web/src/routes/api/forms/+server.ts — READ it to confirm exact params/shape): GET /api/forms supports ?id= (single) and ?q=/?lemma=/?category=/?relation=/?feature=/?provenance=/?min_conf=/?limit= ; response mirrors the other /api endpoints: {query,total,returned,results}.',
  '',
  'BLOCKERS TO FIX (from the adversarial review):',
  'B1 [MDB] No build/publish pipeline: forms.json/forms.sql are produced only from tests. cli.py has no `forms` subcommand; web/scripts/sync-database.mjs + web/scripts/publish-d1.mjs do not build/copy/load forms. A clean deploy ships an EMPTY forms dataset.',
  'B2 [MDB] generate_all() walks ONLY the 65 seed test_cases (generation.py ~line 444), NOT the bank. forms.json is seed-bound. Must SWEEP the bank: the ~489 number-marked + ~223 possessive-marked lexemes (and apply derivation where sensible), emitting bank-bounded predictions with provenance — exceptions/attested where available, else rule-predicted FLAGGED (lower confidence, no attested_ref).',
  'B3 [MDB] Possessed short/long asymmetry (generation.py ~line 291): exceptions.json stores only ONE of the two possessed form-length surfaces and curated-backing matches on exact surface string, so the other length variant falls through. Fix the data and/or make matching length-aware.',
  'B4 [MDB] load_forms("str") raises AttributeError (expects Path) — latent footgun; make it accept str|Path.',
  'B5 [MDB] Engine generation is under-tested: the seed test round-trips the expected string but never RUNS the generator and negatives are unexercised. Add tests that actually call generate()/generate_all() and assert blocks/negatives.',
  'B6 [MDB] /api/forms currently returns the SPA fallback HTML (forms.json not in the web bundle). Wiring forms.json into the bundle (sync-database.mjs) must make GET /api/forms return JSON locally.',
  'B7 [ainu-mcp] TWO contradictory morphology stores. RETIRE the Turso one: delete worker/migrations/0004_morphology.sql, src/ainu_mcp/morphology.py, the build_morphology() hook + import + manifest/migration-list mentions in etl/build_d1.py, the `DELETE FROM morphology_fts` line in worker/seed/reset.sql, the MorphologyRow/morphologySearch/morphologyReverseLookup helpers in worker/src/db.ts, and the Turso-backed test worker/test/morphology.test.mjs. Re-point worker/src/tools/morphology.ts so morphology_search and morphology_reverse_lookup PROXY MDB /api/forms (via env.MDB service binding, mirroring worker/src/tools/morpheme.ts fetchJson(env.MDB, https://mdb.aynu.org/api/forms?...)), keeping morphology_forms. Keep tool registration in worker/src/mcp.ts working (no env.DB dependency for morphology). Replace the Turso .mjs test with a proxy shape/mock test. Update README morphology section to describe the MDB-backed, proxy-only design (no Turso/TSV-ingest framing).',
  '',
  'GROUND RULES: Do NOT run git (no branch/commit/push). Do NOT deploy. ONLY edit the working tree and run Python/JS builds + tests. Match existing conventions (Python stdlib+pyyaml+uv; ainu-mcp worker tests are .mjs not .ts). RUN builds/tests and REPORT pass/fail HONESTLY; never fake success or invent linguistic data. For linguistic grounding use the Ainu MCP tools via ToolSearch (select:mcp__claude_ai_Ainu_MCP__dictionary_lookup,mcp__claude_ai_Ainu_MCP__corpus_search,mcp__claude_ai_Ainu_MCP__morpheme_search) and the local dictionary submodules under ' + MDB + '.',
].join('\n')

const WRITE_REPORT = {
  type: 'object', additionalProperties: false,
  properties: {
    files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      path: { type: 'string' }, action: { type: 'string', enum: ['created', 'modified', 'deleted', 'none'] }, summary: { type: 'string' } }, required: ['path', 'action', 'summary'] } },
    commands_run: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      cmd: { type: 'string' }, exit_ok: { type: 'boolean' }, output_tail: { type: 'string' } }, required: ['cmd', 'exit_ok', 'output_tail'] } },
    counts: { type: 'string' },
    build_passed: { type: ['boolean', 'null'] },
    tests_passed: { type: ['boolean', 'null'] },
    blockers_fixed: { type: 'array', items: { type: 'string' } },
    blockers_remaining: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['files', 'commands_run', 'build_passed', 'tests_passed', 'blockers_fixed', 'blockers_remaining', 'notes'],
}

const CONTRACT = {
  type: 'object', additionalProperties: false,
  properties: {
    mdb_cli_integration: { type: 'string' },
    publish_sync_integration: { type: 'string' },
    bank_sweep_entry: { type: 'string' },
    api_forms_params: { type: 'string' },
    mcp_files_to_retire: { type: 'array', items: { type: 'string' } },
    mcp_proxy_mapping: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['mdb_cli_integration', 'publish_sync_integration', 'bank_sweep_entry', 'api_forms_params', 'mcp_files_to_retire', 'mcp_proxy_mapping', 'risks'],
}

const REVIEW = {
  type: 'object', additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] }, file: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' } },
      required: ['severity', 'issue', 'fix'] } },
    overall: { type: 'string' }, ready_to_pr: { type: 'boolean' },
  },
  required: ['dimension', 'findings', 'overall', 'ready_to_pr'],
}

log('morphogen-remediate: full-bank sweep + build/publish wiring + short/long fix in MDB; retire Turso + proxy re-point in ainu-mcp; then adversarial review.')

phase('Recon')
const contract = await agent(
  BRIEF + '\n\nROLE: Recon. Read both repos to confirm the EXACT integration points for every blocker fix (do NOT modify anything). Specifically: how to add a `forms` subcommand to ' + MDB + '/morpheme_db/cli.py (read it + how morpheme_db.morphology.generation.build_forms/generate_all are invoked); how web/scripts/sync-database.mjs and web/scripts/publish-d1.mjs are structured (so forms.json/forms.sql get copied + loaded); where generate_all() lives and how to make it sweep the bank (read generation.py + how it currently iterates seed test_cases; identify how to enumerate the ~489 number-marked + ~223 possessive-marked lexemes from lexeme_bank.json / morpheme_database.json); the precise /api/forms params + response shape (read web/src/routes/api/forms/+server.ts); and the exact ainu-mcp files to retire + how morphology_search/reverse_lookup should map onto /api/forms query params. Return the structured contract.',
  { schema: CONTRACT, label: 'recon', effort: 'high' },
)
if (!contract) { log('recon failed; aborting'); return { error: 'recon failed' } }

phase('Core fixes')
const coreResults = (await parallel([
  () => agent(
    BRIEF + '\n\nBUILD CONTRACT:\n' + j(contract) + '\n\nROLE: MDB core fixer. Fix B1+B2+B3+B4+B5 in ' + MDB + '. (1) Add a `forms` subcommand to morpheme_db/cli.py that runs the generation build and writes morpheme_db/output/forms.json (and invokes export_sqlite_forms for forms.sql), so a clean `uv run python -m morpheme_db.cli forms` reproduces the artifacts. (2) Extend generate_all() to SWEEP THE BANK: in addition to seed test_cases, enumerate the ~489 number-marked + ~223 possessive-marked lexemes and emit bank-bounded predictions — exceptions/attested where available, else rule-predicted FLAGGED (source=rule, no attested_ref, lower confidence). Keep it deterministic + de-duped. (3) Fix the possessed short/long asymmetry so BOTH form-length surfaces are produced/curated (length-aware matching or store both). (4) Make load_forms accept str|Path. (5) Add REAL generator tests (call generate()/generate_all(), assert blocks/negatives + a few bank-swept forms + orthography <n>-before-p), not just expected-string round-trips. RUN `uv run python -m morpheme_db.cli forms` and `uv run pytest morpheme_db/tests lexeme_db/tests -q`; report the new forms.json count + provenance breakdown + pass/fail. Ground new linguistic forms against dictionaries/corpus via the Ainu MCP tools. Do NOT touch git or deploy.',
    { schema: WRITE_REPORT, label: 'mdb-core', phase: 'Core fixes', effort: 'xhigh' },
  ),
  () => agent(
    BRIEF + '\n\nBUILD CONTRACT:\n' + j(contract) + '\n\nROLE: ainu-mcp Turso-retire + proxy author (repo ' + MCP + ', branch feat/morphology-tools). Fix B7: RETIRE the Turso morphology store and make ALL morphology tools proxy MDB /api/forms. Delete worker/migrations/0004_morphology.sql, src/ainu_mcp/morphology.py, worker/test/morphology.test.mjs; remove the build_morphology() function + its import + manifest entry + migration-list mentions from etl/build_d1.py; remove the `DELETE FROM morphology_fts` line from worker/seed/reset.sql; remove MorphologyRow/morphologySearch/morphologyReverseLookup from worker/src/db.ts. Re-point worker/src/tools/morphology.ts: morphology_search proxies GET /api/forms?q=...&limit=...; morphology_reverse_lookup proxies the base->forms direction (?lemma= or the appropriate relation/feature filter); keep morphology_forms. All via env.MDB service binding, mirroring worker/src/tools/morpheme.ts fetchJson(env.MDB, https://mdb.aynu.org/api/forms?...). Ensure worker/src/mcp.ts still registers them and morphology no longer depends on env.DB. Add a .mjs proxy shape/mock test (NOT .ts). Update the README morphology section to the MDB-backed proxy-only design (drop Turso/TSV-ingest framing). Verify NO dangling references remain (grep morphology_fts / build_morphology / morphologySearch across the repo). RUN `cd worker && bunx tsc --noEmit` and `bun test`; report pass/fail + any dangling refs. Do NOT touch git or deploy.',
    { schema: WRITE_REPORT, label: 'mcp-retire', phase: 'Core fixes', effort: 'high' },
  ),
])).filter(Boolean)

phase('MDB serve')
const serve = await agent(
  BRIEF + '\n\nBUILD CONTRACT:\n' + j(contract) + '\n\nROLE: MDB serve wiring. Fix B6 (and finish B1 on the web side): wire the forms artifact end-to-end so a clean build serves it. Ensure web/scripts/sync-database.mjs copies morpheme_db/output/forms.json into the web bundle (web/src/lib/data/forms.json) and web/scripts/publish-d1.mjs builds + loads forms.sql (add the export call to rebuildSqlDump() and the wrangler d1 execute to importSql()). Then VALIDATE locally that GET /api/forms returns JSON (not SPA HTML): run `cd ' + MDB + '/web && bun install && bun run gen` (which runs sync-database) then `bun run check` (svelte-check) and, if feasible, start a dev/preview server and curl GET /api/forms?lemma=sapa to confirm a JSON body with results. Report exactly what you verified (JSON vs HTML) and pass/fail. Do NOT touch git or deploy to production.',
  { schema: WRITE_REPORT, label: 'mdb-serve', effort: 'high' },
)

phase('Review')
const dims = ['build/publish reproducibility (clean build produces + serves non-empty forms)', 'Turso fully retired in ainu-mcp (no dangling refs; tools proxy MDB; tsc+tests green)', 'linguistic soundness of bank-swept forms (sample rule-predicted vs attested; orthography)', 'full-bank sweep correctness + provenance flagging + short/long both present']
const reviews = (await parallel(dims.map((dim) => () => agent(
  BRIEF + '\n\nROLE: Adversarial reviewer — ' + dim + '. Review the working-tree changes across BOTH repos (' + MDB + ' and ' + MCP + ') for this dimension. Read the actual modified files and RUN the cheap checks yourself to confirm claims rather than trusting reports: e.g. `uv run python -m morpheme_db.cli forms` then inspect forms.json count + provenance; `uv run pytest -q`; in ainu-mcp `cd worker && bunx tsc --noEmit && bun test` and grep for dangling morphology_fts/build_morphology/morphologySearch refs; spot-check several bank-swept forms (especially rule-predicted ones, confirm they are FLAGGED) against dictionaries/corpus via the Ainu MCP tools. Be specific (file + issue + fix), rank by severity, and give a blunt ready_to_pr verdict.',
  { schema: REVIEW, label: 'review:' + dim, phase: 'Review', effort: 'high' },
)))).filter(Boolean)

return {
  contract,
  core: coreResults,
  serve,
  review: reviews,
}
