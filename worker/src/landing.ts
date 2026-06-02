/**
 * Human-facing landing page (GET /) and an LLM-readable doc (GET /llms.txt)
 * for mcp.aynu.org. Self-contained HTML + inline CSS — no build step, no assets
 * beyond Google Fonts. Visual language matches the aynu.org family (tu itak /
 * itak.aynu.org): indigo-on-ecru, Shippori Mincho headings, the `sik` eye mark
 * and `moreu` flourishes, tactile buttons, dark mode.
 */

const ENDPOINT = "https://mcp.aynu.org/mcp";

// Favicon: a plain letter monogram in the family palette (no pictorial mark).
const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#1d3461"/><text x="12" y="17.2" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="15" font-weight="700" fill="#f4ece0">a</text></svg>`,
  );

// `moreu` (モレウ) flourish — a calm mirrored spiral divider.
const MOREU = `<svg class="moreu" viewBox="0 0 200 24" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
<line x1="0" y1="12" x2="78" y2="12"/><line x1="122" y1="12" x2="200" y2="12"/>
<path d="M86 12c0-5 4-8 8-7s5 7 1 8-5-3-2-4" fill="none"/>
<path d="M114 12c0-5-4-8-8-7s-5 7-1 8 5-3 2-4" fill="none"/>
<circle cx="100" cy="12" r="2.1" class="sik-dot"/>
</svg>`;

const TOOLS = [
  ["Corpus", "corpus_search · corpus_stats", "Search ~195k aligned Ainu/Japanese sentences by text, translation, dialect, or author."],
  ["Dictionaries", "dictionary_lookup · reverse_lookup · list", "Look up words across 80+ dictionaries (Kayano, Tamura, Chiri, Nakagawa, Ota…)."],
  ["Grammar", "grammar_search · grammar_list", "Search the grammar bibliography and full text of transcribed sources."],
  ["Scripts", "convert_script · detect_script · script_all", "Convert Ainu between Latin, Katakana, and Cyrillic (ainconv)."],
  ["Glossary", "glossary_search · add · update · audit", "Read and edit the Itak-uoeroskip glossary (itak.aynu.org) at its source."],
  ["Research", "entry_research", "One call composing scripts + glossary + dictionaries + corpus for a word."],
];

function toolCards(): string {
  return TOOLS.map(
    ([name, tools, desc]) => `<article class="card">
      <h3>${name}</h3>
      <code class="tools">${tools}</code>
      <p>${desc}</p>
    </article>`,
  ).join("\n");
}

