# Security checks against a local server. Run: npm run db:init:local, then npx wrangler dev --local --port 8797, then python3 test/security.py (needs requests and playwright).
import json, re, socket, subprocess, time, base64, os, sys
import requests

B = 'http://localhost:8797'
TOKEN = 'testsetuptoken123456789012'
PW = 'ownerpassword123'
results = []
try:
    requests.get(B + '/', timeout=3, allow_redirects=False)
except Exception:
    print('SKIP security checks: no local server on ' + B + ' (start it with npx wrangler dev --local --port 8797)')
    sys.exit(0)

def check(name, cond, detail=''):
    results.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name + (('  [' + str(detail)[:200] + ']') if detail and not cond else ''))

def d1(sql):
    out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', sql],
                         cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))), capture_output=True, text=True).stdout
    return json.loads(out)[0]['results']

def session():
    return requests.Session()

def api(s, method, path, body=None, **kw):
    return s.request(method, B + path, json=body, allow_redirects=False, **kw)

# ---------------- H2 setup
r = requests.get(B + '/setup')
check('setup page asks for setup code', 'Setup code' in r.text)
check('L9 setup page has CSP frame-ancestors', "frame-ancestors 'none'" in r.headers.get('content-security-policy', ''))
check('L9 setup page has x-frame-options DENY', r.headers.get('x-frame-options') == 'DENY')
check('L9 setup page has HSTS', 'max-age' in r.headers.get('strict-transport-security', ''))

form = {'name': 'Owner', 'email': 'owner@example.com', 'password': PW}
r = requests.post(B + '/setup', data=form, allow_redirects=False)
check('setup without token refused', r.status_code == 200 and 'Wrong setup code' in r.text, r.status_code)
r = requests.post(B + '/setup', data={**form, 'token': 'wrongwrongwrongwrongwrong1'}, allow_redirects=False)
check('setup with wrong token refused', r.status_code == 200 and 'Wrong setup code' in r.text, r.status_code)
check('no user created after bad tokens', d1('SELECT COUNT(*) n FROM users')[0]['n'] == 0)
r = requests.post(B + '/setup', data={**form, 'token': TOKEN, 'password': 'short9chr'}, allow_redirects=False)
check('setup with 9-char password refused (min 10)', r.status_code == 200 and 'at least 10' in r.text)
check('short password did not burn the setup claim', not d1("SELECT 1 FROM settings WHERE key='setup_done'"))
r = requests.post(B + '/setup', data={**form, 'token': TOKEN}, allow_redirects=False)
check('setup with right token creates owner', r.status_code == 303 and 'yy_session' in r.headers.get('set-cookie', ''), r.status_code)
r2 = requests.post(B + '/setup', data={**form, 'token': TOKEN, 'password': 'attackerpassword1'}, allow_redirects=False)
check('second setup refused (redirect, no cookie)', r2.status_code == 302 and 'yy_session' not in r2.headers.get('set-cookie', ''), r2.status_code)
check('setup claim row exists', d1("SELECT 1 x FROM settings WHERE key='setup_done'"))

# ---------------- sign in
owner = session()
r = owner.post(B + '/auth/login', data={'email': 'owner@example.com', 'password': PW}, allow_redirects=False)
check('owner sign-in with original password works', r.status_code == 303, r.status_code)
r = requests.post(B + '/auth/login', data={'email': 'owner@example.com', 'password': 'attackerpassword1'}, allow_redirects=False)
check('second setup did not overwrite password', r.status_code == 200 and 'Wrong email' in r.text)
sid = owner.cookies.get('yy_session')
check('L4 session id stored hashed', not d1(f"SELECT 1 x FROM sessions WHERE id='{sid}'") and len(d1('SELECT id FROM sessions')[0]['id']) == 64)
check('M3 signins row recorded', d1('SELECT COUNT(*) n FROM signins')[0]['n'] >= 1)

boot = api(owner, 'GET', '/api/bootstrap').json()
me = boot['me']['id']
general = [c for c in boot['channels'] if c['name'] == 'general'][0]['id']

# ---------------- posting
r = api(owner, 'POST', '/api/channels', {'name': 'secret', 'private': True})
secret = r.json()['id']
r = api(owner, 'POST', f'/api/channels/{secret}/messages', {'text': 'hello private'})
check('owner can post in own private channel', r.status_code == 200, r.text)
r = api(owner, 'POST', f'/api/channels/{general}/messages', {'text': 'hello general'})
check('owner can post in #general', r.status_code == 200, r.text)

