// Page bodies for the hand-built pages. Copy comes from README.md and docs/*.md;
// prices and limits from docs/sources.md (checked 21 November 2026).

import { readFileSync } from "node:fs";
import { yakMark } from "./icons.mjs";

const SLACK = { y: 7.25, m: 8.75 };
// The yak's voice clips (site/static/audio) and their word timings, made by site/tools/yak_voice.py with Kokoro-82M.
const VOICE = JSON.parse(readFileSync(new URL("./voice.json", import.meta.url), "utf8"));

export function homePage({ layout, shot, icon, DEPLOY_URL, REPO, SITE_URL, VERSION }) {
  const pro = [
    ["$0 for most teams under about 50 people.", "No price per seat, ever. Above that, $5 a month for the whole account."],
    ["Your messages and files live in your own Cloudflare account.", "You back them up, and you can delete all of it."],
    ["Voice notes with transcripts,", "written automatically and searchable."],
    ["Calls built in.", "Pop in to any channel or DM, with screen share."],
    ["Your Slack history comes with you:", "DMs, private channels and files."],
    ["Installs on phone and desktop,", "with push notifications."],
    ["Private channels stay private,", "even from admins."],
    ["Lock what's private.", "Lock a DM or private channel and only the people in it can read it. Not even the admin."],
    ["One click to deploy.", "No server or Docker to look after."],
    ["Backups are one command,", "to a file you keep."],
    ["Three themes,", "including Yaky, the loud one we made for fun."],
    ["You can read and change every line of code.", ""],
  ];
  const con = [
    ["Someone on your team runs it.", "Updates and backups are one command each."],
    ["Cloudflare only.", "It doesn't run on your own server or another cloud."],
    ["No app store app.", "It's an installable web app, with notifications."],
    ["Only locked conversations are end-to-end encrypted.", "The rest is readable to whoever runs your Cloudflare account. Locked ones have limits, like search only on your device."],
  ];
  const MQ = ["Channels", "Threads", "DMs", "Voice notes", "Transcripts", "Calls", "Locked", "Search", "Yak yak yak", "$0 a seat", "Your data, your account"];
  const li = ([b, t]) => `<li><b>${b}</b>${t ? ` ${t}` : ""}</li>`;

  const rows = [
    ["Yakyard", "$0. Above about 50 people, $5 a month for the whole team", "Cloudflare's daily limits", "Yes, on your Cloudflare account, no server", "PolyForm Shield (source-available)", true],
    ["Slack", "Pro $7.25 yearly, $8.75 monthly", "90 days of history; older than a year is deleted", "No", "Closed"],
    ["Microsoft Teams", "Essentials $4 (yearly)", "Free Teams: 60-minute group calls", "No", "Closed"],
    ["Google Chat", "In Workspace, from $7 yearly, $8.40 flexible", "No free business plan", "No", "Closed"],
    ["Mattermost", "Paid plans by quote", "Free Entry edition shows 10,000 messages of history", "Yes, Linux server and PostgreSQL", "MIT (Team Edition) or commercial"],
    ["Zulip", "Cloud Standard $6.67 yearly, $8 monthly", "Cloud Free: 10,000 messages of search history", "Yes, free self-hosted", "Apache 2.0"],
    ["Campfire", "Free", "No calls listed", "Yes, your server", "MIT"],
    ["Element (Matrix)", "Enterprise per seat, by quote", "Community is for non-professional use", "Yes, your server", "AGPL-3.0 or commercial"],
  ];
  const heads = ["Price per person a month", "Free plan catch", "Run it yourself", "License"];
  const table = `<div class="ctable-wrap"><table class="ctable">
  <caption class="sr">Yakyard compared with other team chat apps</caption>
  <thead><tr><th scope="col"><span class="sr">App</span></th>${heads.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead>
  <tbody>${rows.map(([n, ...c]) => { const us = c[4] === true; return `<tr${us ? ' class="us"' : ""}><th scope="row">${n}</th>${c.slice(0, 4).map((v, i) => `<td data-label="${heads[i]}">${v}</td>`).join("")}</tr>`; }).join("")}</tbody>
</table></div>`;

  const faq = [
    ["Is it really free?", "The software is free. It runs on Cloudflare's free plan for up to about 50 people. Above that, Cloudflare charges $5 a month for the whole account, not per person."],
    ["Can I use it at work?", "Yes. Any company can run it for its own team, for free. What you can't do is sell Yakyard or offer it as a chat service to others."],
    ["Who can read our messages?", "People in your workspace, and whoever has access to your Cloudflare account. Nobody at Yakyard can see them."],
    ["Is it end-to-end encrypted?", `Yes, if you lock the conversation. Locked DMs and private channels are scrambled on each person's device, so only the people in them can read them, not the admin and not us. In there, search only covers your device and voice notes have no transcript. If you lose every device and your recovery key, those messages are gone. <a href="/docs/locked">How it works</a>.`],
    ["Is there a phone app?", "Yakyard installs from the browser on iPhone and Android, with its own icon and notifications. There's no App Store or Play Store app."],
    ["What happens to our Slack history?", "Each person copies their own Slack DMs, group messages and private channels, with files. Public channel history stays in Slack."],
    ["What if Yakyard stops being developed?", "Your copy keeps running on your account. You have the code, the database and a backup command. Nothing phones home."],
    ["Who do I call when it breaks?", `Nobody sells support. There's the <a href="/docs/setup#when-something-fails">setup guide</a>, <a href="${REPO}/issues">GitHub issues</a> and the people who use it.`],
    ["Is it open source?", "No. It's free and source-available under PolyForm Shield 1.0.0. You can read, change and run the code, but not sell it or build a competing product with it."],
  ];

  const body = `
<aside class="v2band" aria-label="Yakyard 2"><div class="wrap"><p><span class="v2band__tag">New</span> <strong>Yakyard 2 is now live.</strong> <span class="v2band__long">Lock a DM or private channel, and only the people in it can read it. Not your admin, not us.</span><span class="v2band__short">Lock a conversation so only the people in it can read it.</span> <a href="/docs/locked">How it works</a> <a href="/releases/2.0.0">What's new</a></p></div></aside>
<section class="hero" aria-labelledby="hero-title">
  <div class="wrap">
    <h1 class="d-xl" id="hero-title"><span class="l">${"Yak all you want.".split(" ").map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`).join(" ")}</span> <span class="l hot"><span class="stamp">Pay nobody.</span></span></h1>
    <div class="hero__grid">
      <div class="hero__copy">
        <p class="lede">A free Slack alternative you run on your own Cloudflare account. Channels, threads, calls, voice notes with transcripts, and locked conversations nobody else can read. Nobody pays per seat.</p>
        <div class="btn-row">
          <a class="btn btn--primary" href="${DEPLOY_URL}">${icon("cloud-arrow-up")}Deploy to Cloudflare</a>
          <a class="btn btn--ghost" href="/docs/setup">Read the setup guide</a>
        </div>
      </div>
      <div class="stage">
        <span class="sticker" aria-hidden="true">$0 a seat</span>
        <div class="yak-spot">
          <p class="say" role="status" aria-live="polite"></p>
          <button class="yak yak--hero is-intro" type="button" data-yak aria-label="Hear the yak">${yakMark()}</button>
        </div>
        <figure class="browser" style="margin:0">
          <div class="browser__bar" aria-hidden="true"><span class="browser__dots"><i></i><i></i><i></i></span><span class="browser__url"><b>yakyard</b>.fernhill.workers.dev</span></div>
          <picture>
            <source media="(prefers-color-scheme: dark)" srcset="/img/desktop-dark-960.webp 960w, /img/desktop-dark-1440.webp 1440w, /img/desktop-dark-2160.webp 2160w" sizes="(min-width: 1240px) 760px, (min-width: 960px) 62vw, 100vw">
            ${shot("hero-light", { alt: "Yakyard in a browser: the #launch channel of a design studio, with a shared homepage design, reactions, a three-reply thread and a voice note with its transcript", sz: "(min-width: 1240px) 760px, (min-width: 960px) 62vw, 100vw", eager: true })}
          </picture>
        </figure>
        <div class="phone">${shot("phone-yaky-channel", { alt: "The same channel on a phone in the Yaky theme, with a voice note and its transcript", sz: "232px" })}</div>
      </div>
    </div>
  </div>
