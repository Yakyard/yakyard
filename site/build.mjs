// Builds the Yakyard website into site/dist. Run: npm run site:build
// Plain Node, one dependency (marked) to turn the docs into pages.
// Set SITE_URL to the address the site will live at, so share cards get absolute links.
import { mkdir, readFile, writeFile, readdir, copyFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";
import { icon, yakMark } from "./src/icons.mjs";
import { homePage, pressPage, docsHubPage, notFoundPage, releasePages } from "./src/pages.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DIST = path.join(HERE, "dist");
const SITE_URL = (process.env.SITE_URL || "https://yakyard-site.workers.dev").replace(/\/$/, "");
const REPO = "https://github.com/yakyard/yakyard";
export const DEPLOY_URL = "https://deploy.workers.cloudflare.com/?url=https://github.com/yakyard/yakyard";
const VERSION = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")).version;

// Pages and Workers serve /x/index.html at /x/ and 308 /x to it, so every page URL we print ends in a slash.
// Paths to files (an asset extension) are left alone.
const FILE_EXT = /\.(css|js|mjs|json|webmanifest|xml|txt|ico|png|svg|webp|jpg|jpeg|gif|avif|woff2?|mp3|webm|ogg|wav|mp4|pdf|zip|html)$/i;
export function slashed(p) {
  const [, base, rest] = p.match(/^([^?#]*)(.*)$/);
  if (!base || base.endsWith("/") || FILE_EXT.test(base)) return p;
  return `${base}/${rest}`;
}

// ---------- assets ----------
async function copyDir(from, to, filter = () => true) {
  await mkdir(to, { recursive: true });
  for (const name of await readdir(from)) {
    const src = path.join(from, name);
    if ((await stat(src)).isDirectory()) await copyDir(src, path.join(to, name), filter);
    else if (filter(name)) await copyFile(src, path.join(to, name));
  }
}

const imgFiles = (await readdir(path.join(HERE, "static/img"))).filter((f) => f.endsWith(".webp"));
// "hero-light" -> [{w, file}], smallest first
function sizes(name) {
  const re = new RegExp(`^${name}-(\\d+)\\.webp$`);
  const list = imgFiles.map((f) => (f.match(re) ? { w: +f.match(re)[1], file: f } : null)).filter(Boolean);
  if (!list.length) throw new Error(`No web image for ${name}. Run python3 site/tools/images.py`);
  return list.sort((a, b) => a.w - b.w);
}
const SHOT_DIMS = {}; // filled from the original PNG headers
async function pngSize(file) {
  const b = await readFile(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
for (const dir of ["docs/screens", "docs/guide"]) {
  for (const f of await readdir(path.join(ROOT, dir))) {
    if (!f.endsWith(".png")) continue;
    const key = (dir.endsWith("guide") ? "guide-" : "") + f.replace(/\.png$/, "");
    SHOT_DIMS[key] = await pngSize(path.join(ROOT, dir, f));
  }
}

// <img> with srcset for a screenshot. opts: alt, sizes, cls, eager
export function shot(name, { alt, sz = "100vw", cls = "", eager = false } = {}) {
  const list = sizes(name);
  const dims = SHOT_DIMS[name];
  const src = list.find((s) => s.w >= 960) || list[list.length - 1];
  const srcset = list.map((s) => `/img/${s.file} ${s.w}w`).join(", ");
  return `<img src="/img/${src.file}" srcset="${srcset}" sizes="${sz}" width="${dims.w}" height="${dims.h}" alt="${esc(alt)}"${cls ? ` class="${cls}"` : ""}${eager ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"'}>`;
}
export function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------- layout ----------
const NAV = [
  ["/why", "Why"],
  ["/compare", "Compare"],
  ["/faq", "FAQ"],
  ["/docs", "Docs"],
  ["/press", "Press", "opt"],
];

let CSS_HREF = "/site.css";
let JS_HREF = "/site.js";
let MOTION_HREF = "/motion.js";

export function layout({ title, seoTitle = null, description, urlPath, og = "home", body, current = "", jsonld = null, home = false, noindex = false, ogType = "website" }) {
  const canonical = SITE_URL + slashed(urlPath);
  // the <title> can differ from the on-page H1; the brand suffix is only added when the name isn't there yet
  const shown = seoTitle ?? title;
  const fullTitle = urlPath === "/" || /yakyard/i.test(shown) ? shown : `${shown} · Yakyard`;
  const ld = (Array.isArray(jsonld) ? jsonld : jsonld ? [jsonld] : []).map((j) => `\n<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("");
  const ogUrl = `${SITE_URL}/og/${og}.png`;
  const nav = NAV.map(([href, label, cls]) => `<li${cls ? ` class="${cls}"` : ""}><a href="${href}"${current === href ? ' aria-current="page"' : ""}>${label}</a></li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="google-site-verification" content="ShLCnFfmQo0s-xHpGL5QxNrNFnBC62-aAmqJn3fPNpo">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? `<meta name="robots" content="noindex">` : `<link rel="canonical" href="${canonical}">`}
<meta name="theme-color" content="#fff8e6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#120f2e" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="Yakyard">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(fullTitle)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogUrl}">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/app-icon-180.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/fonts/RammettoOne-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/WixMadeforText-Variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${CSS_HREF}">${ld}
<script>document.documentElement.classList.add("js")</script>
<script src="${JS_HREF}" defer${home ? ` data-motion="${MOTION_HREF}"` : ""}></script>
</head>
<body${home ? ' class="home"' : ""}>
<a class="skip" href="#main">Skip to content</a>
<header class="nav" id="top">
  <div class="wrap">
    <a class="nav__logo" href="/" aria-label="Yakyard home"${home ? " data-yak-logo" : ""}>
      <span class="lockup">${yakMark({ tile: true, cls: "yak__svg lockup__icon" })}<img class="on-light" src="/brand/yakyard-wordmark.svg" alt="" width="119" height="26"><img class="on-dark" src="/brand/yakyard-wordmark-reverse.svg" alt="" width="119" height="26"></span>
    </a>
    <nav aria-label="Main"><ul>${nav}</ul></nav>
    <div class="nav__end">
      ${home ? `<span class="snd-wrap"><button class="snd" type="button" aria-pressed="true" title="Yak sound is on"><span class="snd__ic">${icon("speaker-high", "ic ic-on")}${icon("speaker-slash", "ic ic-off")}</span><span class="sr">Sound</span><span class="snd__txt" aria-hidden="true">Sound on</span></button></span>` : ""}
      <a class="nav__gh" href="${REPO}">${icon("github-logo")}<span>GitHub</span></a>
      <a class="btn btn--primary" href="${DEPLOY_URL}">Deploy to Cloudflare</a>
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
${footer()}
</body>
</html>
`;
}

function footer() {
  const col = (title, links) => `<div><h2>${title}</h2><ul>${links.map(([h, t]) => `<li><a href="${h}">${t}</a></li>`).join("")}</ul></div>`;
  return `<footer class="foot">
  <div class="wrap">
    <div class="foot__top">
      <div class="foot__brand">
        <img src="/brand/yakyard-wordmark-reverse.svg" alt="Yakyard" width="190" height="42" loading="lazy">
        <p>Free, open source team chat you run on your own Cloudflare account or your own server.</p>
      </div>
      ${col("Yakyard", [["/why", "Why Yakyard"], ["/compare", "Compare"], ["/pros-and-cons", "Pros and cons"], ["/faq", "FAQ"]])}
      ${col("Docs", [["/docs/setup", "Set it up"], ["/docs/guide", "How to use it"], ["/docs/technical", "Technical notes"], ["/docs/docker", "Your own server"], ["/docs/locked", "Locked conversations"], ["/sources", "Sources"]])}
      ${col("Project", [[REPO, "GitHub"], [`${REPO}/blob/main/LICENSE`, "License"], ["/press", "Press kit"], ["/releases/2.2.1", "Releases"], [`${REPO}/blob/main/SECURITY.md`, "Security"]])}
    </div>
    <div class="foot__base">
      <p><strong>Free forever. Made by QVINTA Ltd.</strong></p>
      <p>Yakyard isn't affiliated with or endorsed by Slack, Salesforce, Cloudflare or any other company named here.</p>
    </div>
  </div>
</footer>`;
}

// ---------- markdown docs ----------
const DOCS = {
  "WHY-YAKYARD.md": { out: "/why", og: "why", title: "Why Yakyard", seo: "Why Yakyard: team chat without the per-seat bill", nav: "/why", toc: true,
    description: "Team chat shouldn't be rent. Why we made Yakyard free and open source, on your own Cloudflare account or server, and who it isn't for.",
    lede: "Your team's chat is your team's history. Here's why we stopped renting ours." },
  "COMPARE.md": { out: "/compare", og: "compare", title: "Yakyard compared", seo: "Yakyard vs Slack, Teams, Mattermost and 6 more", nav: "/compare", wide: true,
    description: "Yakyard next to Slack, Teams, Google Chat, Discord, Mattermost, Rocket.Chat, Zulip, Campfire and Element. Prices checked on 21 November 2026.",
    lede: "Yakyard next to the nine chat apps teams actually choose between, with the places they beat it." },
  "FAQ.md": { out: "/faq", og: "faq", title: "Yakyard FAQ", seo: "Yakyard FAQ: cost, privacy, Slack history, license", nav: "/faq",
    description: "Straight answers about Yakyard: what it costs, who can read your messages, phone apps, Slack history, the license and support.",
    lede: "What it costs, who can read your messages, and what happens when something breaks." },
  "PROS-AND-CONS.md": { out: "/pros-and-cons", og: "pros-and-cons", title: "Pros and cons", seo: "Yakyard pros and cons: the honest list", nav: "/why",
    description: "The honest list. What Yakyard does well, what's worth knowing, and the fine print to read before you move your team.",
    lede: "What Yakyard does well, and what's worth knowing." },
  "SETUP.md": { out: "/docs/setup", og: "setup", title: "Set up Yakyard, free", seo: "Set up Yakyard on Cloudflare in about 30 minutes, free", nav: "/docs", toc: true, crumb: true,
    description: "Put Yakyard on your own Cloudflare account in about 30 minutes, without coding. Step by step.",
    lede: "From a new Cloudflare account to your team signing in. No coding." },
  "GUIDE.md": { out: "/docs/guide", og: "guide", title: "Using Yakyard", seo: "Using Yakyard: channels, threads, voice notes, calls", nav: "/docs", toc: true, crumb: true,
    description: "How to use Yakyard: channels, threads, voice notes, calls, search, Later, notifications, themes and guests.",
    lede: "Everything your team does in Yakyard, with pictures." },
  "TECHNICAL.md": { out: "/docs/technical", og: "technical", title: "Technical notes", seo: "Yakyard technical notes: limits, settings, backups", nav: "/docs", toc: true, crumb: true,
    description: "Yakyard's free plan math, deploy, notifications, settings, updates, backups and how it's built.",
    lede: "For whoever runs Yakyard: limits, settings, updates and backups." },
  "DOCKER.md": { out: "/docs/docker", og: "technical", title: "Run it on your own server", seo: "Run Yakyard on your own server with Docker", nav: "/docs", toc: true, crumb: true,
    description: "Run Yakyard on your own Linux server with Docker and Caddy: setup in about 15 minutes, backups, updates, and what's different from Cloudflare.",
    lede: "Same app, your hardware. About 15 minutes if you've used docker compose before." },
  "E2EE.md": { out: "/docs/locked", og: "technical", title: "Locked conversations", seo: "Yakyard locked conversations: end-to-end encryption", nav: "/docs", toc: true, crumb: true,
    description: "How Yakyard's locked conversations work: end-to-end encryption, what the server can and can't see, and the limits.",
    lede: "Who can read a locked conversation, and what works differently in there." },
  "E2EE-HASHES.md": { out: "/docs/locked/hashes", og: "technical", title: "Locking code per release", seo: "Yakyard locking code: SHA-256 per release", nav: "/docs", crumb: true,
    description: "The security code of Yakyard's locking code for each release, and how to check it.",
    lede: "Check the locking code you run is the one we published." },
  "AUDIT-APPLICATION.md": { out: "/docs/locked/audit", og: "technical", title: "Audit application", seo: "Yakyard security audit application", nav: "/docs", crumb: true,
    description: "Yakyard's application for an independent security audit of its locking code.",
    lede: "Our request for an independent audit of the locking code." },
  "sources.md": { out: "/sources", og: "compare", title: "Sources", seo: "Yakyard sources: every price and limit, linked", nav: "/compare", wide: true,
    description: "Every price, limit and license in the Yakyard docs, with the page it came from. Checked on 21 November 2026.",
    lede: "Every price, limit and license on this site comes from one of these pages." },
};
const MD_TO_URL = Object.fromEntries(Object.entries(DOCS).map(([f, d]) => [f, d.out]));
MD_TO_URL["PRESS-KIT.md"] = "/press";
const README_ANCHORS = { "what-it-costs": "/#cost", license: "/faq#is-it-open-source", "pros-and-cons": "/#pros" };

function slugger() {
  const seen = new Map();
  return (text) => {
    let s = text.toLowerCase().trim().replace(/<[^>]+>/g, "").replace(/&#39;|&#x27;|&apos;/g, "").replace(/&quot;|&amp;|&lt;|&gt;/g, "").replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(s) || 0;
    seen.set(s, n + 1);
    return n ? `${s}-${n}` : s;
  };
}

function resolveLink(href, fromDir = "docs") {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [p, hash] = href.split("#");
  const full = path.posix.normalize(path.posix.join(fromDir, p));
  const base = path.posix.basename(full);
  if (full === "README.md") return hash && README_ANCHORS[hash] ? README_ANCHORS[hash] : "/";
  if (full.startsWith("docs/") && MD_TO_URL[base]) return MD_TO_URL[base] + (hash ? `#${hash}` : "");
  const kind = /\.\w+$/.test(full) || /^(LICENSE|NOTICE)$/.test(full) ? "blob" : "tree";
  return `${REPO}/${kind}/main/${full}${hash ? `#${hash}` : ""}`;
}

function imageFor(src) {
  const full = path.posix.normalize(path.posix.join("docs", src));
  const m = full.match(/^docs\/(screens|guide)\/(.+)\.png$/);
  if (!m) return null;
  return (m[1] === "guide" ? "guide-" : "") + m[2];
}

function renderMarkdown(md) {
  const slug = slugger();
  const headings = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const id = slug(html);
        if (depth === 2) headings.push({ id, text: html.replace(/<[^>]+>/g, "") });
        return `<h${depth} id="${id}">${html}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const url = resolveLink(href);
        return `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ""}>${text}</a>`;
      },
      image({ href, text }) {
        const name = imageFor(href);
        if (name) return shot(name, { alt: text, sz: "(min-width: 1100px) 760px, 100vw" });
        return `<img src="${esc(resolveLink(href))}" alt="${esc(text)}" loading="lazy">`;
      },
    },
  });
  let html = marked.parse(md);
  // raw <img> tags in the docs: swap the PNG for the WebP set, keep the intended width
  html = html.replace(/<img\s+src="([^"]+\.png)"([^>]*)>/g, (m, src, rest) => {
    const name = imageFor(src);
    if (!name) return m;
    const alt = (rest.match(/alt="([^"]*)"/) || [])[1] || "";
    const w = (rest.match(/width="(\d+)"/) || [])[1];
    const img = shot(name, { alt, sz: w ? `${w}px` : "(min-width: 1100px) 760px, 100vw" });
    return w ? img.replace("<img ", `<img style="width:${w}px" `) : img;
  });
  // tables scroll sideways on phones: make each one a named, focusable region
  let lastHeading = "";
  let n = 0;
  html = html.replace(/<h[23] id="[^"]*">([\s\S]*?)<\/h[23]>|<table>/g, (m, h) => {
    if (h !== undefined) { lastHeading = h.replace(/<[^>]+>/g, ""); return m; }
    n += 1;
    return `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(lastHeading || "Table")}, table ${n}"><table>`;
  }).replace(/<\/table>/g, "</table></div>");
  html = html.replace(/<th><\/th>/g, '<th><span class="sr">App</span></th>');
  html = html.replace(/<pre>/g, '<pre tabindex="0">');
  return { html, headings };
}

async function buildDoc(file, meta) {
  let md = await readFile(path.join(ROOT, "docs", file), "utf8");
  md = md.replace(/^<!-- nav -->[\s\S]*?<!-- \/nav -->\s*/, ""); // GitHub-only nav line
  md = md.replace(/^# .+\n+/, ""); // the page header carries the title
  if (meta.dropFirstParagraphs) md = md.split("\n\n").slice(meta.dropFirstParagraphs).join("\n\n");
  let { html, headings } = renderMarkdown(md);
  if (meta.toc) {
    // the sidebar replaces an inline list of section links
    html = html.replace(/<ul>\s*(<li><a href="#[^"]+">[^<]+<\/a><\/li>\s*)+<\/ul>/, "");
  }
  const jsonld = [];
  if (meta.crumb) {
    jsonld.push({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Docs", item: `${SITE_URL}/docs/` },
      { "@type": "ListItem", position: 2, name: meta.title, item: SITE_URL + slashed(meta.out) },
    ] });
  }
  if (file === "FAQ.md") {
    // each H3 is a question, everything up to the next heading is its answer
    const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
    const qa = [...html.matchAll(/<h3 id="[^"]*">([\s\S]*?)<\/h3>([\s\S]*?)(?=<h[23] |$)/g)].map(([, q, a]) => ({ q: text(q), a: text(a) }));
    jsonld.push({ "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: qa.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
  }
  const crumbs = meta.crumb ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="/docs">Docs</a><span aria-hidden="true">/</span><span>${esc(meta.title)}</span></nav>` : "";
  const toc = meta.toc && headings.length > 2
    ? `<aside class="toc" aria-label="On this page"><h2>On this page</h2><ol>${headings.map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`).join("")}</ol></aside>`
    : "";
  const body = `<header class="phead"><div class="wrap">${crumbs}<h1>${esc(meta.title)}</h1><p class="lede">${esc(meta.lede)}</p></div></header>
<div class="wrap"><div class="doc${toc ? "" : " doc--wide"}"><article class="prose">${html}</article>${toc}</div></div>`;
  return layout({ title: meta.title, seoTitle: meta.seo, description: meta.description, urlPath: meta.out, og: meta.og, body, current: meta.nav, jsonld });
}

// ---------- write ----------
async function write(urlPath, html) {
  const file = urlPath === "/" ? "index.html" : urlPath === "/404" ? "404.html" : `${urlPath.replace(/^\//, "")}/index.html`;
  const out = path.join(DIST, file);
  // internal page links get the trailing slash too, so no click or crawl hits a 308
  html = html.replace(/href="(\/(?!\/)[^"]*)"/g, (m, h) => `href="${slashed(h)}"`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, html);
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // hashed css and js, so they can be cached for a long time
  for (const [name, setter] of [["site.css", (h) => (CSS_HREF = h)], ["site.js", (h) => (JS_HREF = h)], ["motion.js", (h) => (MOTION_HREF = h)]]) {
    const src = await readFile(path.join(HERE, "src", name));
    const hash = createHash("sha256").update(src).digest("hex").slice(0, 10);
    const outName = name.replace(".", `.${hash}.`);
    await mkdir(path.join(DIST, "assets"), { recursive: true });
    await writeFile(path.join(DIST, "assets", outName), src);
    setter(`/assets/${outName}`);
  }

  await copyDir(path.join(ROOT, "public/fonts"), path.join(DIST, "fonts"), (f) => f.endsWith(".woff2"));
  await copyDir(path.join(ROOT, "docs/brand"), path.join(DIST, "brand"), (f) => f.endsWith(".svg") || f.endsWith(".png"));
  for (const f of ["app-icon-180.png", "app-icon-192.png", "app-icon-512.png", "app-maskable-512.png"]) {
    await copyFile(path.join(ROOT, "public/brand", f), path.join(DIST, "brand", f));
  }
  await copyFile(path.join(ROOT, "public/favicon.ico"), path.join(DIST, "favicon.ico"));
  await copyFile(path.join(ROOT, "docs/brand/yakyard-app-icon.svg"), path.join(DIST, "icon.svg"));
  await copyFile(path.join(ROOT, "docs/wordmark.png"), path.join(DIST, "brand/yakyard-wordmark.png"));
  await copyDir(path.join(HERE, "static"), DIST);
  await copyDir(path.join(ROOT, "docs/screens"), path.join(DIST, "press/screens"), (f) => f.endsWith(".png"));

  await writeFile(path.join(DIST, "site.webmanifest"), JSON.stringify({
    name: "Yakyard", short_name: "Yakyard", start_url: "/", display: "browser", background_color: "#fff8e6", theme_color: "#2b1bd6",
    icons: [{ src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png" }],
  }, null, 2));

  const ctx = { layout, shot, esc, icon, DEPLOY_URL, REPO, SITE_URL, VERSION };
  const pages = [["/", homePage(ctx)], ["/docs", docsHubPage(ctx)], ["/press", pressPage(ctx)], ["/404", notFoundPage(ctx)], ...releasePages(ctx)];
  for (const [file, meta] of Object.entries(DOCS)) pages.push([meta.out, await buildDoc(file, meta)]);
  for (const [p, html] of pages) {
    if (/[—–]/.test(html.replace(/<pre[\s\S]*?<\/pre>/g, ""))) console.warn(`  note: ${p} contains an em or en dash`);
    await write(p, html);
  }

  const urls = pages.map(([p]) => p).filter((p) => p !== "/404");
  const today = new Date().toISOString().slice(0, 10);
  // lastmod moves only when the page's own source moves
  const gitDate = (f) => { try { return execFileSync("git", ["log", "-1", "--format=%cs", "--", f], { cwd: ROOT }).toString().trim() || null; } catch { return null; } };
  const handBuilt = gitDate("site/src/pages.mjs");
  const lastmod = Object.fromEntries(Object.entries(DOCS).map(([f, d]) => [d.out, gitDate(`docs/${f}`)]));
  await writeFile(path.join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE_URL}${slashed(u)}</loc><lastmod>${lastmod[u] ?? handBuilt ?? today}</lastmod></url>`).join("\n")}
</urlset>
`);
  // plain facts for AI answer engines (llmstxt.org), same wording as the FAQ
  await writeFile(path.join(DIST, "llms.txt"), `# Yakyard

> Yakyard is free, open source team chat you run on your own Cloudflare account or on your own Linux server with Docker. It's a Slack alternative for small teams, with channels, threads, DMs, calls, voice notes with transcripts, and optional end-to-end encrypted conversations. On Cloudflare it fits the free plan for a team of up to about 50 people, so for most small teams the bill is $0.

Key facts:
- Built for Cloudflare: Workers, Durable Objects, D1, R2 and Workers AI. It also runs on your own server with Docker, in workerd (the open-source Workers runtime) with Caddy for HTTPS. There, voice note transcripts need a Cloudflare API token, Cloudflare's free plan limits don't apply, and it's one server with no automatic scaling.
- License: Apache License 2.0, an OSI-approved open source license. Anyone can use it, change it, host it for others or sell it, free, as long as they keep the copyright, license and NOTICE files. Versions 1.0.0 and 2.0.0 were released under PolyForm Shield 1.0.0.
- Made and maintained by QVINTA Ltd (Hong Kong). It started as the internal chat of a team that left Slack, and that team still uses it every day.
- Installs from the browser as an app on iPhone, Android, Mac and Windows. There's no App Store or Play Store app.
- Slack history: each person copies their own Slack DMs, group messages and private channels, with files. Public channel history stays in Slack.
- No SOC 2, ISO 27001 or HIPAA certification. The encryption library underneath was audited by Least Authority in 2022. Yakyard's own code around it hasn't had an outside audit yet.
- No paid support. Help comes from the docs and GitHub issues.
- Live demo: https://yakyard-demo.qvinta.workers.dev (one click, no signup, resets every night). An 84-second tour video with voiceover: ${SITE_URL}/media/yakyard-demo.mp4
- Current version: ${VERSION}.

## Docs
- [Set up Yakyard](${SITE_URL}/docs/setup/): from a new Cloudflare account to your team signing in, in about 30 minutes, no coding
- [Using Yakyard](${SITE_URL}/docs/guide/): channels, threads, voice notes, calls, search and notifications
- [Technical notes](${SITE_URL}/docs/technical/): free plan math, settings, updates and backups
- [Run it on your own server](${SITE_URL}/docs/docker/): Docker and Caddy, backups, updates and what's different from Cloudflare
- [Locked conversations](${SITE_URL}/docs/locked/): how the end-to-end encryption works, and its limits

## Decide
- [Compare](${SITE_URL}/compare/): Yakyard next to Slack, Teams, Google Chat, Discord, Mattermost, Rocket.Chat, Zulip, Campfire and Element
- [Pros and cons](${SITE_URL}/pros-and-cons/)
- [FAQ](${SITE_URL}/faq/)
- [Sources](${SITE_URL}/sources/): every price and limit, with the page it came from
- [Release notes](${SITE_URL}/releases/2.2.1/)

## Code
- [GitHub repository](${REPO})
`);
  await writeFile(path.join(DIST, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  await writeFile(path.join(DIST, "_headers"), `/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n/img/*\n  Cache-Control: public, max-age=604800\n/vendor/*\n  Cache-Control: public, max-age=31536000, immutable\n/audio/*\n  Cache-Control: public, max-age=604800\n/media/*\n  Cache-Control: public, max-age=604800\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: interest-cohort=()\n`);
  console.log(`Built ${pages.length} pages into site/dist for ${SITE_URL}`);
}

await main();
