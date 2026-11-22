"""Render Yakyard's share images with the real fonts, logo files and screenshots.

Run from the repo root: python3 site/tools/brand_images.py
Needs Python Playwright with Chromium. Writes:
  site/static/og/<page>.png          1200 x 630 share cards for the website
  docs/brand/social-preview.png      1280 x 640 GitHub social preview
  docs/brand/readme-banner-light.png 1760 x 560 README banner (shown at 880 x 280)
  docs/brand/readme-banner-dark.png
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
F = (ROOT / "public/fonts").as_uri()
B = (ROOT / "docs/brand").as_uri()
S = (ROOT / "docs/screens").as_uri()
G = (ROOT / "docs/guide").as_uri()

BASE = f"""
@font-face {{ font-family: R; src: url("{F}/RammettoOne-Regular.woff2"); }}
@font-face {{ font-family: W; src: url("{F}/WixMadeforText-Variable.woff2"); font-weight: 400 800; }}
@font-face {{ font-family: M; src: url("{F}/MartianMono-Variable.woff2"); font-weight: 100 800; }}
* {{ box-sizing: border-box; margin: 0; }}
html, body {{ width: 100%; height: 100%; overflow: hidden; }}
body {{ position: relative; font-family: W; -webkit-font-smoothing: antialiased; }}
.grain {{ position: absolute; inset: 0; pointer-events: none; opacity: .05; mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .07 0 0 0 0 .06 0 0 0 0 .18 0 0 0 .5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }}
.sticker {{ display: inline-block; font: 400 30px/1 R; padding: 16px 26px; border-radius: 999px; border: 3px solid #120f2e;
  box-shadow: inset 0 2px 0 rgba(255,255,255,.5), 0 2px 2px rgba(18,15,46,.05), 0 14px 26px -8px rgba(18,15,46,.14); white-space: nowrap; }}
.frame {{ position: absolute; border-radius: 22px; border: 3px solid #120f2e; overflow: hidden; background: #fff;
  box-shadow: 0 2px 2px rgba(18,15,46,.05), 0 24px 44px -12px rgba(18,15,46,.16), 0 60px 100px -40px rgba(43,27,214,.22); }}