</section>

<div class="mq" aria-hidden="true"><div class="mq__track">${[0, 1].map(() => `<ul>${MQ.map((w) => `<li>${w}</li>`).join("")}</ul>`).join("")}</div></div>

<section class="sec" id="features" aria-labelledby="features-title">
  <div class="wrap">
    <div class="sec__head">
      <h2 class="d-l" id="features-title">The chat your team already knows.</h2>
      <p>If your people use Slack, they already know where everything is. Yakyard started as the internal chat of a team that left Slack, and that team still uses it every day.</p>
    </div>
    <div class="bento">
      <article class="tile t-thread">
        <h3>Talk the usual way</h3>
        <p>Public and private channels, threads, DMs, mentions, reactions and pins. Files, photos and videos up to 1 GB.</p>
        <div class="tile__shot">${shot("thread-panel", { alt: "A thread open beside the channel, with a mention in one of the replies", sz: "(min-width: 960px) 640px, 100vw" })}</div>
      </article>
      <article class="tile t-phone">
        <h3>Take it everywhere</h3>
        <p>Installs like an app on iPhone, Android, Mac and Windows. Push notifications with quiet hours, muted channels and VIPs.</p>
        <div class="tile__shot">${shot("phone-light-dms", { alt: "Direct messages on a phone, light theme", sz: "210px" })}${shot("phone-yaky-dms", { alt: "Direct messages on a phone, Yaky theme, with unread counts", sz: "210px" })}</div>
      </article>
      <article class="tile t-themes">
        <h3>Three themes, one of them loud</h3>
        <p>Light, Dark and Yaky. Each person picks their own.</p>
        <div class="tile__shot">${shot("hero-yaky", { alt: "The Yaky theme: indigo frame, yellow highlights", sz: "(min-width: 960px) 460px, 100vw" })}</div>
      </article>
      <article class="tile t-slack">
        <h3>Leave Slack with your history</h3>
        <p>Each person copies their own Slack DMs, group messages and private channels, with files and reactions. Read-only access, removed when the copy is done.</p>
        <div class="tile__shot">${shot("slack-import", { alt: "The Import from Slack page after a finished import", sz: "(min-width: 960px) 640px, 100vw" })}</div>
      </article>
      <article class="tile t-locked">
        <h3>Lock what's private</h3>
        <p>Tick "Lock it" on a DM or private channel. Messages, files and voice notes are scrambled on each device, so the server only keeps what it can't read. Locking takes two approvals, and the app says plainly what works differently in there.</p>
        <div class="tile__shot">${shot("locked-dm", { alt: "A locked DM: a Locked tag in the header, a banner that says only the people here can read it, a photo and a voice note", sz: "(min-width: 960px) 640px, 100vw" })}</div>
      </article>
    </div>
    <ul class="also" aria-label="Also included">
      <li class="lead">Also in the box:</li>
      <li>Locked conversations</li><li>Pop in calls with screen share</li><li>Search with filters</li><li>Send later</li><li>Reminders</li><li>Later</li>
      <li>Guests</li><li>Sign in with Google</li><li>Link previews</li><li>Ctrl/⌘ + K</li>
    </ul>
  </div>
</section>