export const LANDING_HTML = `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ainu-mcp · the Ainu-language toolchain for your AI</title>
<meta name="description" content="A Model Context Protocol server for the Ainu language: corpus, dictionaries, grammar, script conversion, and the Itak-uoeroskip glossary — one endpoint, sign in with GitHub.">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@500;800&family=Inter:wght@400;500;700;800&family=BIZ+UDPGothic:wght@400;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#f4ece0; --surface:#fbf6ee; --surface-alt:#ece0cd;
  --primary:#1d3461; --primary-edge:#122444; --primary-ink:#fbf6ee;
  --accent:#9c2a2a; --text:#1f2430; --soft:#5a5346; --faint:#908674;
  --border:#d8cbb8; --border-strong:#b59c79;
  --sh-2:0 2px 8px rgba(58,44,32,.12); --sh-3:0 14px 30px rgba(58,44,32,.16);
  --ff-display:'Shippori Mincho B1',serif;
  --ff-ui:'Inter','BIZ UDPGothic',sans-serif;
  --ff-kana:'BIZ UDPGothic','Inter',sans-serif;
  --ff-mono:'IBM Plex Mono',ui-monospace,monospace;
  --r-sm:10px; --r-md:16px; --r-lg:22px; --r-pill:999px; --depth:4px;
  --maxw:980px;
}
@media (prefers-color-scheme:dark){:root[data-theme=auto]{
  --bg:#14171f; --surface:#1b1f2a; --surface-alt:#222838;
  --primary:#7da7d9; --primary-edge:#27374f; --primary-ink:#0e1118;
  --accent:#e0857f; --text:#ece3d4; --soft:#b3a892; --faint:#7e8597;
  --border:#3f4658; --border-strong:#525a6f;
  --sh-2:0 2px 8px rgba(0,0,0,.4); --sh-3:0 14px 30px rgba(0,0,0,.5);
}}
:root[data-theme=dark]{
  --bg:#14171f; --surface:#1b1f2a; --surface-alt:#222838;
  --primary:#7da7d9; --primary-edge:#27374f; --primary-ink:#0e1118;
  --accent:#e0857f; --text:#ece3d4; --soft:#b3a892; --faint:#7e8597;
  --border:#3f4658; --border-strong:#525a6f;
  --sh-2:0 2px 8px rgba(0,0,0,.4); --sh-3:0 14px 30px rgba(0,0,0,.5);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--ff-ui);line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 20px}
a{color:var(--primary);text-decoration:none}
a:hover{text-decoration:underline}
h1,h2,h3{font-family:var(--ff-display);line-height:1.15;letter-spacing:.01em;font-weight:800;margin:0}
:lang(ain),.kana{font-family:var(--ff-kana)}
code,kbd,pre{font-family:var(--ff-mono)}

header{position:sticky;top:0;z-index:10;backdrop-filter:blur(10px);background:color-mix(in srgb,var(--bg) 86%,transparent);border-bottom:1px solid var(--border)}
.bar{display:flex;align-items:center;gap:14px;height:62px}
.brand{display:flex;align-items:center;gap:9px;font-family:var(--ff-display);font-weight:800;font-size:1.15rem;color:var(--text)}
.brand svg{width:26px;height:26px;color:var(--primary)}
.bar nav{margin-left:auto;display:flex;align-items:center;gap:20px;font-size:.93rem}
.bar nav a{color:var(--soft);font-weight:500}
.toggle{cursor:pointer;border:1px solid var(--border-strong);background:var(--surface);color:var(--soft);border-radius:var(--r-pill);width:34px;height:34px;font-size:1rem;display:grid;place-items:center}
@media(max-width:620px){.bar nav .navlink{display:none}}

.hero{text-align:center;padding:78px 0 40px}
.kicker{display:inline-flex;align-items:center;gap:8px;font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);padding:6px 14px;border-radius:var(--r-pill)}
.hero h1{font-size:clamp(2.1rem,5.5vw,3.4rem);margin:22px 0 0}
.hero p.lede{font-size:1.18rem;color:var(--soft);max-width:38em;margin:18px auto 0}
.endpoint{display:inline-flex;align-items:center;gap:12px;margin-top:30px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);padding:12px 12px 12px 20px;box-shadow:var(--sh-2)}
.endpoint code{font-size:1.02rem;color:var(--text)}
.btn{cursor:pointer;border:0;font-family:var(--ff-ui);font-weight:800;font-size:.95rem;color:var(--primary-ink);background:var(--primary);border-radius:var(--r-md);padding:11px 18px;box-shadow:0 var(--depth) 0 var(--primary-edge);transform:translateY(0);transition:transform .12s,box-shadow .12s,filter .12s}
.btn:hover{filter:brightness(1.05);text-decoration:none}
.btn:active{transform:translateY(var(--depth));box-shadow:0 0 0 var(--primary-edge)}
.signin{margin-top:20px;font-size:.95rem;color:var(--faint)}
.signin b{color:var(--soft)}

.moreu{display:block;width:230px;height:24px;margin:54px auto;color:var(--border-strong)}
.moreu line{stroke:currentColor;stroke-width:1.5;opacity:.55}
.moreu path{stroke:currentColor;stroke-width:1.6}
.moreu .sik-dot{fill:var(--primary)}

section{padding:8px 0}
.sec-head{text-align:center;margin-bottom:30px}
.sec-head h2{font-size:1.7rem}
.sec-head p{color:var(--soft);margin:8px 0 0}

.connect{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:22px;box-shadow:var(--sh-2)}
.panel h3{font-size:1.1rem;margin-bottom:12px}
pre{background:var(--surface-alt);border:1px solid var(--border);border-radius:var(--r-sm);padding:12px 14px;margin:0;font-size:.84rem;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.panel p{color:var(--soft);font-size:.92rem;margin:12px 0 0}

.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:20px 22px;box-shadow:var(--sh-2)}
.card h3{font-size:1.15rem}
.card .tools{display:block;color:var(--accent);font-size:.78rem;margin:8px 0 10px}
.card p{margin:0;color:var(--soft);font-size:.93rem}

.access{background:var(--surface-alt);border:1px solid var(--border);border-radius:var(--r-lg);padding:26px 28px;display:grid;grid-template-columns:1fr 1fr;gap:22px}
@media(max-width:620px){.access{grid-template-columns:1fr}}
.access h3{font-size:1.05rem;display:flex;align-items:center;gap:8px}
.access p{color:var(--soft);margin:8px 0 0;font-size:.95rem}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}

footer{margin-top:70px;border-top:1px solid var(--border);padding:34px 0 60px;color:var(--faint);font-size:.9rem}
footer .wrap{display:flex;flex-wrap:wrap;gap:18px 28px;align-items:center}
footer a{color:var(--soft)}
footer .spacer{margin-left:auto}
</style>
</head>
<body>
<header><div class="wrap bar">
  <span class="brand"><span>ainu-mcp</span></span>
  <nav>
    <a class="navlink" href="#connect">Connect</a>
    <a class="navlink" href="#tools">Tools</a>
    <a class="navlink" href="/llms.txt">llms.txt</a>
    <button class="toggle" id="themeBtn" title="Toggle theme" aria-label="Toggle theme">◐</button>
  </nav>
</div></header>

<main>
<div class="wrap">
  <section class="hero">
    <span class="kicker">Model Context Protocol server</span>
    <h1>The Ainu-language toolchain,<br>for your AI.</h1>
    <p class="lede">Corpus, dictionaries, grammar, script conversion, and the
      <span class="kana">イタㇰ</span> Itak-uoeroskip glossary — one MCP endpoint your
      assistant can search and edit.</p>
    <div class="endpoint">
      <code id="ep">${ENDPOINT}</code>
      <button class="btn" id="copyBtn">Copy</button>
    </div>
    <p class="signin">Connect it to Claude or ChatGPT and <b>sign in with GitHub</b> — no API keys.</p>
  </section>

  ${MOREU}

  <section id="connect">
    <div class="sec-head"><h2>Connect in a minute</h2>
      <p>Add the endpoint as a custom MCP connector; your client opens a GitHub sign-in once.</p></div>
    <div class="connect">
      <div class="panel"><h3>Claude Code</h3>
        <pre>claude mcp add --transport http \\
  ainu ${ENDPOINT}</pre>
        <p>Then run <code>/mcp</code> and authenticate in the browser.</p></div>
      <div class="panel"><h3>Claude Desktop</h3>
        <pre>Settings → Connectors → Add custom
URL: ${ENDPOINT}</pre>
        <p>Approve the GitHub sign-in popup; tools appear automatically.</p></div>
      <div class="panel"><h3>ChatGPT &amp; others</h3>
        <pre>Add an MCP / custom connector
URL: ${ENDPOINT}</pre>
        <p>Any MCP client that speaks Streamable HTTP + OAuth works.</p></div>
    </div>
  </section>

  ${MOREU}

  <section id="tools">
    <div class="sec-head"><h2>What it can do</h2>
      <p>19 tools across six families, served from one place.</p></div>
    <div class="grid">
      ${toolCards()}
    </div>
  </section>

  ${MOREU}

  <section>
    <div class="access">
      <div>
        <h3><span class="dot" style="background:var(--success,#1b6b42)"></span> Anyone with GitHub</h3>
        <p>Sign in and you get the full read/reference surface — corpus, dictionaries,
          grammar, script conversion, glossary lookup, and <code>entry_research</code>.</p>
      </div>
      <div>
        <h3><span class="dot" style="background:var(--accent)"></span> aynumosir members</h3>
        <p>Members of the <b>aynumosir</b> organization additionally get the glossary
          <b>write</b> and maintenance tools — edit entries at the source, safely.</p>
      </div>
    </div>
  </section>
</div>
</main>

<footer><div class="wrap">
  <span class="brand" style="font-size:1rem"><span>ainu-mcp</span></span>
  <a href="https://itak.aynu.org">itak.aynu.org</a>
  <a href="/llms.txt">llms.txt</a>
  <span class="spacer"></span>
  <span>part of the <a href="https://aynu.org">aynu.org</a> family · motifs in homage to Ainu <span class="kana">モレウ</span> design</span>
</div></footer>

<script>
(function(){
  var root=document.documentElement, btn=document.getElementById('themeBtn');
  var saved=localStorage.getItem('theme'); if(saved) root.dataset.theme=saved;
  btn.addEventListener('click',function(){
    var cur=root.dataset.theme;
    var dark=cur==='dark'||(cur==='auto'&&matchMedia('(prefers-color-scheme:dark)').matches);
    root.dataset.theme=dark?'light':'dark';
    localStorage.setItem('theme',root.dataset.theme);
  });
  var copy=document.getElementById('copyBtn');
  copy.addEventListener('click',function(){
    navigator.clipboard.writeText(document.getElementById('ep').textContent).then(function(){
      var t=copy.textContent; copy.textContent='Copied ✓';
      setTimeout(function(){copy.textContent=t;},1400);
    });
  });
})();
</script>
</body>
</html>`;

