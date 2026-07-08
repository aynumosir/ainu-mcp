export const meta = {
  name: 'morphogen',
  description: 'Implement the generative Ainu morphology system in MDB (schema-first -> harvest-as-evidence -> adversarial verify -> rule layer -> engine -> validation build -> serve + MCP proxy -> adversarial review)',
  phases: [
    { title: 'Recon', detail: 'map MDB build/test/export + exact integration points' },
    { title: 'Schema', detail: 'forms/relations sidecar schema + provenance + tests (no Entry pollution)' },
    { title: 'Harvest', detail: 'mine lexeme-bank glosses -> attested-form candidates with span+confidence' },
    { title: 'Verify harvest', detail: 'adversarially check harvested pairs vs dictionaries/corpus' },
    { title: 'Rule layer', detail: 'draft + diversely verify possession/plural/derivation rules, then persist' },
    { title: 'Engine', detail: 'feature-driven generation.py (separate realization layer) + CLI + tests' },
    { title: 'Validation build', detail: 'generate all bank forms, precision/recall vs reviewed gold, build artifact' },
    { title: 'Serve & proxy', detail: '/api/forms in MDB + morphology proxy tools in ainu-mcp' },
    { title: 'Review', detail: 'adversarial multi-dimension review of both repos' },
  ],
}

const MDB = '/home/mkpoli/projects/Ainu/ainu-morpheme-database'
const MCP = '/home/mkpoli/projects/Ainu/ainu-mcp'
const MORPHDATA = '/home/mkpoli/projects/Ainu/ainu-morphology-data'
const j = (x) => JSON.stringify(x)
function chunk(arr, n) {
  const out = []; const size = Math.max(1, Math.ceil((arr.length || 0) / n))
  for (let i = 0; i < (arr.length || 0); i += size) out.push(arr.slice(i, i + size))
  return out
}