<section class="sec voice band" id="voice" aria-labelledby="voice-title">
  <div class="wrap">
    <div class="voice__text">
      <h2 class="d-l" id="voice-title">Talk instead of typing. Everyone can still read it.</h2>
      <p>Tap the mic, talk for up to 15 minutes, send. Every voice note gets a written transcript, so your team can skim it when they can't listen, and find it in search next month.</p>
      <dl class="facts">
        <div><dt>Length</dt><dd>Up to 15 minutes a note</dd></div>
        <div><dt>Transcripts</dt><dd>Whisper, on Cloudflare Workers AI</dd></div>
        <div><dt>Search</dt><dd><code>has:voice</code> finds notes by what was said</dd></div>
        <div><dt>Free plan</dt><dd>About 214 transcript minutes a day</dd></div>
      </dl>
    </div>
    <div class="voice__shots">
      ${chat(icon)}
      <figure class="voice__search">${shot("search-voice", { alt: "Search for has:voice, showing two voice notes matched by their transcripts", sz: "(min-width: 960px) 460px, 72vw" })}<figcaption>Search for has:voice, matched by transcript</figcaption></figure>
    </div>
  </div>
</section>

<section class="sec cost" id="cost" aria-labelledby="cost-title">
  <div class="wrap">
    <div>
      <div class="sec__head">
        <h2 class="d-l" id="cost-title">What your team chat costs a year.</h2>
        <p>The others charge per person, every month. Yakyard costs the same at 5 people as at 50.</p>
      </div>
      <form class="calc" id="calc" onsubmit="return false">
        <div class="people">
          <label for="people">People on your team</label>
          <input class="range" type="range" id="people" name="people" min="2" max="150" step="1" value="25" aria-describedby="people-out">
          <output id="people-out" for="people">25</output>
        </div>
        <fieldset class="seg">
          <legend>How you'd pay the others</legend>
          <div class="seg__opts">
            <label><input type="radio" name="billing" value="y" checked><span>Paid yearly</span></label>
            <label><input type="radio" name="billing" value="m"><span>Paid monthly</span></label>
          </div>
        </fieldset>
      </form>
    </div>
    <div>
      <p class="sr" aria-live="polite" id="bill-say"></p>
      <ul class="bill" id="bill">
        <li><b>Slack Pro</b><small data-k="slack-note">$7.25 per person a month, paid yearly</small><span class="amt" data-k="slack">$2,175</span><span class="bar" aria-hidden="true"><i style="transform:scaleX(1)"></i></span></li>
        <li><b>Google Workspace Business Starter</b><small data-k="google-note">$7 per person a month, annual plan</small><span class="amt" data-k="google">$2,100</span><span class="bar" aria-hidden="true"><i style="transform:scaleX(.966)"></i></span></li>
        <li><b>Microsoft Teams Essentials</b><small data-k="teams-note">$4 per person a month, paid yearly</small><span class="amt" data-k="teams">$1,200</span><span class="bar" aria-hidden="true"><i style="transform:scaleX(.552)"></i></span></li>
        <li class="us"><b>Yakyard</b><small data-k="us-note">Cloudflare's free plan, up to about 50 people</small><span class="amt" data-k="us">$0</span><span class="bar" aria-hidden="true"><i style="transform:scaleX(0)"></i></span></li>
      </ul>
      <p class="fine">US dollars before tax, from each vendor's own page on 21 November 2026 (<a href="/sources">sources</a>). "About 50 people" is our estimate for a busy team. The real limits are Cloudflare's daily allowances, not a seat count. Above them, Workers Paid is $5 a month for the whole account.</p>
    </div>
  </div>
</section>

<section class="sec" id="compare" aria-labelledby="compare-title">
  <div class="wrap">
    <div class="sec__head">
      <h2 class="d-l" id="compare-title">Where Yakyard wins, and where it doesn't.</h2>
      <p>Some of these beat Yakyard at things that might matter to you. Need OSI open source? Zulip, Campfire, Mattermost Team Edition or Element. Need every conversation encrypted, with an audited client? Element.</p>
    </div>
    ${table}
    <p class="after">Prices checked on 21 November 2026. <a href="/compare">Read the app-by-app comparison</a>, with Discord and Rocket.Chat too.</p>
  </div>
</section>

<section class="sec" id="pros" aria-labelledby="pros-title" style="padding-top:0">
  <div class="wrap">
    <div class="sec__head">
      <h2 class="d-l" id="pros-title">The good, and what's worth knowing.</h2>
      <p>This is the short version of both sides. The <a href="/pros-and-cons">longer version</a> has the fine print on calls, transcript languages, the Slack import and the license.</p>
    </div>
    <div class="pc">
      <div class="pc__col pros"><h3 class="sticker">Good</h3><ul>${pro.map(li).join("")}</ul></div>
      <div class="pc__col cons"><h3>Worth knowing</h3><ul>${con.map(li).join("")}</ul></div>
    </div>
  </div>
</section>

<section class="sec install band" id="install" aria-labelledby="install-title">
  <div class="wrap">
    <div>
      <div class="sec__head">
        <h2 class="d-l" id="install-title">Live in about 30 minutes.</h2>
        <p>No server, no Docker, no database to patch. One button, or four commands.</p>
      </div>
      <div class="steps-wrap"><span class="rail" aria-hidden="true"><i></i></span><ol class="steps">
        <li><div><h3>Make a free Cloudflare account</h3><p>Then turn on R2, the file storage, in the dashboard. Cloudflare asks for a payment card first. Nothing is charged under 10 GB.</p></div></li>
        <li><div><h3>Click Deploy to Cloudflare</h3><p>It copies Yakyard to your GitHub, creates the database, file storage and background jobs, and deploys. When it asks for <code>SETUP_TOKEN</code>, type a long random code and keep it.</p></div></li>
        <li><div><h3>Claim it</h3><p>Open the address it gives you, paste the setup code and create the owner account.</p></div></li>
        <li><div><h3>Invite your team</h3><p>Click <b>Invite people</b> and send the links.</p></div></li>
      </ol></div>
    </div>
    <div class="install__side">
      <div class="btn-row">
        <a class="btn btn--primary" href="${DEPLOY_URL}">${icon("cloud-arrow-up")}Deploy to Cloudflare</a>
        <a class="btn btn--ghost" href="/docs/setup">Read the setup guide</a>
      </div>
      <div class="term">
        <div class="term__bar"><span>No GitHub account? Use the terminal.</span><button class="copy" type="button" data-copy="git clone https://github.com/yakyard/yakyard.git&#10;cd yakyard&#10;npx wrangler login&#10;npm run deploy">${icon("copy")}<span>Copy</span></button></div>