.frame .bar {{ height: 40px; background: #fff8e6; border-bottom: 3px solid #e4decd; display: flex; align-items: center; gap: 8px; padding: 0 18px; }}
.frame .bar i {{ width: 12px; height: 12px; border-radius: 50%; background: #e4decd; }}
.frame img {{ display: block; width: 100%; }}
"""

OG = [
    # name, title, line, screenshot (dir, file), hot word in title
    ("home", "Yak all you want. <span>Pay nobody.</span>", "Free team chat you run on your own Cloudflare account.", (S, "hero-light.png")),
    ("why", "Chat shouldn't be rent.", "Why Yakyard runs free on your own Cloudflare account.", (S, "hero-yaky.png")),
    ("compare", "Yakyard, compared.", "Slack, Teams, Google Chat, Zulip and more. Prices checked 21 November 2026.", (S, "hero-light.png")),
    ("pros-and-cons", "Read the cons first.", "What Yakyard does well, and what it doesn't.", (S, "desktop-dark.png")),
    ("faq", "Straight answers.", "Costs, privacy, phone apps, Slack history and the license.", (S, "help-panel.png")),
    ("docs", "The docs.", "Set it up, use it, run it. Written for people who don't code.", (G, "channel.png")),
    ("setup", "Set up Yakyard, free.", "About 30 minutes on your own Cloudflare account. No coding.", (G, "sign-in.png")),
    ("guide", "Using Yakyard.", "Channels, threads, voice notes, calls, search and Later.", (S, "thread-panel.png")),
    ("technical", "Technical notes.", "Free plan math, settings, updates, backups and how it's built.", (S, "admin-usage.png")),
    ("press", "Press kit.", "Logos, colors, screenshots and copy, free to use.", (S, "hero-yaky.png")),
]


def og_html(title, line, shot):
    return f"""<!doctype html><html><head><style>{BASE}
body {{ background: radial-gradient(900px 520px at 0% 0%, rgba(255,255,255,.75), rgba(255,255,255,0) 60%), #fff8e6; color: #120f2e; }}
.lock {{ position: absolute; left: 64px; top: 58px; height: 46px; }}
h1 {{ position: absolute; left: 64px; top: 170px; width: 560px; font: 400 60px/1.02 R; letter-spacing: -.01em; }}
h1 span {{ color: #ff4b2b; }}
p {{ position: absolute; left: 64px; bottom: 64px; width: 480px; font: 500 25px/1.4 W; color: #5b5670; }}
.frame {{ left: 660px; top: 110px; width: 760px; }}
</style></head><body>
<img class="lock" src="{B}/yakyard-lockup.svg">
<h1>{title}</h1><p>{line}</p>
<div class="frame"><div class="bar"><i></i><i></i><i></i></div><img src="{shot[0]}/{shot[1]}"></div>
<div class="grain"></div></body></html>"""


SOCIAL = f"""<!doctype html><html><head><style>{BASE}
body {{ background: radial-gradient(1000px 600px at 0% 0%, rgba(255,255,255,.10), rgba(255,255,255,0) 60%), linear-gradient(180deg, rgba(18,15,46,0) 55%, rgba(18,15,46,.16)), #2b1bd6; color: #fff; }}
.grain {{ mix-blend-mode: soft-light; opacity: .12; }}
.lock {{ position: absolute; left: 72px; top: 72px; display: flex; align-items: center; gap: 18px; }}
.lock img:first-child {{ width: 68px; height: 68px; }} .lock img:last-child {{ height: 52px; }}
.txt {{ position: absolute; left: 72px; top: 196px; width: 560px; }}
h1 {{ font: 400 48px/1.06 R; color: #ffd93b; letter-spacing: -.01em; }}
h1 span {{ display: block; white-space: nowrap; }}
p {{ margin-top: 26px; width: 440px; font: 500 25px/1.4 W; color: #e6e3ff; }}
.sticker {{ position: absolute; left: 72px; bottom: 72px; background: #ffd93b; color: #120f2e; transform: rotate(-4deg); font-size: 26px; padding: 13px 22px; }}
.frame {{ left: 650px; top: 120px; width: 820px; border-color: #120f2e; box-shadow: 0 30px 60px -20px rgba(8,6,40,.55); }}
</style></head><body>
<div class="lock"><img src="{B}/yakyard-app-icon.svg"><img src="{B}/yakyard-wordmark-reverse.svg"></div>
<div class="txt"><h1><span>Yak all you want.</span><span>Pay nobody.</span></h1>
<p>Free team chat you run on your own Cloudflare account.</p></div>
<span class="sticker">$0 a seat</span>
<div class="frame"><div class="bar"><i></i><i></i><i></i></div><img src="{S}/hero-light.png"></div>
<div class="grain"></div></body></html>"""


def banner(dark):
    ground = "radial-gradient(900px 500px at 0% 0%, rgba(156,147,255,.14), rgba(156,147,255,0) 60%), #120f2e" if dark else \
        "radial-gradient(1100px 600px at 0% 0%, rgba(255,255,255,.8), rgba(255,255,255,0) 60%), radial-gradient(900px 500px at 90% 80%, rgba(255,217,59,.16), rgba(255,217,59,0) 70%), #fff8e6"
    ink = "#fff8e6" if dark else "#120f2e"
    hot = "#ff6b4f" if dark else "#ff4b2b"
    logo = f'<div class="lock"><img src="{B}/yakyard-app-icon.svg" style="width:128px;height:128px"><img src="{B}/yakyard-wordmark-reverse.svg" style="height:98px"></div>' if dark \
        else f'<img class="lock" src="{B}/yakyard-lockup.svg" style="height:128px">'
    border = "#120f2e" if not dark else "#120f2e"
    return f"""<!doctype html><html><head><style>{BASE}
body {{ background: {ground}; color: {ink}; }}
.grain {{ {"mix-blend-mode: soft-light; opacity: .10;" if dark else ""} }}
.lock {{ position: absolute; left: 112px; top: 120px; display: flex; align-items: center; gap: 30px; }}
h1 {{ position: absolute; left: 112px; top: 330px; font: 400 54px/1.05 R; letter-spacing: -.01em; white-space: nowrap; }}
h1 span {{ color: {hot}; }}
.st {{ position: absolute; font-size: 40px; padding: 20px 34px; border-color: {border}; }}
.a {{ right: 300px; top: 92px; background: #ffd93b; color: #120f2e; transform: rotate(-5deg); }}
.b {{ right: 104px; top: 196px; background: #2b1bd6; color: #fff; transform: rotate(4deg); {"border-color:#9c93ff;" if dark else ""} }}
.c {{ right: 200px; top: 318px; background: #ff4b2b; color: #120f2e; transform: rotate(-2deg); }}
.d {{ right: 96px; top: 418px; background: {"#fff8e6" if dark else "#fff"}; color: #120f2e; transform: rotate(3deg); }}
</style></head><body>
{logo}
<h1>Yak all you want. <span>Pay nobody.</span></h1>
<span class="sticker st a">Channels</span><span class="sticker st b">Threads</span><span class="sticker st c">Voice notes</span><span class="sticker st d">Calls</span>
<div class="grain"></div></body></html>"""


def render(page, html, out, w, h, scale=1):
    page.set_viewport_size({"width": w, "height": h})
    tmp = Path("/tmp/yakyard-render.html")
    tmp.write_text(html)
    page.goto(tmp.as_uri(), wait_until="load")
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(150)
    out.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(out))
    print("wrote", out.relative_to(ROOT))


with sync_playwright() as p:
    b = p.chromium.launch()
    one = b.new_page(device_scale_factor=1)
    for name, title, line, shot in OG:
        render(one, og_html(title, line, shot), ROOT / f"site/static/og/{name}.png", 1200, 630)
    render(one, SOCIAL, ROOT / "docs/brand/social-preview.png", 1280, 640)
    render(one, banner(False), ROOT / "docs/brand/readme-banner-light.png", 1760, 560)
    render(one, banner(True), ROOT / "docs/brand/readme-banner-dark.png", 1760, 560)
    b.close()