const DESIGN = [
  'GOAL: a GENERATIVE Ainu morphology system that produces possessed-noun forms, plural-verb forms, and derivations.',
  'It is HOSTED IN MDB (' + MDB + ', served at mdb.aynu.org; Python stdlib+pyyaml builds JSON -> SvelteKit/Cloudflare Worker, optional D1 export). ainu-mcp (' + MCP + ') only PROXIES MDB (like its existing morpheme_decompose tool).',
  '',
  'LOCKED DECISIONS:',
  '- Engine in MDB; ainu-mcp proxies.',
  '- P1 scope = possessed noun forms + plural verb forms + derivations (personal conjugation DEFERRED).',
  '- Hybrid + provenance: rules generate; harvest + curated exceptions validate/override; every output tagged source=rule|attested|exception + confidence; rule-predicted-but-unattested forms surfaced but flagged.',
  '',
  'RECONCILED METHOD (Claude + GPT-5.5 review) — FOLLOW THESE PRINCIPLES:',
  '1. SCHEMA-FIRST, SIDECAR TABLES — do NOT add fields to the morpheme Entry; do NOT store generated forms as Entry rows (it pollutes the inventory and reopens the root/word/form muddle). Define new artifacts keyed by existing morpheme/lexeme ids: lexical_relation (typed: suppletive_plural_of, plural_of, possessed_of, absolute_of, derived_from, blocks_rule_output, preferred_attested_form); attested_form (harvest EVIDENCE: surface, source_span, parser_rule, confidence, status=raw|reviewed|rejected, conflict_bucket); generated_form/InflectedForm (lemma_id/lexeme_id, feature_bundle, surface, analysis, source, confidence, rule_id, attested_ref). Provenance MIRRORS the lexeme bank precedent (decomposition_source/decomposition_confidence in lexeme_db/schema.py).',
  '2. HARVEST = CANDIDATE EVIDENCE, NOT GOLD. The lexeme-bank gloss text is fragmented/noisy (e.g. lexeme ahun gloss_jp contains "[単](複は" while the actual plural form sits in a SEPARATE kana array element). Harvest must emit span + parser_rule + confidence + conflict buckets. GOLD = the REVIEWED subset + curated typed exceptions.',
  '3. TWO SEPARATE RULE LAYERS. The valency Rule system (morpheme_db/valency.py) only supports add_slot/remove_slot/internalize/noop = ARGUMENT STRUCTURE; it CANNOT express suffix allomorphy, epenthesis, reduplication, or orthographic repair. Build a SEPARATE declarative SURFACE-REALIZATION layer for forms. Derivation may CALL forward valency composition for argument-structure semantics through a narrow interface, but possession/plural realization must NOT be forced through valency abstractions.',
  '4. STRUCTURED FEATURE BUNDLES, not a flat target string: {domain: nominal|verbal, relation: possessed|plural|derived, ...}. Verbal number is ROLE-SENSITIVE (transitive object-number -pa vs intransitive subject-number); model the dimension even though personal agreement is deferred.',
  '5. PRECOMPUTE-AND-LOOKUP: one Python engine generates all bank-bounded forms at build time -> JSON + D1 artifact -> /api/forms lookup endpoint; ainu-mcp proxies (parallel to its existing precomputed morphology_fts pattern in worker/migrations/0004_morphology.sql + src/ainu_mcp/morphology.py). A live /api/generate endpoint and a TS port are DEFERRED (only for open-world/interactive input).',
  '6. FST / two-level morphology DEFERRED to a later phase. P1 = declarative paradigm/rule tables + post-processing.',
  '',
  'ORTHOGRAPHY: post-processing MUST apply the house convention — morphophonemic <n> before p (write huskoanpe, not huskoampe). Re-spell to morphophonemic n.',
  '',
  'VERIFIED FACTS: MDB has 13,929 morpheme entries (morpheme_db/output/morpheme_database.json) and 15,839 lexemes (lexeme_db/output/lexeme_bank.json). 489 lexemes carry [単]/[複]/単は/複は sg-pl annotations; 223 carry possessive markers (所属形/…の). The affix morphemes already exist (-pa plural, causatives -re/-e/-te, reflexive si-/yay-, personal clitics category=pers). sapa (head) and sapaha (his/her head) exist as separate morphemes; sapaha already has composition [sapa,-ha-poss] but ahun/ahup are unlinked roots.',
  '',
  'AGENT GROUND RULES:',
  '- Do NOT run any git commands (no branch/commit/push). ONLY create/edit files in the working tree and run Python/JS builds + tests. The human reviews and branches afterward.',
  '- Match existing code conventions in each repo (read neighbors first). Python: stdlib + pyyaml, uv. ainu-mcp worker tests are .mjs (NOT .ts).',
  '- RUN the build/tests you can and REPORT pass/fail HONESTLY. If blocked, report the blocker — never fake success or invent linguistic data.',
  '- For linguistic grounding, use the Ainu MCP tools via ToolSearch (e.g. select:mcp__claude_ai_Ainu_MCP__dictionary_lookup,mcp__claude_ai_Ainu_MCP__corpus_search,mcp__claude_ai_Ainu_MCP__morpheme_search) and the local dictionaries under ' + MDB + ' submodules.',
].join('\n')

const WRITE_REPORT = {
  type: 'object', additionalProperties: false,
  properties: {
    files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      path: { type: 'string' }, action: { type: 'string', enum: ['created', 'modified', 'none'] }, summary: { type: 'string' } }, required: ['path', 'action', 'summary'] } },
    commands_run: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      cmd: { type: 'string' }, exit_ok: { type: 'boolean' }, output_tail: { type: 'string' } }, required: ['cmd', 'exit_ok', 'output_tail'] } },
    build_passed: { type: ['boolean', 'null'] },
    tests_passed: { type: ['boolean', 'null'] },
    blockers: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['files', 'commands_run', 'build_passed', 'tests_passed', 'blockers', 'notes'],
}