<pre tabindex="0" aria-label="Terminal commands" translate="no"><code><span class="tl"><span class="p">$ </span>git clone https://github.com/yakyard/yakyard.git</span>
<span class="tl"><span class="p">$ </span>cd yakyard</span>
<span class="tl"><span class="p">$ </span>npx wrangler login</span>
<span class="tl"><span class="p">$ </span>npm run deploy   <span class="c"># prints your address and a one-time setup code</span></span></code></pre>
      </div>
      <p class="side-note">Updates and backups are one command each: <code>npm run update</code> and <code>npm run backup</code>. Notifications, Google sign-in and the Slack import are in the <a href="/docs/setup">setup guide</a>.</p>
    </div>
  </div>
</section>

<section class="sec faq" id="faq" aria-labelledby="faq-title">
  <div class="wrap">
    <div class="sec__head">
      <h2 class="d-l" id="faq-title">Straight answers.</h2>
      <p>The questions people ask before they switch. <a href="/faq">All of them</a> are on the FAQ page.</p>
    </div>
    <div class="qa">
      ${faq.map(([q, a]) => `<details><summary>${q}${icon("plus")}</summary><div class="a"><p>${a}</p></div></details>`).join("\n      ")}
    </div>
  </div>
</section>

<section class="close" aria-labelledby="close-title">
  <div class="wrap">
    <div class="close__mark"><button class="yak yak--close" type="button" data-yak aria-label="Hear the yak">${yakMark({ tile: true })}</button><p class="say" role="status" aria-live="polite"></p></div>
    <div>
      <h2 class="d-l" id="close-title">Your team's chat belongs to your team.</h2>
      <p class="lede close__p">One command backs it all up to a file you keep. Nothing phones home.</p>
      <div class="btn-row">
        <a class="btn btn--primary" href="${DEPLOY_URL}">${icon("cloud-arrow-up")}Deploy to Cloudflare</a>
        <a class="btn btn--secondary" href="${REPO}">${icon("github-logo")}Read the code</a>
      </div>
    </div>
  </div>
</section>`;

  return layout({
    title: "Yakyard: free Slack alternative on your own Cloudflare account",
    description: "A Slack alternative you run on your own Cloudflare account, free. Channels, threads, DMs, calls and voice notes with transcripts. No per-seat bill.",
    jsonld: {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: "Yakyard", publisher: { "@id": `${SITE_URL}/#org` } },
        { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: "QVINTA Ltd", address: { "@type": "PostalAddress", addressCountry: "HK" } },
        { "@type": "SoftwareApplication", "@id": `${SITE_URL}/#app`, name: "Yakyard", url: `${SITE_URL}/`,
          description: "Free, source-available team chat you deploy to your own Cloudflare account. A Slack alternative with channels, threads, DMs, calls and voice notes with transcripts, plus optional end-to-end encrypted conversations.",
          applicationCategory: "CommunicationApplication", applicationSubCategory: "Team chat",
          operatingSystem: "Web, iOS, Android, macOS, Windows (installable web app)",
          softwareVersion: VERSION, isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          license: "https://polyformproject.org/licenses/shield/1.0.0",
          image: `${SITE_URL}/og/home.png`, screenshot: `${SITE_URL}/img/hero-light-1440.webp`,
          featureList: ["Public and private channels", "Threads", "Direct and group messages", "Voice notes with automatic transcripts", "Calls with screen share", "Search across messages and transcripts", "Slack history import", "Optional end-to-end encrypted conversations", "Installable app for phone and desktop"],
          publisher: { "@id": `${SITE_URL}/#org` }, sameAs: [REPO] },
        { "@type": "SoftwareSourceCode", "@id": `${SITE_URL}/#code`, name: "Yakyard source code",
          codeRepository: REPO, programmingLanguage: "JavaScript", runtimePlatform: "Cloudflare Workers",
          license: "https://polyformproject.org/licenses/shield/1.0.0", targetProduct: { "@id": `${SITE_URL}/#app` } },
      ],
    },
    urlPath: "/",
    og: "home",
    body,
    home: true,
  });
}

export function docsHubPage({ layout, shot, REPO }) {
  const body = `
<header class="phead"><div class="wrap"><h1>Docs</h1><p class="lede">Everything you need to put Yakyard on your Cloudflare account and run it. Written for people who don't code.</p></div></header>
<div class="wrap">
  <div class="hub">
    <a class="big" href="/docs/setup">
      <h2>Set it up</h2>
      <p>From a new Cloudflare account to your team signing in. Notifications, Google sign-in and the Slack import are in there too.</p>
      <span class="meta">About 30 minutes. No coding.</span>
      ${shot("guide-channel", { alt: "A Yakyard channel with messages, a thread, a mention and two voice notes", sz: "(min-width: 960px) 640px, 100vw" })}
    </a>
    <div class="side">
      <a href="/docs/guide"><h2>Use it</h2><p>Channels, threads, voice notes, calls, search, Later, notifications and themes. Five minutes if you know Slack.</p><span class="meta">For everyone on the team</span></a>
      <a href="/docs/technical"><h2>Technical notes</h2><p>The free plan math, every setting, updates, backups and how it's built.</p><span class="meta">For whoever runs it</span></a>
    </div>
    <a href="/docs/locked" class="half"><h2>Locked conversations</h2><p>How end-to-end encryption works here, what the server can and can't see, and the limits.</p><span class="meta">For anyone who asks "who can read this?"</span></a>
    <a class="half" href="/faq"><h2>FAQ</h2><p>Costs, privacy, encryption, phone apps, Slack history, the license and support.</p></a>
    <a class="half" href="/sources"><h2>Sources</h2><p>Every price and limit on this site, with the page it came from.</p></a>
    <a class="half" href="${REPO}"><h2>GitHub</h2><p>The code, issues, the changelog and how to contribute.</p></a>
  </div>
</div>`;
  return layout({
    title: "Docs", seoTitle: "Yakyard docs: setup, guide and technical notes",
    description: "Set up Yakyard on your own Cloudflare account, learn how to use it, and read the technical notes.",
    urlPath: "/docs", og: "docs", body, current: "/docs",
  });
}