/**
 * Branded error / status page — shared by the worker's human-facing routes
 * (onError 500, notFound 404, and the OAuth-flow failure branches). Same visual
 * language as the landing page (indigo-on-ecru, Shippori headings, `moreu`
 * flourish, dark mode) but a single self-contained centred card. `detail` is
 * caller-controlled copy and must already be safe/escaped — never interpolate
 * raw user input or error stacks here.
 */
export function renderErrorPage(status: number, heading: string, detail: string): string {
  return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${status} · ainu-mcp</title>
<meta name="robots" content="noindex">
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@500;800&family=Inter:wght@400;500;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#f4ece0; --surface:#fbf6ee; --primary:#1d3461; --primary-ink:#fbf6ee;
  --primary-edge:#122444; --accent:#9c2a2a; --text:#1f2430; --soft:#5a5346;
  --faint:#908674; --border:#d8cbb8; --border-strong:#b59c79;
  --sh-3:0 14px 30px rgba(58,44,32,.16);
  --ff-display:'Shippori Mincho B1',serif; --ff-ui:'Inter',sans-serif;
  --ff-mono:'IBM Plex Mono',ui-monospace,monospace; --r-lg:22px; --r-md:16px; --depth:4px;
}
@media (prefers-color-scheme:dark){:root[data-theme=auto]{
  --bg:#14171f; --surface:#1b1f2a; --primary:#7da7d9; --primary-ink:#0e1118;
  --primary-edge:#27374f; --accent:#e0857f; --text:#ece3d4; --soft:#b3a892;
  --faint:#7e8597; --border:#3f4658; --border-strong:#525a6f;
  --sh-3:0 14px 30px rgba(0,0,0,.5);
}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
  background:var(--bg);color:var(--text);font-family:var(--ff-ui);line-height:1.6;
  -webkit-font-smoothing:antialiased}