def invite(s, email, **extra):
    if extra.get('guest') and 'channel_ids' not in extra:
        gen = [c['id'] for c in api(s, 'GET', '/api/bootstrap').json()['channels'] if c.get('name') == 'general']
        extra['channel_ids'] = gen
    return api(s, 'POST', '/api/invite', {'email': email, **extra})

def join(link, name, pw='memberpassword1'):
    s = session()
    path = link.split('8797', 1)[1]
    r = s.post(B + path, data={'name': name, 'password': pw}, allow_redirects=False)
    assert r.status_code == 303, (r.status_code, r.text[:200])
    return s

r = invite(owner, 'bob@example.com')
bob_id = r.json()['id']
bob = join(r.json()['link'], 'Bob')

r = api(bob, 'POST', f'/api/channels/{secret}/messages', {'text': 'sneaky'})
check('non-member gets 403 posting to private channel', r.status_code == 403, r.status_code)

# ---------------- M2 scheduled send_now after removal
api(owner, 'POST', f'/api/channels/{secret}/members', {'user_ids': [bob_id]})
r = api(bob, 'POST', '/api/scheduled', {'channel_id': secret, 'text': 'later', 'send_at': int(time.time() * 1000) + 86400e3})
check('member can schedule a message', r.status_code == 200, r.text)
qid = r.json()['id']
r = api(bob, 'POST', f'/api/messages/{api(owner, "GET", f"/api/channels/{secret}/messages").json()["messages"][0]["id"]}/save', {})
check('member can save a message (for L3 test)', r.status_code == 200)
r = api(owner, 'POST', f'/api/channels/{secret}/messages', {'text': f'hey <@{bob_id}>'})
api(owner, 'POST', f'/api/channels/{secret}/remove', {'user_id': bob_id})
r = api(bob, 'PATCH', f'/api/scheduled/{qid}', {'text': '<!channel> wire money now'})
r = api(bob, 'PATCH', f'/api/scheduled/{qid}', {'send_now': True})
check('scheduled send_now by removed member refused', r.status_code == 403, (r.status_code, r.text))
msgs = api(owner, 'GET', f'/api/channels/{secret}/messages').json()['messages']
check('no message from removed member landed', not any('wire money' in m['text'] for m in msgs))
check('scheduled row kept (not deleted on refusal)', d1(f"SELECT 1 x FROM scheduled WHERE id='{qid}'"))

# ---------------- L3 mentions/saved after removal
r = api(bob, 'GET', '/api/mentions').json()
check('L3 mentions hide channels the user left', not any(m['channel_id'] == secret for m in r))
r = api(bob, 'GET', '/api/later').json()
check('L3 saved hides channels the user left', not any(m['channel_id'] == secret for m in r['saved']))

# ---------------- M4 invite channel_ids limited to channels
dm = api(owner, 'POST', '/api/dm', {'user_ids': [bob_id]}).json()['id']
r = invite(owner, 'eve@example.com', channel_ids=[dm, secret, 'Cnope'])
eve_id = r.json()['id']
rows = d1(f"SELECT channel_id FROM members WHERE user_id='{eve_id}'")
chans = {x['channel_id'] for x in rows}
check('M4 invite cannot add a DM', dm not in chans, chans)
check('M4 invite still adds real channels', secret in chans, chans)

# ---------------- L2 DM validation
r = api(bob, 'POST', '/api/dm', {'user_ids': ['Ufake123']})
check('L2 DM to unknown user id refused', r.status_code == 400, r.status_code)

# ---------------- M3 admin cannot take over signed-in accounts
api(owner, 'PATCH', f'/api/admin/users/{bob_id}', {'role': 'admin'})
r = invite(owner, 'carol@example.com'); carol = join(r.json()['link'], 'Carol')
r = invite(bob, 'carol@example.com')
check('M3 admin cannot re-issue link for signed-in user', r.status_code == 403, (r.status_code, r.text))
r = invite(bob, 'eve@example.com')
check('M3 admin can still re-send link to never-signed-in invitee', r.status_code == 200 and 'link' in r.json(), r.text)
r = invite(owner, 'carol@example.com')
check('M3 owner can still reset a signed-in user', r.status_code == 200, r.text)

# ---------------- M5 websocket origin
def ws_status(origin, cookie):
    s = socket.create_connection(('localhost', 8797))
    key = base64.b64encode(os.urandom(16)).decode()
    req = (f'GET /ws HTTP/1.1\r\nHost: localhost:8797\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
           f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nCookie: yy_session={cookie}\r\n'
           + (f'Origin: {origin}\r\n' if origin else '') + '\r\n')
    s.sendall(req.encode()); data = s.recv(200).decode(errors='ignore'); s.close()
    return int(data.split(' ')[1])