export function pressPage({ layout, shot, icon, REPO }) {
  const logos = [
    ["yakyard-lockup.svg", "Lockup", "The default logo, on light grounds", "paper", true],
    ["yakyard-app-icon.svg", "App icon", "Avatars, favicons, profiles", "white", false, "/brand/app-icon-512.png"],
    ["yakyard-wordmark.svg", "Wordmark", "Name only, light grounds", "white"],
    ["yakyard-wordmark-reverse.svg", "Reverse wordmark", "Name only, dark or indigo grounds", "night"],
    ["yakyard-mark.svg", "Mark", "The horned bubble alone", "paper"],
  ];
  const dims = { "yakyard-lockup.svg": [698, 124], "yakyard-app-icon.svg": [256, 256], "yakyard-wordmark.svg": [548, 120], "yakyard-wordmark-reverse.svg": [548, 120], "yakyard-mark.svg": [256, 232] };
  const shots = [
    ["hero-light", "Hero, light theme"], ["hero-yaky", "Hero, Yaky theme"], ["desktop-dark", "Dark theme"],
    ["thread-panel", "A thread beside a channel"], ["search-voice", "Search for has:voice"], ["slack-import", "A finished Slack import"],
    ["phone-light-channel", "Phone, light theme"], ["phone-yaky-dms", "Phone, Yaky theme"], ["admin-usage", "Admin: free plan usage"],
  ];
  const blurbs = [
    ["One line", "Yakyard is free team chat you run on your own Cloudflare account."],
    ["50 words", "Yakyard is a team chat you deploy to your own Cloudflare account. It has channels, threads, DMs, calls, and voice notes with automatic transcripts. Built to fit Cloudflare's free plan, it costs nothing for teams of up to about 50 people. It's free and source-available under PolyForm Shield."],
    ["Boilerplate", "Yakyard is free team chat that runs on your own Cloudflare account. It started as the internal chat of a team that left Slack, and that team still uses it every day. Yakyard is free and source-available under the PolyForm Shield License 1.0.0. Learn more at github.com/yakyard/yakyard."],
  ];
  const body = `
<header class="phead"><div class="wrap"><h1>Press kit</h1><p class="lede">Logos, screenshots and words for writing about Yakyard or showing it. Use them freely in articles, reviews, videos and talks.</p></div></header>
<div class="wrap">
  <section class="press-sec" aria-labelledby="p-logos">
    <h2 class="d-m" id="p-logos">Logos</h2>
    <div class="logos">
      ${logos.map(([f, n, use, ground, wide, png]) => `<figure class="logo${wide ? " wide" : ""}" style="margin:0"><div class="logo__art ${ground}"><img src="/brand/${f}" alt="Yakyard ${n.toLowerCase()}" width="${dims[f][0]}" height="${dims[f][1]}" loading="lazy"></div><figcaption class="logo__meta"><div><b>${n}</b><span>${use}</span></div><span class="dls"><a class="dl" href="/brand/${f}" download aria-label="Download the ${n.toLowerCase()} as SVG">${icon("download-simple")}SVG</a>${png ? `<a class="dl" href="${png}" download aria-label="Download the ${n.toLowerCase()} as a 512 px PNG">${icon("download-simple")}PNG</a>` : ""}</span></figcaption></figure>`).join("\n      ")}
    </div>
    <p class="after">Keep one horn height of clear space around the logo. Keep the lockup at least 96 px wide, the wordmark 72 px and the icon 16 px. On dark grounds, use the reverse wordmark or the app icon. Please don't recolor the horns, tilt the mark, add outlines, shadows or gradients, retype the wordmark or put the logo on a photo.</p>
  </section>

  <section class="press-sec" aria-labelledby="p-colors">
    <h2 class="d-m" id="p-colors">Colors</h2>
    <div class="swatches">
      <div class="sw" style="background:#2b1bd6;color:#fff"><b>Yak indigo</b><code>#2B1BD6</code><span>The brand color</span></div>
      <div class="sw" style="background:#ffd93b;color:#120f2e"><b>Yak yellow</b><code>#FFD93B</code><span>The bubble, highlights</span></div>
      <div class="sw" style="background:#ff4b2b;color:#120f2e"><b>Horn red</b><code>#FF4B2B</code><span>Accent only</span></div>
      <div class="sw" style="background:#120f2e;color:#fff8e6"><b>Night</b><code>#120F2E</code><span>Ink, dark grounds</span></div>
      <div class="sw" style="background:#fff8e6;color:#120f2e"><b>Paper</b><code>#FFF8E6</code><span>Warm light ground</span></div>
      <div class="sw" style="background:#fff;color:#120f2e"><b>Surface</b><code>#FFFFFF</code><span>Cards, reading</span></div>
    </div>
    <p class="after">Fonts: Rammetto One for the logo and big headlines, Wix Madefor Text for everything people read, Martian Mono for times and code. All three are under the SIL Open Font License 1.1.</p>
  </section>

  <section class="press-sec" aria-labelledby="p-words">
    <h2 class="d-m" id="p-words">Words</h2>
    <div class="blurbs">
      ${blurbs.map(([h, t], i) => `<div class="blurb"><header><h3 id="b${i}">${h}</h3><button class="copy" type="button" data-copy="${t.replace(/"/g, "&quot;")}" aria-describedby="b${i}">${icon("copy")}<span>Copy</span></button></header><p>${t}</p></div>`).join("\n      ")}
    </div>
    <p class="after">Please don't describe Yakyard as "open source". It's source-available: free to use, read and change, but not to resell or to build a competing product with. The 150-word version is in the <a href="${REPO}/blob/main/docs/PRESS-KIT.md">press kit on GitHub</a>.</p>
  </section>

  <section class="press-sec" aria-labelledby="p-facts">
    <h2 class="d-m" id="p-facts">Facts</h2>
    <table class="facts-t">
      <tbody>
        <tr><th scope="row">What</th><td>Self-hosted team chat on Cloudflare Workers</td></tr>
        <tr><th scope="row">Price</th><td>Free. Runs on Cloudflare's free plan for about 50 people; Cloudflare's Workers Paid plan ($5 a month minimum per account) above that</td></tr>
        <tr><th scope="row">Features</th><td>Channels, threads, DMs, mentions, reactions, search, voice notes with transcripts, calls with screen share, locked conversations (end-to-end encrypted DMs and private channels), scheduled send, reminders, Later, push notifications, guests, Google sign-in, Slack import, three themes</td></tr>
        <tr><th scope="row">Encryption</th><td>Optional, per conversation: Olm and Megolm (vodozemac 0.11.2, Apache-2.0, audited by Least Authority in 2022) in the browser. Yakyard's own code around it is Apache-2.0 and not independently audited yet.</td></tr>
        <tr><th scope="row">Version</th><td>2.0.0</td></tr>
        <tr><th scope="row">Runs on</th><td>Cloudflare Workers, Durable Objects, D1, R2, Workers AI</td></tr>
        <tr><th scope="row">Apps</th><td>Installable web app (PWA) for iPhone, Android, Mac and Windows</td></tr>
        <tr><th scope="row">License</th><td>PolyForm Shield License 1.0.0 (free and source-available, not OSI open source). The encryption package is Apache-2.0.</td></tr>
        <tr><th scope="row">Owner</th><td>QVINTA Ltd (Hong Kong) holds the copyright</td></tr>
        <tr><th scope="row">Code</th><td><a href="${REPO}">github.com/yakyard/yakyard</a></td></tr>
      </tbody>
    </table>
  </section>

  <section class="press-sec" aria-labelledby="p-shots">
    <h2 class="d-m" id="p-shots">Screenshots</h2>
    <div class="shots">
      ${shots.map(([n, cap]) => `<a href="/press/screens/${n}.png" download>${shot(n, { alt: cap, sz: "(min-width: 960px) 380px, (min-width: 560px) 50vw, 100vw" })}<span>${cap}, PNG</span></a>`).join("\n      ")}
    </div>
    <p class="after">Real screenshots of the app, with a made-up team and made-up messages.</p>
  </section>

  <section class="press-sec" aria-labelledby="p-contact" style="padding-bottom:clamp(72px,9vw,120px)">
    <h2 class="d-m" id="p-contact">Contact</h2>
    <p class="lede" style="max-width:60ch">For press questions, interviews or a commercial license, <a href="${REPO}/issues/new/choose">open an issue on GitHub</a> and mark it Question. For security problems, follow <a href="${REPO}/blob/main/SECURITY.md">SECURITY.md</a> instead.</p>
  </section>