const CONTRACT = {
  type: 'object', additionalProperties: false,
  properties: {
    build_cmd: { type: 'string' }, test_cmd_python: { type: 'string' }, test_cmd_web: { type: 'string' },
    py_pkg_layout: { type: 'string' },
    json_outputs: { type: 'array', items: { type: 'string' } },
    api_route_dir: { type: 'string' }, export_sqlite_paths: { type: 'array', items: { type: 'string' } },
    test_convention: { type: 'string' },
    integration_points: { type: 'array', items: { type: 'string' } },
    schema_notes: { type: 'string' }, risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['build_cmd', 'test_cmd_python', 'py_pkg_layout', 'json_outputs', 'api_route_dir', 'integration_points', 'schema_notes', 'risks'],
}

const HARVEST_REPORT = {
  type: 'object', additionalProperties: false,
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    total_candidates: { type: 'number' }, sgpl_count: { type: 'number' }, possessed_count: { type: 'number' }, conflict_count: { type: 'number' },
    coverage_note: { type: 'string' },
    sample: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      base: { type: 'string' }, derived: { type: 'string' }, relation: { type: 'string' }, parser_rule: { type: 'string' }, confidence: { type: 'number' }, raw_span: { type: 'string' } },
      required: ['base', 'derived', 'relation', 'confidence'] } },
    build_passed: { type: ['boolean', 'null'] }, blockers: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
  required: ['files', 'total_candidates', 'sgpl_count', 'possessed_count', 'sample', 'blockers', 'notes'],
}

const HARVEST_VERDICT = {
  type: 'object', additionalProperties: false,
  properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    base: { type: 'string' }, derived: { type: 'string' }, relation: { type: 'string' },
    verdict: { type: 'string', enum: ['real', 'wrong', 'uncertain'] }, reason: { type: 'string' }, evidence: { type: 'string' } },
    required: ['base', 'derived', 'verdict', 'reason'] } },
    precision_estimate: { type: 'number' }, systematic_issues: { type: 'array', items: { type: 'string' } } },
  required: ['items'],
}

const RULE_DRAFT = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['possession', 'plural', 'derivation'] },
    rules: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      rule_id: { type: 'string' }, conditions: { type: 'string' }, operation: { type: 'string' }, realization: { type: 'string' }, example: { type: 'string' }, source: { type: 'string' } },
      required: ['rule_id', 'conditions', 'operation', 'realization', 'example'] } },
    exceptions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      lemma: { type: 'string' }, relation_type: { type: 'string' }, form: { type: 'string' }, reason: { type: 'string' } },
      required: ['lemma', 'relation_type', 'form'] } },
    feature_bundle_spec: { type: 'string' },
    test_cases: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      input: { type: 'string' }, features: { type: 'string' }, expected: { type: 'string' } }, required: ['input', 'expected'] } },
    sources_cited: { type: 'array', items: { type: 'string' } },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['kind', 'rules', 'exceptions', 'feature_bundle_spec', 'test_cases', 'sources_cited'],
}

const LING_VERIFY = {
  type: 'object', additionalProperties: false,
  properties: {
    lens: { type: 'string' }, kind: { type: 'string' },
    overgeneration_risks: { type: 'array', items: { type: 'string' } },
    missing_cases: { type: 'array', items: { type: 'string' } },
    orthography_issues: { type: 'array', items: { type: 'string' } },
    wrong_rules: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string', enum: ['sound', 'fixable', 'unsound'] },
    required_fixes: { type: 'array', items: { type: 'string' } },
  },
  required: ['lens', 'kind', 'verdict', 'required_fixes'],
}

