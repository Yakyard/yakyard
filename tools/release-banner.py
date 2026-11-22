import sys
from playwright.sync_api import sync_playwright
R='/home/claude/yakyard-gh'
import base64
F1=base64.b64encode(open(R+'/site/dist/fonts/RammettoOne-Regular.woff2','rb').read()).decode()
F2=base64.b64encode(open(R+'/site/dist/fonts/WixMadeforText-Variable.woff2','rb').read()).decode()
mark=open(R+'/docs/brand/yakyard-app-icon.svg').read()
def html(kicker,title,line,pills):
    cols=[('#ffd93b','#120f2e',-4),('#2b1bd6','#fff',3),('#ff4b2b','#120f2e',-2),('#fff','#120f2e',2)]
    ps=''.join(f'<span class="pill" style="background:{c[0]};color:{c[1]};transform:rotate({c[2]}deg);margin-left:{[0,110,40,170][i]}px">{p}</span>' for i,(p,c) in enumerate(zip(pills,cols)))
    return f'''<html><head><style>
@font-face{{font-family:R;src:url(data:font/woff2;base64,{F1})}}
@font-face{{font-family:W;src:url(data:font/woff2;base64,{F2});font-weight:400 800}}
body{{margin:0;width:1760px;height:560px;background:radial-gradient(900px 500px at 0 0,#fffdf6,transparent 70%),radial-gradient(800px 500px at 100% 100%,#fff0c8,transparent 70%),#fff8e6;font-family:W;color:#120f2e;overflow:hidden;position:relative}}
body:after{{content:"";position:absolute;inset:0;opacity:.05;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.9'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E")}}
.l{{position:absolute;left:112px;top:0;height:560px;display:flex;flex-direction:column;justify-content:center;width:1000px}}
.top{{display:flex;align-items:center;gap:26px}} .top svg{{width:96px;height:96px;filter:drop-shadow(0 6px 14px rgba(43,27,214,.18))}}
.k{{font:400 40px R;color:#2b1bd6}} .k b{{color:#ff4b2b;font-weight:400}}
.v{{display:inline-block;margin-left:14px;background:#120f2e;color:#ffd93b;font:700 22px W;padding:6px 16px;border-radius:999px;vertical-align:middle}}
h1{{font:400 76px/1.04 R;margin:40px 0 0;letter-spacing:-.01em}} h1 span{{color:#ff4b2b}}
p{{font:500 30px/1.4 W;color:#5b5670;margin:22px 0 0;max-width:900px}}
.r{{position:absolute;right:120px;top:0;height:560px;display:flex;flex-direction:column;justify-content:center;gap:22px;align-items:flex-start;width:520px}}
.pill{{white-space:nowrap;font:400 32px R;padding:16px 32px;border-radius:999px;border:3px solid #120f2e;box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 10px 22px rgba(18,15,46,.10)}}
</style></head><body><div class="l"><div class="top">{mark}<div class="k">yak<b>y</b>ard <span class="v">{kicker}</span></div></div><h1>{title}</h1><p>{line}</p></div><div class="r">{ps}</div></body></html>'''
jobs=[('release-v2.2','2.2.0','Your server,<br>your <span>chat.</span>','Run Yakyard with Docker on any Linux server. HTTPS from Caddy, and all your data in one volume.',['Docker','HTTPS by Caddy','Backups','Free forever']),
      ('release-v2.1','2.1.0','Now open <span>source.</span>','Apache 2.0, a live demo you can click into, and updates that run by themselves.',['Apache 2.0','Live demo','Auto updates','Nightly backups']),
      ('release-v2','2.0.0','Lock what’s <span>private.</span>','Locked DMs and private channels. Only the people in them can read them. Not the admin, not us.',['Locked','Two approvals','Recovery key','Free']),
      ('release-v1','1.0.0','Yak all you want.<br><span>Pay nobody.</span>','The first release: team chat on your own Cloudflare account, free for teams up to about 50.',['Channels','Threads','Voice notes','Calls'])]
with sync_playwright() as pw:
    b=pw.chromium.launch(); pg=b.new_page(viewport={'width':1760,'height':560})
    for n,k,t,l,ps in jobs:
        if sys.argv[1:] and n not in sys.argv[1:]: continue
        pg.set_content(html(k,t,l,ps)); pg.wait_for_timeout(600); pg.screenshot(path=f'{R}/docs/brand/{n}.png')
    b.close()