</div>`;
  return layout({
    title: "Press kit", seoTitle: "Yakyard press kit: logos, screenshots, facts",
    description: "Yakyard logos, colors, screenshots and copy, free to use in articles, reviews, videos and talks.",
    urlPath: "/press", og: "press", body, current: "/press",
  });
}

export function notFoundPage({ layout }) {
  const body = `
<section class="lost">
  <div class="wrap">
    <img src="/brand/yakyard-mark.svg" alt="" width="150" height="136">
    <h1>The yak looked everywhere. This page isn't here.</h1>
    <p>The link may be old, or the page moved. Start from the home page or the docs.</p>
    <div class="btn-row"><a class="btn btn--primary" href="/">Go to the home page</a><a class="btn btn--ghost" href="/docs">Open the docs</a></div>
  </div>
</section>`;
  return layout({ title: "Page not found", description: "This page isn't here.", urlPath: "/404", og: "home", body, noindex: true });
}

// A short #launch conversation that plays in when it scrolls into view. Fully readable without JavaScript.
function chat(icon) {
  const note = VOICE.note;
  const toks = note.text.split(" ");
  const words = toks.map((t, i) => `<span class="wd" data-t="${note.words[i] ? note.words[i][1] : note.dur}">${t}</span>`).join(" ");
  const secs = Math.round(note.dur - 0.4);
  const bars = note.bars.map((h) => `<i style="transform:scaleY(${h})"></i>`).join("");
  const msg = (who, init, cls, time, text) => `<li class="msg"><span class="av ${cls}" aria-hidden="true">${init}</span><div class="msg__body"><p class="msg__who"><b>${who}</b> <time>${time}</time></p><p class="msg__text">${text}</p></div></li>`;
  return `<div class="chat" id="chat" data-dur="${note.dur}">
        <div class="chat__bar"><b># launch</b><span>Lena, Marco and the yak</span></div>
        <ol class="chat__log" aria-label="Sample conversation in the #launch channel">
          ${msg("Lena Brandt", "L", "av--l", "9:41", "Homepage draft is up. Thoughts before lunch?")}
          ${msg("Marco Ruiz", "M", "av--m", "9:42", "Love it. Can the $0 be bigger?")}
          <li class="msg msg--yak"><span class="av av--yak" aria-hidden="true">${yakMark({ cls: "yak__svg yak-av" })}</span><div class="msg__body"><p class="msg__who"><b>The yak</b> <time>9:43</time></p>
            <div class="vn"><button class="vn__play" type="button" aria-label="Play the yak's voice note, ${secs} seconds" aria-pressed="false">${icon("play", "ic ic-play")}${icon("pause", "ic ic-pause")}</button><span class="vn__wave" aria-hidden="true">${bars}</span><span class="vn__time">0:0${secs}</span></div>
            <p class="vn__tx"><span class="vn__label">Transcript</span> ${words}</p></div></li>
          ${msg("Lena Brandt", "L", "av--l", "9:44", "Listened on the train. Ship it.")}
        </ol>
        <p class="chat__typing" aria-hidden="true"><span class="tdots"><i></i><i></i><i></i></span><span class="chat__who">Marco is typing</span></p>
      </div>`;
}

// Release notes pages, in the home page's design. Same words as docs/releases/*.md.
export function releasePages({ layout, shot, DEPLOY_URL, REPO }) {
  const deployBtn = `<a class="btn btn--primary" href="${DEPLOY_URL}">Deploy to Cloudflare</a>`;
  const v2 = `