const BUILD_REPORT = {
  type: 'object', additionalProperties: false,
  properties: {
    build_passed: { type: 'boolean' }, tests_passed: { type: ['boolean', 'null'] },
    generated_count: { type: 'number' }, precision: { type: ['number', 'null'] }, recall: { type: ['number', 'null'] },
    by_provenance: { type: 'string' },
    sample_forms: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } }, blockers: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
  required: ['build_passed', 'generated_count', 'sample_forms', 'failures', 'blockers', 'notes'],
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

log('morphogen: implementing generative Ainu morphology in MDB; ainu-mcp proxies. Schema-first, harvest-as-evidence, separate realization layer.')

phase('Recon')
const contract = await agent(
  DESIGN + '\n\nROLE: Recon. Read the MDB repo at ' + MDB + ' thoroughly (do NOT modify anything). Produce a precise BUILD CONTRACT every later builder will rely on: exact build command (how the JSON outputs are rebuilt; read morpheme_db/cli.py, lexeme_db/cli.py, pyproject); python + web test commands and conventions (look at morpheme_db/tests, e.g. test_valency.py); the python package layout (where a new morphology subpackage should live next to valency.py); the JSON output files and the export_sqlite.py files and their D1 schema versioning; the SvelteKit API route dir + shape of an existing +server.ts (e.g. web/src/routes/api/lexemes/+server.ts) and how it loads bundled data (web/src/lib/server/database.ts); exact integration points for a new sidecar schema, a harvester, a generation engine, a new build step, a /api/forms route; and schema_notes on how lexeme_db/schema.py expresses provenance so the new forms schema mirrors it. Return the structured contract.',
  { schema: CONTRACT, label: 'recon', effort: 'high' },
)
if (!contract) { log('recon failed; aborting'); return { error: 'recon failed' } }

phase('Schema')
const schemaReport = await agent(
  DESIGN + '\n\nBUILD CONTRACT:\n' + j(contract) + '\n\nROLE: Schema author. Implement the SIDECAR forms/relations schema in MDB (NO new Entry fields; generated forms are NOT Entry rows). Create a new python module (e.g. ' + MDB + '/morpheme_db/morphology/schema.py or wherever the contract says it belongs) defining dataclasses: LexicalRelation (typed relation_type), AttestedForm (surface, source_span, parser_rule, confidence, status, conflict_bucket), GeneratedForm/InflectedForm (lemma_id, lexeme_id, feature_bundle, surface, analysis, source, confidence, rule_id, attested_ref). Mirror the lexeme bank provenance precedent. Add JSON (de)serialization consistent with the repo existing schema modules, and define the SQLite/D1 export shape (a parallel table artifact, do not mutate existing tables). Add a unit test mirroring the existing test convention that round-trips the dataclasses and validates required fields. RUN the python tests for the new module and report pass/fail. Do NOT touch git.',
  { schema: WRITE_REPORT, label: 'schema', effort: 'high' },
)

phase('Harvest')
const harvest = await agent(
  DESIGN + '\n\nBUILD CONTRACT:\n' + j(contract) + '\n\nROLE: Harvester. Implement ' + MDB + '/morpheme_db/morphology/harvest.py (or per contract) that mines the LEXEME BANK (lexeme_db/output/lexeme_bank.json) for CANDIDATE EVIDENCE — NOT gold: sg/pl pairs from [単]/[複]/単は/複は annotations (489 lexemes; the data is fragmented — the partner form often sits in a separate gloss array element and is in KANA, so you must cross-reference kana<->latin via the lexeme kana/lemma or the ainconv tool). Capture source_span + parser_rule + confidence + conflict_bucket. Also absolute<->possessed links (223 lexemes carry 所属形/…の; the morpheme bank has paired forms like sapa/sapaha). Emit AttestedForm + LexicalRelation rows (status=raw) to a JSON artifact plus a coverage/conflict report. Add a small unit test on hand-checked fixtures. RUN it and report real counts. Return the structured report INCLUDING a representative sample of ~24 harvested pairs (mix of sg/pl + possessed, mix of confidences). Do NOT touch git; do NOT promote anything to gold.',
  { schema: HARVEST_REPORT, label: 'harvest', effort: 'high' },
)