.card{max-width:460px;width:100%;text-align:center;background:var(--surface);
  border:1px solid var(--border);border-radius:var(--r-lg);box-shadow:var(--sh-3);
  padding:44px 38px 36px}
.code{font-family:var(--ff-mono);font-size:.82rem;font-weight:500;letter-spacing:.14em;
  text-transform:uppercase;color:var(--accent);
  background:color-mix(in srgb,var(--accent) 12%,transparent);
  padding:6px 14px;border-radius:999px;display:inline-block}
h1{font-family:var(--ff-display);font-weight:800;font-size:1.6rem;line-height:1.2;
  margin:20px 0 0}
p{color:var(--soft);margin:14px 0 0;font-size:1rem}
.moreu{display:block;width:200px;height:24px;margin:26px auto 6px;color:var(--border-strong)}
.moreu line{stroke:currentColor;stroke-width:1.5;opacity:.55}
.moreu path{stroke:currentColor;stroke-width:1.6;fill:none}
.moreu .sik-dot{fill:var(--primary)}
.home{display:inline-block;margin-top:26px;font-family:var(--ff-ui);font-weight:800;
  font-size:.95rem;color:var(--primary-ink);background:var(--primary);text-decoration:none;
  border-radius:var(--r-md);padding:11px 20px;box-shadow:0 var(--depth) 0 var(--primary-edge);
  transition:transform .12s,box-shadow .12s,filter .12s}