<aside class="v2band" aria-label="Release"><div class="wrap"><p><span class="v2band__tag">2.0.0</span> <strong>The latest release.</strong> <a href="/releases/1.0.0">See 1.0.0</a></p></div></aside>
<section class="hero rel-hero" aria-labelledby="rel-title">
  <div class="wrap">
    <h1 class="d-xl" id="rel-title"><span class="l">Lock what's</span> <span class="l hot"><span class="stamp">private.</span></span></h1>
    <div class="rel-hero__grid">
      <div>
        <p class="lede">Lock a DM or private channel, and only the people in it can read it. Not your admin, not whoever runs your Cloudflare account, and not us.</p>
        <div class="btn-row"><a class="btn btn--primary" href="#update">Update to 2.0.0</a><a class="btn btn--ghost" href="/docs/locked">See how locking works</a></div>
      </div>
      <div class="rel-shot">${shot("locked-dm", { alt: "A locked DM: a Locked tag in the header, a banner that says only the people here can read it, a photo and a voice note", sz: "(min-width: 960px) 720px, 100vw", eager: true })}</div>
    </div>
  </div>
</section>

<section class="sec" aria-labelledby="why-title">
  <div class="wrap">
    <div class="sec__head">
      <h2 class="d-l" id="why-title">Some talks belong to the people in them.</h2>
      <p>Pay, hiring, a client's numbers. Until now, anyone with access to your Cloudflare account could read every message. Tick "Lock it" when you start a DM or a private channel, and messages, edits, reactions, files and voice notes are scrambled on your device before they leave it.</p>
    </div>
    <div class="bento">
      <article class="tile t-thread">
        <h3>Two approvals, never one click</h3>
        <p>You read what works and what doesn't and tick "I understand". You type the channel name, or <code>lock</code> for a DM. Then a second person agrees: an admin for a channel, everyone in it for a DM. Each step shows up in the conversation.</p>
        <div class="tile__shot">${shot("guide-locked-step2", { alt: "Step two: type lock to confirm", sz: "(min-width: 960px) 640px, 100vw" })}</div>
      </article>
      <article class="tile t-phone">
        <h3>A recovery key</h3>
        <p>The first time you lock, you get a recovery key with Copy and Download buttons, then a check that you saved it. On a new phone, type the key, or approve it from a device you already use after you both compare a 20-digit code.</p>
        <div class="tile__shot">${shot("phone-locked-dm", { alt: "A locked DM on a phone", sz: "210px" })}</div>
      </article>
      <article class="tile t-themes">
        <h3>The owner decides</h3>
        <p>Locking is off by default. The owner turns it on in Admin, with the same two steps. When you remove someone from a locked channel, the messages after that use new keys they can't open.</p>
        <div class="tile__shot">${shot("guide-locked-admin-approve", { alt: "An admin approving a locked channel", sz: "(min-width: 960px) 460px, 100vw" })}</div>
      </article>
      <article class="tile t-slack">
        <h3>The app says what works differently</h3>
        <p>A banner links to "What's different here?". "Search here" looks through messages on your own device. Voice notes say why they have no transcript. Link previews are off, and the message box says so. Notifications only say "New message in a locked conversation". The Slack import skips locked conversations and tells you why.</p>
        <div class="tile__shot">${shot("guide-locked-whats-different", { alt: "The What's different here panel", sz: "(min-width: 960px) 640px, 100vw" })}</div>
      </article>
    </div>
  </div>
</section>

<section class="sec band" aria-labelledby="know-title">
  <div class="wrap rel-two">
    <div class="sec__head"><h2 class="d-l" id="know-title">Before you lock.</h2></div>
    <ul class="rel-list">
      <li>If you lose every device and your recovery key, your locked messages are gone for good. Nobody can bring them back, your admin included.</li>
      <li>The server still sees who is in a locked conversation, who writes and when, and how big the files are. It never sees what anyone writes.</li>
      <li>A locked conversation stays locked. Calls work as usual, but the lock doesn't cover them.</li>
      <li>Outside experts audited the encryption library underneath. Yakyard's own code around it hasn't had an outside audit yet, and we've <a href="/docs/locked/audit">applied for one</a>.</li>
    </ul>
  </div>
</section>

<section class="sec" aria-labelledby="hood-title">
  <div class="wrap rel-two">
    <div class="sec__head"><h2 class="d-l" id="hood-title">Under the hood.</h2><p>For the people who check these things.</p></div>
    <ul class="rel-list">
      <li>Olm and Megolm from vodozemac 0.11.2, the library behind Element's encryption. It's Apache-2.0, was audited by Least Authority in 2022, and runs as WebAssembly: 131 KB gzipped, loaded only when you open a locked conversation. All of it runs in the browser, so Yakyard still fits Cloudflare's free plan.</li>
      <li>The locking package is Apache-2.0, so anyone can read and reuse it: <code>packages/yakyard-lock</code>.</li>
      <li>A web app gets its code from its server. Yakyard shows a security code that changes whenever the locking code does, and <code>npm run lock:verify</code> checks a running server against <a href="/docs/locked/hashes">this release's hashes</a>.</li>
      <li>CodeQL, Semgrep, OpenSSF Scorecard and Dependabot now check every change. The full design and threat model are in <a href="/docs/locked">Locked conversations</a>.</li>
    </ul>
  </div>