phase('Verify harvest')
const sample = (harvest && harvest.sample) ? harvest.sample : []
const slices = chunk(sample, 4)
const harvestVerdicts = (await parallel(slices.map((slice, i) => () => agent(
  DESIGN + '\n\nROLE: Adversarial harvest verifier (slice ' + (i + 1) + '/' + slices.length + '). For EACH candidate pair below, decide if the morphological relation is REAL by grounding against dictionaries/corpus — NOT by intuition. Use the Ainu MCP tools (ToolSearch: select:mcp__claude_ai_Ainu_MCP__dictionary_lookup,mcp__claude_ai_Ainu_MCP__dictionary_reverse_lookup,mcp__claude_ai_Ainu_MCP__corpus_search,mcp__claude_ai_Ainu_MCP__morpheme_search) and/or the local dictionary submodules under ' + MDB + '. Default to uncertain or wrong if you cannot find support; the harvest is noisy. For sg/pl: confirm the two forms are a singular/plural counterpart pair. For possessed: confirm derived is the possessed/concrete form of base. Report a precision estimate for this slice and any SYSTEMATIC parser issues (e.g. kana mis-mapping, wrong field captured).\n\nCANDIDATES:\n' + j(slice),
  { schema: HARVEST_VERDICT, label: 'verify-harvest:' + (i + 1), phase: 'Verify harvest', effort: 'medium' },
)))).filter(Boolean)

phase('Rule layer')
const harvestEvidenceNote = 'Harvest produced ~' + (harvest ? harvest.total_candidates : 0) + ' candidates (' + (harvest ? harvest.sgpl_count : 0) + ' sg/pl, ' + (harvest ? harvest.possessed_count : 0) + ' possessed). Adversarial-verification systematic issues: ' + j(harvestVerdicts.flatMap((v) => v.systematic_issues || [])) + '. Treat harvested forms as evidence to ground/seed rules + exceptions, NOT as truth.'
const ruleKinds = [
  { kind: 'possession', brief: 'Possessive (concrete) noun forms: the -hV/-Vhi/-i/-u/-e suffix allomorphy conditioned by stem-final segment AND noun class. Cover V-final vs C-final (epenthesis), the -i/-hi/-u/-hu/-e/-he/-a/-ha distribution, location nouns, obligatorily-possessed (kinship/body-part) nouns, and irregular/suppletive possessed forms (-> exceptions). Cite Tamura 1988/1996 and Bugaeva.' },
  { kind: 'plural', brief: 'Plural VERB forms. Partition into productive -pa suffixation (with sandhi), reduplication, and SUPPLETION (an/oka, a/rok, as/roski, ek/arki, arpa/paye, ray/ronnu...). Suppletives MUST come from harvest/exceptions, not rules. Model verbal number as ROLE-SENSITIVE: transitive object-number -pa vs intransitive subject-number. Do NOT conflate with personal agreement (deferred).' },
  { kind: 'derivation', brief: 'Derivations: causative (-re/-e/-te allomorphy by final segment), applicative (e-/ko-/o-), reflexive/reciprocal (yay-/u-), nominalizers (-p/-pe/-i; ABSORB the a=e-...-p(e) data from ' + MORPHDATA + '). Surface form comes from the NEW realization layer; argument-structure semantics may CALL forward valency composition (morpheme_db/valency.py) through a narrow interface.' },
]
const ruleDrafts = (await parallel(ruleKinds.map((rk) => () => agent(
  DESIGN + '\n\n' + harvestEvidenceNote + '\n\nROLE: Linguistic rule author for ' + rk.kind + '. ' + rk.brief + '\nProduce a DECLARATIVE rule table (surface-realization layer — NOT valency Rule ops) with a structured feature-bundle spec, an explicit typed-exception list (seeded from harvested/attested suppletions + irregulars), concrete test cases (input + features -> expected surface, orthography-correct incl. <n>-before-p), and cited sources. Ground forms against dictionaries/corpus via the Ainu MCP tools (ToolSearch) and the local dictionary submodules under ' + MDB + '. ANALYSIS ONLY — do NOT write files yet; return the structured draft.',
  { schema: RULE_DRAFT, label: 'rules:' + rk.kind, phase: 'Rule layer', effort: 'high' },
)))).filter(Boolean)