.home:hover{filter:brightness(1.05)}
.home:active{transform:translateY(var(--depth));box-shadow:0 0 0 var(--primary-edge)}
</style>
</head>
<body>
<main class="card">
  <span class="code">${status} · ainu-mcp</span>
  <h1>${heading}</h1>
  <p>${detail}</p>
  ${MOREU}
  <a class="home" href="/">Back to ainu-mcp</a>
</main>
</body>
</html>`;
}

export const LLMS_TXT = `# ainu-mcp

> A Model Context Protocol (MCP) server for the Ainu language. One endpoint
> exposes corpus search + word frequencies, multi-dictionary lookup, grammar
> references, script conversion, and read/write access to the Itak-uoeroskip
> glossary.

Endpoint (Streamable HTTP): ${ENDPOINT}
Transport: MCP over Streamable HTTP (legacy SSE at /sse)
Auth: OAuth 2.1 — "Sign in with GitHub". Unauthenticated requests get 401 with
  WWW-Authenticate pointing at the OAuth metadata, which MCP clients follow.

## Access
- Any authenticated GitHub user: read/reference tools.
- Members of the "aynumosir" GitHub org: also glossary write + maintenance tools.

## Connect
- Claude Code:   claude mcp add --transport http ainu ${ENDPOINT}
- Claude Desktop / ChatGPT: add a custom connector with URL ${ENDPOINT}
A browser GitHub sign-in happens once; the token is stored and reused.

## Tools
- corpus_search(query, lang=ain|jpn|any, dialect?, author?, limit?) — search ~195k aligned Ainu/Japanese sentences
- corpus_stats() — total sentences + dialect distribution
- corpus_word_frequency(word) — corpus frequency of a word: count, rank, stopword flag, totals (affix clitics normalized)
- corpus_frequency_list(limit?, offset?, include_stopwords?, min_count?) — ranked token frequency list (drop stopwords with include_stopwords=false)
- corpus_stopwords() — Ainu stopword list (from aynumosir/ainu-stopwords)
- dictionary_list() — list dictionaries with entry counts
- dictionary_lookup(word, dicts?, fields?, limit?) — substring lookup across any field of 80+ dictionaries
- dictionary_reverse_lookup(aynu, dicts?, limit?) — Ainu form -> Japanese/English glosses (exact then substring)
- grammar_list(kind?) — list grammar books/articles
- grammar_search(query, include_transcribed?, limit?) — filename/title/author + transcribed-fulltext search
- convert_script(text, from_script, to_script) — convert between latn/kana/cyrl
- detect_script(text) — detect latn/kana/cyrl
- script_all(text) — all three script renditions
- entry_research(word, ...) — composed: scripts + glossary + dictionaries + corpus for one word
- glossary_list_categories() — glossary sheet tabs with metadata
- glossary_list_entries(category, limit?, offset?) — page through a category
- glossary_get_entry(category, row) — one entry (+ row_hash for safe edits)
- glossary_search(query, fields?, category?, limit?) — substring search the glossary
- glossary_untranslated(category?, langs?, limit?) — rows missing target-language columns
- glossary_add_entry(category, fields)            [aynumosir members]
- glossary_update_entry(category, row, fields, expected_row_hash?)  [aynumosir members]
- glossary_audit()                                 [aynumosir members]
- glossary_missing_high_frequency(top_n?, min_count?)  [aynumosir members]
- glossary_refresh_site_cache(dry_run?)            [aynumosir members]

## Related
- itak.aynu.org — the Itak-uoeroskip glossary this server edits
- Part of the aynu.org family of Ainu-language tools
`;