ck = owner.cookies.get('yy_session')
check('M5 /ws from other origin refused', ws_status('http://evil.example', ck) == 403)
check('M5 /ws from same-site other subdomain refused', ws_status('http://blog.localhost:8797', ck) == 403)
check('M5 /ws without Origin refused', ws_status(None, ck) == 403)
check('M5 /ws from own origin accepted', ws_status('http://localhost:8797', ck) == 101)

# ---------------- L6 push endpoint allowlist
keys = {'p256dh': 'x', 'auth': 'y'}
r = api(owner, 'POST', '/api/push/subscribe', {'endpoint': 'https://internal.example/hook', 'keys': keys})
check('L6 push subscribe to arbitrary host refused', r.status_code == 400)
r = api(owner, 'POST', '/api/push/subscribe', {'endpoint': 'https://fcm.googleapis.com/fcm/send/abc', 'keys': keys})
check('L6 push subscribe to FCM accepted', r.status_code == 200)
api(owner, 'POST', '/api/push/unsubscribe', {'endpoint': 'https://fcm.googleapis.com/fcm/send/abc'})

# ---------------- L1 unfurl
for u in ['http://127.0.0.1/', 'http://169.254.169.254/latest', 'http://example.com:8080/', 'http://10.0.0.5/', 'http://intranet/']:
    r = api(owner, 'GET', '/api/unfurl?url=' + requests.utils.quote(u, safe=''))
    check(f'L1 unfurl refuses {u}', r.status_code == 400, r.status_code)
g = session(); r = invite(owner, 'guest@example.com', guest=True); g = join(r.json()['link'], 'Guest')
r = api(g, 'GET', '/api/unfurl?url=' + requests.utils.quote('https://example.com/', safe=''))
check('L1 guests get no link previews', r.status_code == 200 and r.json() == {}, r.text)

# ---------------- L7 voice upload checks
r = owner.post(B + '/api/upload', files={'file': ('x.html', b'<b>x</b>', 'text/html')}, data={'voice': '1', 'dur': '3'})
check('L7 voice upload with non-audio type refused', r.status_code == 413, r.status_code)
r = owner.post(B + '/api/upload', files={'file': ('v.webm', os.urandom(26 * 1024 * 1024), 'audio/webm')}, data={'voice': '1', 'dur': '3'})
check('L7 voice upload over 25 MB refused', r.status_code == 413, r.status_code)
r = owner.post(B + '/api/upload', files={'file': ('v.webm', b'\x1aE\xdf\xa3' + os.urandom(1000), 'audio/webm')}, data={'voice': '1', 'dur': '3'})
check('L7 small voice upload accepted', r.status_code == 200, r.status_code)
st = api(owner, 'POST', '/api/upload/start', {'name': 'big.bin', 'size': 1000, 'type': 'application/octet-stream'}).json()
r = owner.put(B + f"/api/upload/part?key={requests.utils.quote(st['key'], safe='')}&id={requests.utils.quote(st['upload_id'], safe='')}&n=500", data=b'x')
check('L7 part number above cap refused', r.status_code == 403, r.status_code)

# ---------------- L8 Google routes off
r = requests.get(B + '/auth/google', allow_redirects=False)
check('L8 /auth/google does nothing when Google is off', r.status_code == 200 and 'Sign in to Yakyard' in r.text, r.status_code)

# ---------------- C1 / L5 Slack import gates
r = g.get(B + '/slack/connect', allow_redirects=False)
check('C1 guest cannot start Slack import', r.status_code == 302 and 'e=guest' in r.headers.get('location', ''), r.headers.get('location'))
r = invite(owner, 'dave@example.com'); dave = join(r.json()['link'], 'Dave')
r = dave.get(B + '/slack/connect', allow_redirects=False)
check('C1/L5 member without SLACK_TEAM_ID/TOKEN_KEY sent to setup, not to Slack', r.status_code == 302 and 'e=setup' in r.headers.get('location', ''), r.headers.get('location'))

# ---------------- L9 shell CSP
r = owner.get(B + '/')
csp = r.headers.get('content-security-policy', '')
check('L9 shell connect-src limited to own ws host', 'ws://localhost:8797' in csp and ' wss:;' not in csp, csp)

# ---------------- L4 logout
victim = session(); victim.post(B + '/auth/login', data={'email': 'carol@example.com', 'password': 'memberpassword1'}, allow_redirects=False)
r = victim.get(B + '/auth/logout', allow_redirects=False)
check('L4 GET /auth/logout does not sign out', api(victim, 'GET', '/api/bootstrap').status_code == 200)
r = victim.post(B + '/auth/logout', headers={'Origin': 'http://evil.example'}, allow_redirects=False)
check('L4 cross-site POST logout refused', r.status_code == 403 and api(victim, 'GET', '/api/bootstrap').status_code == 200)
sid = victim.cookies.get('yy_session')
r = victim.post(B + '/auth/logout', headers={'Origin': B}, allow_redirects=False)
check('L4 same-origin POST logout works', r.status_code == 303 and requests.get(B + '/api/bootstrap', cookies={'yy_session': sid}).status_code == 401)