const lenses = ['attestation', 'overgeneration', 'orthography']
const lingVerdicts = (await parallel(ruleDrafts.flatMap((d) => lenses.map((lens) => () => agent(
  DESIGN + '\n\nROLE: Adversarial linguistic verifier — ' + lens + ' lens, ' + d.kind + ' rules. Try to BREAK this draft. attestation: do the rules + test cases match forms actually attested in dictionaries/corpus (check via Ainu MCP tools)? Flag invented forms. overgeneration: where do rules produce forms that should be blocked (irregular/suppletive/non-possessable nouns; intransitive vs transitive plural)? orthography: are all outputs in the house orthography (morphophonemic <n> before p, e.g. huskoanpe; correct accents)? Return structured verdict + required fixes. Default skeptical.\n\nDRAFT:\n' + j(d),
  { schema: LING_VERIFY, label: 'ling-verify:' + d.kind + ':' + lens, phase: 'Rule layer', effort: 'high' },
))))).filter(Boolean)

const persistRules = await agent(
  DESIGN + '\n\nBUILD CONTRACT:\n' + j(contract) + '\n\nROLE: Rule persister. PERSIST the verified rule layer to MDB seed files (e.g. ' + MDB + '/morpheme_db/seed/generation/possession.json, plural.json, derivation.json, exceptions.json — per contract). Apply ALL required_fixes from the linguistic verification before writing; DROP or flag any rule marked unsound; move overgeneration cases into typed exceptions (blocks_rule_output / suppletive_plural_of / preferred_attested_form). Keep forms orthography-correct. Write clean declarative JSON matching the schema module. Add a validation test that loads the seed files and checks structural integrity + that provided test_cases parse. RUN it; report pass/fail. Do NOT touch git.\n\nVERIFIED RULE DRAFTS:\n' + j(ruleDrafts) + '\n\nLINGUISTIC VERIFICATION VERDICTS (apply required_fixes):\n' + j(lingVerdicts),
  { schema: WRITE_REPORT, label: 'persist-rules', effort: 'high' },
)

phase('Engine')
const engine = await agent(
  DESIGN + '\n\nBUILD CONTRACT:\n' + j(contract) + '\n\nROLE: Engine author. Implement ' + MDB + '/morpheme_db/morphology/generation.py: a feature-driven generate(lemma_or_morpheme_id, feature_bundle) that (1) consults typed exceptions/attested store first, (2) else applies declarative realization rules, (3) runs phonological post-processing incl. house orthography (<n>-before-p, accents/sandhi), (4) for derivations calls forward valency composition (morpheme_db/valency.py) for argument-structure semantics through a NARROW interface (do NOT route realization through valency). Each result carries {surface, feature_bundle, analysis, source=rule|attested|exception, confidence, rule_id, attested_ref}. Add a CLI subcommand (mirror morpheme_db/cli.py) to generate + emit the generated_forms artifact. Add unit tests mirroring morpheme_db/tests/test_valency.py covering possession, plural (a suppletive + a -pa case), a derivation, and an orthography case. RUN the tests and report pass/fail honestly. Do NOT touch git.',
  { schema: WRITE_REPORT, label: 'engine', effort: 'xhigh' },
)