</section>

<section class="sec install band" id="update" aria-labelledby="update-title">
  <div class="wrap rel-two">
    <div class="sec__head"><h2 class="d-l" id="update-title">Update.</h2><p>The update adds the new tables by itself. Then, as the owner, open Admin, go to Locked conversations and choose "Turn on".</p></div>
    <div>
      <pre class="rel-code"><code>npm run backup
npm run update</code></pre>
      <p class="rel-new">New to Yakyard? Setup takes about 30 minutes, no coding.</p>
      <div class="btn-row">${deployBtn}<a class="btn btn--ghost" href="/docs/setup">Read the setup guide</a></div>
    </div>
  </div>
</section>`;

  const v1 = `
<aside class="v2band" aria-label="Release"><div class="wrap"><p><span class="v2band__tag">1.0.0</span> <strong>The first release.</strong> <a href="/releases/2.0.0">See what's new in 2.0.0</a></p></div></aside>
<section class="hero rel-hero" aria-labelledby="rel-title">
  <div class="wrap">
    <h1 class="d-xl" id="rel-title"><span class="l">Yakyard 1.0.0.</span> <span class="l hot"><span class="stamp">Pay nobody.</span></span></h1>
    <div class="rel-hero__grid">
      <div>
        <p class="lede">Team chat you run on your own Cloudflare account. Free for teams of up to about 50 people. No per-seat bill, no server to look after.</p>
        <div class="btn-row">${deployBtn}<a class="btn btn--ghost" href="/docs/setup">Read the setup guide</a></div>
      </div>
      <div class="rel-shot">${shot("hero-light", { alt: "Yakyard in a browser: a channel with messages, a thread, reactions and a voice note", sz: "(min-width: 960px) 720px, 100vw", eager: true })}</div>
    </div>
  </div>
</section>

<section class="sec" aria-labelledby="in-title">
  <div class="wrap">
    <div class="sec__head"><h2 class="d-l" id="in-title">Talk the way you already do.</h2><p>Public and private channels, threads, DMs and group messages, mentions, reactions and pins. Buttons for bold, lists, quotes and code. Files, photos and videos up to 1 GB, with link previews.</p></div>
    <div class="bento">
      <article class="tile t-thread">
        <h3>Talk out loud</h3>
        <p>Voice notes up to 15 minutes with a live waveform. Each gets a written transcript (Whisper on Cloudflare Workers AI) you can search. "Pop in" starts a call in any channel or DM, with camera and screen share.</p>
        <div class="tile__shot">${shot("voice-note-transcript", { alt: "A voice note with its transcript", sz: "(min-width: 960px) 640px, 100vw" })}</div>
      </article>
      <article class="tile t-phone">
        <h3>Take it everywhere</h3>
        <p>Installs like an app on iPhone, Android, Mac and Windows, with push notifications, quiet hours, muted channels and VIPs.</p>
        <div class="tile__shot">${shot("phone-yaky-channel", { alt: "A channel on a phone in the Yaky theme", sz: "210px" })}</div>
      </article>
      <article class="tile t-themes">
        <h3>Find it later</h3>
        <p>Search with <code>from:</code>, <code>in:</code>, <code>has:</code>, <code>before:</code> and <code>after:</code>. Activity, Threads, Mentions, Files and Later each get a page. Schedule messages, set reminders, save things for Later.</p>
        <div class="tile__shot">${shot("search-voice", { alt: "Search results with filters", sz: "(min-width: 960px) 460px, 100vw" })}</div>
      </article>
      <article class="tile t-slack">
        <h3>Leave Slack with your history</h3>
        <p>Each person copies their own Slack DMs, group messages and private channels, with files and reactions. Invite links, Sign in with Google for your domain, and guests who only see the channels you give them.</p>
        <div class="tile__shot">${shot("slack-import", { alt: "The Import from Slack page after a finished import", sz: "(min-width: 960px) 640px, 100vw" })}</div>
      </article>
    </div>
  </div>
</section>

<section class="sec band" aria-labelledby="run-title">
  <div class="wrap rel-two">
    <div class="sec__head"><h2 class="d-l" id="run-title">Run it without a server.</h2><p>Deploy with one command or the button. Updates, backups and restores are one command each. Every request fits in Cloudflare's free 10 ms of CPU, and each background job gets its own.</p></div>
    <ul class="rel-list">
      <li>Cloudflare only. There's no App Store app (it's an installable web app) and no support contract.</li>
      <li>Messages are readable to whoever controls your Cloudflare account. Locked, end-to-end encrypted conversations came later, in <a href="/releases/2.0.0">2.0.0</a>.</li>
      <li>Calls suit small groups. Slack's public channel history stays in Slack.</li>
      <li>Free and source-available under PolyForm Shield 1.0.0: any business can use it, and nobody can resell it.</li>
    </ul>
  </div>
</section>`;
  return [
    ["/releases/2.0.0", layout({ title: "Yakyard 2.0.0: locked conversations", description: "Yakyard 2.0.0 lets you lock a DM or private channel so only the people in it can read it.", urlPath: "/releases/2.0.0", og: "home", ogType: "article", body: v2 })],
    ["/releases/1.0.0", layout({ title: "Yakyard 1.0.0: the first release", description: "The first Yakyard release: free team chat on your own Cloudflare account.", urlPath: "/releases/1.0.0", og: "home", ogType: "article", body: v1 })],
  ];
}