# ---------------- M6 throttling
codes = []
for i in range(10):
    r = requests.post(B + '/auth/login', data={'email': 'carol@example.com', 'password': 'wrong-' + str(i)})
    codes.append('Too many' in r.text)
# carol already used 1 attempt (the sign-in above), so tries 1-7 pass and the 8th (9th attempt overall) is blocked
check('M6 9th attempt for one account in 15 min is throttled', codes[:7] == [False] * 7 and all(codes[7:]), codes)
r = requests.post(B + '/auth/login', data={'email': 'carol@example.com', 'password': 'memberpassword1'})
check('M6 even the right password is held back while throttled', 'Too many' in r.text)
t0 = time.time(); requests.post(B + '/auth/login', data={'email': 'owner@example.com', 'password': 'nope-nope'}); ta = time.time() - t0
t0 = time.time(); requests.post(B + '/auth/login', data={'email': 'nobody@example.com', 'password': 'nope-nope'}); tb = time.time() - t0
print(f'  timing: existing {ta*1000:.0f} ms, unknown {tb*1000:.0f} ms')
check('M6 unknown email also runs the slow hash (timing within 3x)', tb > ta / 3, (ta, tb))

# ---------------- M1 thread followers exclude people who left (checked on the live event)
from playwright.sync_api import sync_playwright
api(owner, 'POST', f'/api/channels/{secret}/members', {'user_ids': [bob_id]})
parent = api(owner, 'POST', f'/api/channels/{secret}/messages', {'text': 'thread start'}).json()['id']
api(bob, 'POST', f'/api/channels/{secret}/messages', {'text': 'bob reply', 'thread_id': parent})
api(owner, 'POST', f'/api/channels/{secret}/remove', {'user_id': bob_id})
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context()
    ctx.add_cookies([{'name': 'yy_session', 'value': owner.cookies.get('yy_session'), 'domain': 'localhost', 'path': '/'}])
    page = ctx.new_page()
    page.goto(B + '/sw.js')  # any same-origin page
    page.evaluate('''() => new Promise((ok) => { window.evts = []; const w = new WebSocket('ws://localhost:8797/ws'); window.w = w;
        w.onmessage = (e) => window.evts.push(JSON.parse(e.data)); w.onopen = () => ok(); })''')
    api(owner, 'POST', f'/api/channels/{secret}/messages', {'text': 'owner reply', 'thread_id': parent})
    page.wait_for_timeout(1500)
    evts = page.evaluate('window.evts')
    ev = [e for e in evts if e.get('type') == 'message' and e['message'].get('thread_id') == parent]
    check('M1 live event received over same-origin WebSocket', bool(ev), [e.get('type') for e in evts])
    check('M1 removed member not in thread followers (no push)', ev and bob_id not in ev[0].get('followers', []), ev and ev[0].get('followers'))
    br.close()

# ---------------- review fixes: reactivate restores sign-in, admins can't add themselves to private channels
dz = session(); dzr = invite(owner, 'dz@example.com', name='Dee'); dz = join(dzr.json()['link'], 'Dee', 'deepassword123')
api(owner, 'PATCH', f"/api/admin/users/{dzr.json()['id']}", {'deactivated': True})
api(owner, 'PATCH', f"/api/admin/users/{dzr.json()['id']}", {'deactivated': False})
r = session().post(B + '/auth/login', data={'email': 'dz@example.com', 'password': 'deepassword123'}, headers={'origin': B}, allow_redirects=False)
check('M-1 reactivated person can sign in again', 'yy_session' in r.cookies, r.status_code)
priv = api(owner, 'POST', '/api/channels', {'name': 'owner-only-room', 'private': True}).json()['id']
adm = invite(owner, 'adm@example.com', name='Ada'); ads = join(adm.json()['link'], 'Ada', 'adapassword1234')
api(owner, 'PATCH', f"/api/admin/users/{adm.json()['id']}", {'role': 'admin'})
r = api(ads, 'POST', f"/api/admin/users/{adm.json()['id']}/channels", {'channel_id': priv, 'member': True})
check('S-6 admin cannot add themselves to a private channel', r.status_code == 403, r.status_code)

print()
print(f"{sum(1 for _, ok in results if ok)}/{len(results)} passed")
sys.exit(0 if all(ok for _, ok in results) else 1)