phase('Validation build')
const build = await agent(
  DESIGN + '\n\nBUILD CONTRACT:\n' + j(contract) + '\n\nROLE: Validation + build. Run the generator over the bank (the CLI subcommand) to produce the generated_forms artifact (JSON + the D1/SQLite export, extend export_sqlite.py as needed). COMPUTE precision/recall of rule-generated forms against the REVIEWED harvest subset (attested_form rows verified real + curated exceptions) — report numbers and a breakdown by provenance. Surface the worst rule misses. RUN the full python test suite + the build. Report honestly incl. failures/blockers and a handful of sample generated forms (with provenance). Do NOT touch git.',
  { schema: BUILD_REPORT, label: 'validation-build', effort: 'high' },
)

phase('Serve & proxy')
const serveResults = (await parallel([
  () => agent(
    DESIGN + '\n\nBUILD CONTRACT:\n' + j(contract) + '\n\nROLE: MDB API author. Add a SvelteKit route ' + contract.api_route_dir + '/forms/+server.ts (GET /api/forms) that does LOOKUP over the precomputed generated_forms artifact (bundled JSON / D1, same loading pattern as the existing /api/lexemes route + web/src/lib/server/database.ts). Query params: lemma, category, feature, relation, provenance, min_conf, limit. Response mirrors the other /api endpoints shape (query/total/returned/results). Wire the bundled data loading. Run the web typecheck/tests you can. Report honestly. Do NOT touch git.',
    { schema: WRITE_REPORT, label: 'mdb-api', phase: 'Serve & proxy', effort: 'high' },
  ),
  () => agent(
    DESIGN + '\n\nROLE: ainu-mcp proxy author (repo ' + MCP + '). There is already a feat/morphology-tools branch with worker/src/tools/morphology.ts exposing morphology_search + morphology_reverse_lookup over the Turso morphology_fts table. ADD a new proxy tool morphology_forms(lemma, category?, feature?, relation?, provenance?, limit?) that calls MDB /api/forms via the env.MDB service binding (mirror worker/src/tools/morpheme.ts fetchJson(env.MDB, https://mdb.aynu.org/api/forms?...) pattern). Keep existing tool shapes. Register it in worker/src/mcp.ts. Add a .mjs test (NOT .ts) mirroring the morpheme/localizations test style. Update the README morphology section. Run tsc + the worker tests; report pass/fail honestly. Do NOT touch git.',
    { schema: WRITE_REPORT, label: 'mcp-proxy', phase: 'Serve & proxy', effort: 'high' },
  ),
])).filter(Boolean)

phase('Review')
const dims = ['correctness & build/tests', 'linguistic soundness & orthography', 'schema hygiene (no Entry pollution, provenance, sidecar)', 'integration & API/proxy contract']
const reviews = (await parallel(dims.map((dim) => () => agent(
  DESIGN + '\n\nROLE: Adversarial reviewer — ' + dim + '. Review the working-tree changes across BOTH repos (' + MDB + ' and ' + MCP + ') for this dimension. Read the actual modified files; run builds/tests/typecheck where cheap to confirm claims rather than trusting reports. Be specific (file + issue + fix), rank by severity, and give a blunt ready_to_pr verdict. For linguistic soundness, spot-check several generated forms against dictionaries/corpus via the Ainu MCP tools.',
  { schema: REVIEW, label: 'review:' + dim, phase: 'Review', effort: 'high' },
)))).filter(Boolean)

return {
  contract,
  schema: schemaReport,
  harvest: { counts: harvest, verification: harvestVerdicts.map((v) => ({ precision: v.precision_estimate, issues: v.systematic_issues })) },
  rules: { drafts: ruleDrafts.map((d) => ({ kind: d.kind, rule_count: (d.rules || []).length, exceptions: (d.exceptions || []).length, open_questions: d.open_questions })), verification: lingVerdicts.map((v) => ({ kind: v.kind, lens: v.lens, verdict: v.verdict, fixes: v.required_fixes })), persisted: persistRules },
  engine,
  validation: build,
  serve: serveResults,
  review: reviews,
}
