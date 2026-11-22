# Security checks against a local server. Run: npm run db:init:local, then npx wrangler dev --local --port 8797, then python3 test/security.py (needs requests and playwright).
import json, re, socket, subprocess, time, base64, os, sys, hashlib
import requests

# The sign-in pages stretch the password in the browser (public/auth.js). This does the same for forms the
# tests post with a plain 'password', so the checks below read like a person filling in the forms.
def kdf(pw, salt_b64, it=600000):
    return base64.b64encode(hashlib.pbkdf2_hmac('sha256', pw.encode(), base64.b64decode(salt_b64), it)).decode()
def kdf_form(url, data):
    if not isinstance(data, dict) or 'password' not in data or data.get('_raw'):
        return {k: v for k, v in (data or {}).items() if k != '_raw'} if isinstance(data, dict) else data
    d = dict(data); pw = d.pop('password')
    if url.endswith('/auth/login'):
        s = requests.post(B + '/auth/salt', json={'email': d.get('email', '').lower()}).json()
        d['key'] = kdf(pw, s['salt'], s['iter'])
    else:
        salt = base64.b64encode(os.urandom(16)).decode()
        d.update(salt=salt, key=kdf(pw, salt), len=str(len(pw)))
    return d
_post, _spost = requests.post, requests.Session.post
requests.post = lambda url, data=None, **kw: _post(url, data=kdf_form(url, data), **kw)
requests.Session.post = lambda self, url, data=None, **kw: _spost(self, url, data=kdf_form(url, data), **kw)

B = os.environ.get('YY_BASE', 'http://localhost:8797')   # YY_BASE / YY_PERSIST let tests use another port and database copy
WS = B.replace('http', 'ws', 1)
PORT = B.rsplit(':', 1)[1]
PERSIST = ['--persist-to=' + os.environ['YY_PERSIST']] if os.environ.get('YY_PERSIST') else []
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
    out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'DB', '--local', *PERSIST, '--json', '--command', sql],
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
    path = '/' + link.split('/', 3)[3]
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
    s = socket.create_connection(('localhost', int(PORT)))
    key = base64.b64encode(os.urandom(16)).decode()
    req = (f'GET /ws HTTP/1.1\r\nHost: localhost:{PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
           f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nCookie: yy_session={cookie}\r\n'
           + (f'Origin: {origin}\r\n' if origin else '') + '\r\n')
    s.sendall(req.encode()); data = s.recv(200).decode(errors='ignore'); s.close()
    return int(data.split(' ')[1])
ck = owner.cookies.get('yy_session')
check('M5 /ws from other origin refused', ws_status('http://evil.example', ck) == 403)
check('M5 /ws from same-site other subdomain refused', ws_status(B.replace('localhost', 'blog.localhost'), ck) == 403)
check('M5 /ws without Origin refused', ws_status(None, ck) == 403)
check('M5 /ws from own origin accepted', ws_status(B, ck) == 101)

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
check('L9 shell connect-src limited to own ws host', WS in csp and ' wss:;' not in csp, csp)

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
dk = 'A' * 43 + '='
t0 = time.time(); requests.post(B + '/auth/login', data={'email': 'owner@example.com', 'key': dk}); ta = time.time() - t0
t0 = time.time(); requests.post(B + '/auth/login', data={'email': 'nobody@example.com', 'key': dk}); tb = time.time() - t0
print(f'  timing: existing {ta*1000:.0f} ms, unknown {tb*1000:.0f} ms')
check('M6 unknown email does the same server work (timing within 3x)', tb > ta / 3 and ta > tb / 3, (ta, tb))

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
    page.evaluate('''() => new Promise((ok) => { window.evts = []; const w = new WebSocket(location.origin.replace('http', 'ws') + '/ws'); window.w = w;
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

# ---------------- free plan: client-side password stretching
s1 = requests.post(B + '/auth/salt', json={'email': 'nobody@example.com'}).json()
s2 = requests.post(B + '/auth/salt', json={'email': 'NOBODY@example.com'}).json()
check('KDF salt for an unknown email is stable and looks real', s1['salt'] == s2['salt'] and len(base64.b64decode(s1['salt'])) == 16 and s1['iter'] == 600000, s1)
s3 = requests.post(B + '/auth/salt', json={'email': 'owner@example.com'}).json()
check('KDF salt reply has the same shape for real and unknown emails', set(s1) == set(s3), (s1, s3))
r = requests.post(B + '/auth/salt', json={'email': 'x@y.z'}, headers={'origin': 'http://evil.example'})
check('KDF salt endpoint refuses other sites', r.status_code == 403)
check('KDF stored hashes are the quick "c1:" kind', all(x['hash'].startswith('c1:') for x in d1('SELECT hash FROM credentials')))
r = requests.post(B + '/auth/login', data={'email': 'owner@example.com', 'password': PW, '_raw': 1}, allow_redirects=False)
check('KDF sign-in without the browser key is refused', r.status_code == 200 and 'JavaScript' in r.text)
# An account from before this change: server-side PBKDF2 (100k), no marker. The server never checks it (18 ms of CPU)
# and never trusts a new key for it: the person gets a clear message and sets a new password once through a link.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
lsalt = base64.b64encode(os.urandom(16)).decode()
lhash = base64.b64encode(hashlib.pbkdf2_hmac('sha256', b'legacypassword1', base64.b64decode(lsalt), 100000)).decode()
lr = invite(owner, 'legacy@example.com', name='Lee'); lsess = join(lr.json()['link'], 'Lee', 'throwaway12345')
lid = lr.json()['id']
d1(f"UPDATE credentials SET hash='{lhash}', salt='{lsalt}' WHERE user_id='{lid}'")
ls = requests.post(B + '/auth/salt', json={'email': 'legacy@example.com'}).json()
check('KDF salt says "legacy" for an old account, with the message to show', ls['legacy'] is True and 'new password' in ls.get('note', ''), ls)
r = session().post(B + '/auth/login', data={'email': 'legacy@example.com', 'password': 'legacypassword1'}, allow_redirects=False)
check('KDF old account is not signed in, and is told to get a new password', r.status_code == 200 and 'needs a new password' in r.text and 'yy_session' not in r.headers.get('set-cookie', ''), r.status_code)
check('KDF old row is never replaced by a key the server could not check', d1(f"SELECT hash FROM credentials WHERE user_id='{lid}'")[0]['hash'] == lhash)
ghost = next(e for e in ('ghost%d@example.com' % i for i in range(200)) if requests.post(B + '/auth/salt', json={'email': e}).json()['legacy'])
gs = requests.post(B + '/auth/salt', json={'email': ghost}).json()
r = session().post(B + '/auth/login', data={'email': ghost, 'password': 'whatever12345'}, allow_redirects=False)
check('KDF a made-up email that looks old gets the same answer (no account check by message)', 'needs a new password' in r.text and set(gs) == set(ls), (set(gs), set(ls)))
r = api(lsess, 'POST', '/api/me/password', {'key': kdf('legacypassword1', lsalt), 'new_key': kdf('brandnewpass12', lsalt), 'new_salt': lsalt, 'len': 14})
check('KDF signed-in old account cannot change its password without a link', r.status_code == 400 and 'new password' in r.json().get('error', ''), r.text)
r = invite(owner, 'legacy@example.com')
check('KDF the owner can make a new sign-in link for an old account', r.status_code == 200 and '/join/' in r.json().get('link', ''), r.text)
join(r.json()['link'], 'Lee', 'freshpassword12')
r = session().post(B + '/auth/login', data={'email': 'legacy@example.com', 'password': 'freshpassword12'}, allow_redirects=False)
check('KDF old account signs in after setting a new password from a link', r.status_code == 303, r.status_code)
check('KDF its row is now the quick "c1:" kind', d1(f"SELECT hash FROM credentials WHERE user_id='{lid}'")[0]['hash'].startswith('c1:'))
l3 = invite(owner, 'legacy3@example.com', name='Lia'); join(l3.json()['link'], 'Lia', 'throwaway12345')
d1(f"UPDATE credentials SET hash='{lhash}', salt='{lsalt}' WHERE user_id='{l3.json()['id']}'")
out = subprocess.run(['node', 'scripts/signin-link.mjs', 'legacy3@example.com', '--local', *PERSIST, '--url=' + B], cwd=ROOT, capture_output=True, text=True)
m = re.search(r'(http\S+/join/\S+)', out.stdout)
check('npm run signin-link makes a working one-time link for an owner', bool(m), out.stdout + out.stderr)
if m:
    join(m.group(1), 'Lia', 'freshpassword34')
    r = session().post(B + '/auth/login', data={'email': 'legacy3@example.com', 'password': 'freshpassword34'}, allow_redirects=False)
    check('signin-link: new password works', r.status_code == 303)
    check('signin-link: the link works only once', 'expired' in requests.get(m.group(1)).text)
out = subprocess.run(['node', 'scripts/signin-link.mjs', 'nobody@example.com', '--local', *PERSIST], cwd=ROOT, capture_output=True, text=True)
check('signin-link refuses an email with no account', out.returncode == 1 and 'No active account' in out.stderr, out.stderr)
# Password change
pc = session(); pc.post(B + '/auth/login', data={'email': 'dz@example.com', 'password': 'deepassword123'}, headers={'origin': B})
other = session(); other.post(B + '/auth/login', data={'email': 'dz@example.com', 'password': 'deepassword123'}, headers={'origin': B})
cs = requests.post(B + '/auth/salt', json={'email': 'dz@example.com'}).json()
ns = base64.b64encode(os.urandom(16)).decode()
r = api(pc, 'POST', '/api/me/password', {'key': kdf('notmypassword1', cs['salt']), 'new_key': kdf('newdeepassword1', ns), 'new_salt': ns, 'len': 15})
check('password change with the wrong current password refused', r.status_code == 400 and 'current' in r.json().get('error', ''), r.text)
r = api(pc, 'POST', '/api/me/password', {'key': kdf('deepassword123', cs['salt']), 'new_key': kdf('short', ns), 'new_salt': ns, 'len': 5})
check('password change to a short password refused', r.status_code == 400)
r = api(pc, 'POST', '/api/me/password', {'key': kdf('deepassword123', cs['salt']), 'new_key': kdf('newdeepassword1', ns), 'new_salt': ns, 'len': 15})
check('password change works', r.status_code == 200, r.text)
check('password change keeps this session', api(pc, 'GET', '/api/bootstrap').status_code == 200)
check('password change signs out other sessions', api(other, 'GET', '/api/bootstrap').status_code == 401)
r = session().post(B + '/auth/login', data={'email': 'dz@example.com', 'password': 'deepassword123'}, allow_redirects=False)
check('old password no longer works', r.status_code == 200 and 'Wrong email' in r.text)
r = session().post(B + '/auth/login', data={'email': 'dz@example.com', 'password': 'newdeepassword1'}, allow_redirects=False)
check('new password works', r.status_code == 303)
# KDF review gaps: the password field is never posted, limits on the salt and change endpoints, even timing
lp = requests.get(B + '/')
check('KDF password inputs have no name, so a plain form post never sends the password', 'data-pw' in lp.text and not re.search(r'<input[^>]*data-pw[^>]*name=|<input[^>]*name="password"', lp.text), lp.text[:200])
js = requests.get(B + '/auth.js').text
check('KDF auth.js never posts the password, and shows the message for old accounts', "'password'" not in js and 'throw new Error(s.note)' in js)
ts = lambda e: (lambda t0: (requests.post(B + '/auth/salt', json={'email': e}), time.time() - t0)[1])(time.time())
ka = sorted(ts('owner@example.com') for _ in range(5))[2]; kb = sorted(ts('ghost%d@example.com' % i) for i in range(5))[2]
print(f'  salt timing: existing {ka*1000:.0f} ms, unknown {kb*1000:.0f} ms')
check('KDF salt reply takes the same time for real and unknown emails (within 3x)', kb > ka / 3 and ka > kb / 3, (ka, kb))
l2 = invite(owner, 'legacy2@example.com', name='Lou'); join(l2.json()['link'], 'Lou', 'throwaway12345')
d1(f"UPDATE credentials SET hash='{lhash}', salt='{lsalt}' WHERE user_id='{l2.json()['id']}'")
def tl(e):
    t0 = time.time(); requests.post(B + '/auth/login', data={'email': e, 'key': dk, '_raw': 1}); return time.time() - t0
la = sorted(tl('legacy2@example.com') for _ in range(3))[1]; lb = sorted(tl('ghost-legacy@example.com') for _ in range(3))[1]
print(f'  old-account timing: existing {la*1000:.0f} ms, unknown {lb*1000:.0f} ms')
check('KDF old account and unknown email take the same time (within 3x, no slow hash anywhere)', lb > la / 3 and la > lb / 3, (la, lb))
ads_salt = requests.post(B + '/auth/salt', json={'email': 'adm@example.com'}).json()['salt']
codes = [api(ads, 'POST', '/api/me/password', {'key': kdf('wrong%d' % i, ads_salt, 1), 'new_key': dk, 'new_salt': ns, 'len': 15}).status_code for i in range(11)]
check('password change is limited to 10 tries in 15 minutes', codes[:10] == [400] * 10 and codes[10] == 429, codes)

# ---------------- free plan: images through the worker, storage sizes, tighter CSP
r = owner.get(B + '/')
check('CSP img-src no longer allows any https host', "img-src 'self' data: blob:;" in r.headers.get('content-security-policy', ''), r.headers.get('content-security-policy'))
check('image proxy refuses private addresses', api(owner, 'GET', '/api/img?u=' + requests.utils.quote('http://127.0.0.1/x.png')).status_code == 400)
check('image proxy needs sign-in', requests.get(B + '/api/img?u=https://example.com/a.png').status_code == 401)
r = owner.post(B + '/api/upload', files={'file': ('a.txt', b'x' * 1234, 'text/plain')}, headers={'origin': B})
check('upload records the file size (storage cap)', r.status_code == 200 and d1(f"SELECT size FROM files WHERE key='{r.json()['key']}'")[0]['size'] == 1234, r.text)

# ---------------- review nits
p0 = api(owner, 'POST', f'/api/channels/{general}/messages', {'text': 'parent'}).json()['id']
rp = api(owner, 'POST', f'/api/channels/{general}/messages', {'text': 'reply', 'thread_id': p0}).json()['id']
r = api(owner, 'POST', f'/api/channels/{general}/messages', {'text': 'nested', 'thread_id': rp})
check('N3 a reply to a reply is refused', r.status_code == 404, r.status_code)
api(owner, 'DELETE', f'/api/messages/{rp}')
check('N16 deleting a reply lowers the reply count', d1(f"SELECT reply_count FROM messages WHERE id='{p0}'")[0]['reply_count'] == 0)
check('N15 guests cannot change a topic', api(g, 'PATCH', f'/api/channels/{general}', {'topic': 'hi'}).status_code == 403)

# ---------------- L2 presence: a guest only hears about people they share a conversation with
lonely = invite(owner, 'lonely@example.com', name='Lonny'); lon = join(lonely.json()['link'], 'Lonny')
lon_id = lonely.json()['id']
api(owner, 'POST', f"/api/channels/{general}/remove", {'user_id': lon_id})
for c in api(lon, 'GET', '/api/bootstrap').json()['channels']:
    api(lon, 'POST', f"/api/channels/{c['id']}/leave", {})
with sync_playwright() as p:
    br = p.chromium.launch()
    def ws_ctx(sess):
        c = br.new_context(); c.add_cookies([{'name': 'yy_session', 'value': sess.cookies.get('yy_session'), 'domain': 'localhost', 'path': '/'}])
        pg = c.new_page(); pg.goto(B + '/sw.js')
        pg.evaluate('''() => new Promise((ok) => { window.evts = []; const w = new WebSocket(location.origin.replace('http', 'ws') + '/ws'); window.w = w;
            w.onmessage = (e) => window.evts.push(JSON.parse(e.data)); w.onopen = () => ok(); })''')
        return pg
    lp = ws_ctx(lon); gp = ws_ctx(g); op = ws_ctx(owner)
    gp.wait_for_timeout(1500); op.wait_for_timeout(300)
    gpres = [e for e in gp.evaluate('window.evts') if e.get('type') == 'presence']
    opres = [e for e in op.evaluate('window.evts') if e.get('type') == 'presence']
    check('L2 members see everyone online', opres and lon_id in opres[-1]['online'], opres[-1:] if opres else None)
    check('L2 guest does not see people they share nothing with', gpres and lon_id not in gpres[-1]['online'] and me in gpres[-1]['online'], gpres[-1:] if gpres else None)
    br.close()

# ---------------- locked conversations (end-to-end encrypted): the server only ever holds ciphertext
lk = {}
for em, nm in [('lka@example.com', 'Lina'), ('lkb@example.com', 'Milo'), ('lkc@example.com', 'Nora')]:
    rr = invite(owner, em, name=nm); lk[nm] = (join(rr.json()['link'], nm, nm.lower() + 'password1'), rr.json()['id'])
(la, la_id), (lb, lb_id), (lc, lc_id) = lk['Lina'], lk['Milo'], lk['Nora']
r = api(la, 'POST', '/api/dm', {'user_ids': [lb_id], 'lock': True})
check('LOCK off by default: nobody can lock a conversation', r.status_code == 403, r.text)
check('LOCK only the owner turns it on', api(la, 'POST', '/api/e2ee/allow', {'on': True, 'confirm': 'lock'}).status_code == 403)
check('LOCK owner must type the confirmation', api(owner, 'POST', '/api/e2ee/allow', {'on': True}).status_code == 400)
check('LOCK owner turns it on', api(owner, 'POST', '/api/e2ee/allow', {'on': True, 'confirm': 'lock'}).status_code == 200)
ldm = api(la, 'POST', '/api/dm', {'user_ids': [lb_id], 'lock': True}).json()
check('LOCK DM waits for the other person', ldm.get('locked') == 2, ldm)
check('LOCK nobody posts while waiting', api(la, 'POST', f"/api/channels/{ldm['id']}/messages", {'enc': '{"v":1}'}).status_code == 403)
check('LOCK the other person accepts, then it locks', api(lb, 'POST', f"/api/channels/{ldm['id']}/lock/accept", {}).json().get('locked') == 1)
lch = api(la, 'POST', '/api/channels', {'name': 'lk-room', 'lock': True}).json()
check('LOCK channel waits for an admin and is private', lch.get('locked') == 2 and lch.get('private') == 1, lch)
check('LOCK a member cannot approve a channel', api(la, 'POST', f"/api/channels/{lch['id']}/lock/approve", {}).status_code == 403)
check('LOCK the owner approves the channel', api(owner, 'POST', f"/api/channels/{lch['id']}/lock/approve", {}).json().get('locked') == 1)
api(la, 'POST', f"/api/channels/{lch['id']}/members", {'user_ids': [lb_id, lc_id]})
check('LOCK plaintext is refused in a locked conversation', api(la, 'POST', f"/api/channels/{ldm['id']}/messages", {'text': 'plain'}).status_code == 400)
check('LOCK scheduled messages are refused', api(la, 'POST', '/api/scheduled', {'channel_id': ldm['id'], 'text': 'x', 'send_at': int(time.time() * 1000) + 3600e3}).status_code == 400)
check('LOCK a locked channel cannot be made public', api(owner, 'POST', f"/api/channels/{lch['id']}/manage", {'private': False}).status_code == 400)

ENGINE = """async (me) => {
  const L = await import('/lock/lock.js'), St = await import('/lock/store-idb.js'), W = await import('/lock/yakyard-crypto.js');
  await W.default({ module_or_path: '/lock/yakyard-crypto_bg.wasm' });
  const api = async (p, o = {}) => { const r = await fetch(p, { method: o.method || 'GET', headers: o.body ? { 'content-type': 'application/json' } : {}, body: o.body ? JSON.stringify(o.body) : undefined }); const d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); return d; };
  window.L = L.createLock({ api, store: await St.openStore(me), wasm: W, me }); await window.L.load(); window.LIB = L; return true; }"""
SEND = """async ([cid, text]) => { const r = await window.L.encryptFor(cid, { t: text });
  const res = await fetch(`/api/channels/${cid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enc: r.enc }) }); return (await res.json()).id; }"""
READ = "async ([cid, from, enc, mid]) => window.L.decrypt(cid, from, enc, mid)"
with sync_playwright() as p:
    br = p.chromium.launch()
    def dev(sess, me):
        c = br.new_context(); c.add_cookies([{'name': 'yy_session', 'value': sess.cookies.get('yy_session'), 'domain': 'localhost', 'path': '/'}])
        pg = c.new_page(); pg.goto(B + '/sw.js'); pg.evaluate(ENGINE, me); return pg
    pa, pb_, pc_ = dev(la, la_id), dev(lb, lb_id), dev(lc, lc_id)
    keys = {}
    for pg, nm in [(pa, 'a'), (pb_, 'b'), (pc_, 'c')]:
        keys[nm] = pg.evaluate("async () => { const i = await window.L.createIdentity(); await i.commit(); return i.recoveryKey; }")
    secret = 'the merger closes on friday'
    mid = pa.evaluate(SEND, [ldm['id'], secret])
    row = d1(f"SELECT text, enc FROM messages WHERE id='{mid}'")[0]
    check('LOCK stored row: text empty, ciphertext only', row['text'] == '' and row['enc'] and secret not in row['enc'], row)
    leak = d1(f"SELECT (SELECT COUNT(*) FROM messages WHERE text LIKE '%merger%' OR enc LIKE '%merger%') m, (SELECT COUNT(*) FROM e2ee_inbox WHERE body LIKE '%merger%') i, (SELECT COUNT(*) FROM e2ee_backup WHERE data LIKE '%merger%') b, (SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH 'merger') f")[0]
    check('LOCK no plaintext in messages, key relay, backup or search index', leak == {'m': 0, 'i': 0, 'b': 0, 'f': 0}, leak)
    inbox_bodies = ' '.join(x['body'] for x in d1('SELECT body FROM e2ee_inbox'))
    check('LOCK key packages on the server are sealed (no keys in the clear)', 'room_key' not in inbox_bodies and '"key"' not in inbox_bodies)
    r = pb_.evaluate(READ, [ldm['id'], la_id, row['enc'], mid])
    check('LOCK the other person decrypts it', r.get('ok') and r['data']['t'] == secret, r)
    # channel: remove Nora, then Lina writes again; Nora's device can't open it
    m1 = pa.evaluate(SEND, [lch['id'], 'before nora left'])
    e1 = d1(f"SELECT enc FROM messages WHERE id='{m1}'")[0]['enc']
    check('LOCK a member reads while in the channel', pc_.evaluate(READ, [lch['id'], la_id, e1, m1]).get('ok') is True)
    api(owner, 'POST', f"/api/channels/{lch['id']}/remove", {'user_id': lc_id})
    m2 = pa.evaluate(SEND, [lch['id'], 'after nora left'])
    e2 = d1(f"SELECT enc FROM messages WHERE id='{m2}'")[0]['enc']
    check('LOCK removal starts a new session', json.loads(e1)['s'] != json.loads(e2)['s'])
    r2 = pc_.evaluate("async (a) => { await window.L.processInbox(); return window.L.decrypt(...a); }", [lch['id'], la_id, e2, m2])
    check('LOCK a removed member cannot decrypt new messages', r2.get('ok') is False, r2)
    check('LOCK a remaining member still can', pb_.evaluate(READ, [lch['id'], la_id, e2, m2]).get('ok') is True)
    # a new device for Milo: nothing without the recovery key, everything with it
    pb2 = dev(lb, lb_id)
    pb2.evaluate("() => indexedDB.databases().then(() => 0)")
    pb2.evaluate("async () => window.L.requestApproval()")
    r3 = pb2.evaluate(READ, [ldm['id'], la_id, row['enc'], mid])
    check('LOCK a new device without the recovery key cannot read old messages', r3.get('ok') is False, r3)
    bad = pb2.evaluate("async (k) => { try { await window.L.restore(k); return 'opened'; } catch (e) { return e.message; } }", keys['a'])
    check("LOCK someone else's recovery key is refused", bad == 'wrong_key', bad)
    pb2.evaluate("async (k) => window.L.restore(k)", keys['b'])
    r4 = pb2.evaluate(READ, [ldm['id'], la_id, row['enc'], mid])
    check('LOCK with the recovery key, the new device reads old messages', r4.get('ok') and r4['data']['t'] == secret, r4)
    # the server can't add a device of its own to someone's account
    d1(f"INSERT INTO e2ee_devices (user_id, device_id, curve, ed, sig, created_at) VALUES ('{lb_id}', 'DSERVERFAKE1', '{'Q' * 43}', '{'Q' * 43}', '{'A' * 86}', 0)")
    pa.evaluate("() => window.L.forgetCaches()")
    pa.evaluate(SEND, [ldm['id'], 'with a fake device around'])
    check('LOCK a device without a valid signature gets no keys', not d1("SELECT id FROM e2ee_inbox WHERE device_id='DSERVERFAKE1'"))
    br.close()
api(owner, 'POST', '/api/e2ee/allow', {'on': False})

# ---------------- background jobs run by themselves (each its own Durable Object alarm)
due = int(time.time() * 1000) + 32000
api(owner, 'POST', '/api/scheduled', {'channel_id': general, 'text': 'sent by its job', 'send_at': due})
api(owner, 'POST', '/api/reminders', {'text': 'job reminder', 'due_at': int(time.time() * 1000) + 5000})
time.sleep(max(0, due / 1000 - time.time()) + 8)
check('jobs: a scheduled message is sent at its time, once', len(d1("SELECT id FROM messages WHERE text='sent by its job'")) == 1)
check('jobs: a reminder arrives as a bot message', len(d1("SELECT id FROM messages WHERE text LIKE 'Reminder: job reminder%'")) == 1)

# ---------------- backup and restore round trip (full-text search tables included)
if PERSIST:
    import tempfile
    tmp = tempfile.mkdtemp()
    run = lambda *a: subprocess.run(['node', *a], cwd=ROOT, capture_output=True, text=True)
    b1 = run('scripts/backup.mjs', '--local', *PERSIST, tmp + '/one.sql')
    r = run('scripts/restore.mjs', tmp + '/one.sql', '--local', '--persist-to=' + tmp + '/db')
    b2 = run('scripts/backup.mjs', '--local', '--persist-to=' + tmp + '/db', tmp + '/two.sql')
    body = lambda f: open(f).read().split('\n', 1)[1]
    check('backup, restore into a new database, backup again: identical', b1.returncode == 0 and r.returncode == 0 and b2.returncode == 0 and body(tmp + '/one.sql') == body(tmp + '/two.sql'), (b1.stderr[-300:], r.stderr[-300:]))
    out = subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to=' + tmp + '/db', '--config', 'wrangler.jsonc', '--json', '--command',
                          "SELECT (SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH 'parent') m, (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger') t"], cwd=ROOT, capture_output=True, text=True).stdout
    res = json.loads(out)[0]['results'][0]
    check('restored database: message search works and triggers are back', res['m'] >= 1 and res['t'] >= 6, res)

# ---------------- KDF salt endpoint limit (last: it uses up this address's allowance)
codes = [requests.post(B + '/auth/salt', json={'email': ('owner@example.com', 'ghost@example.com')[i % 2]}).status_code for i in range(110)]
check('KDF salt endpoint is limited per address (100 in 15 minutes)', 429 in codes and codes[-1] == 429 and codes[-2] == 429, codes[-12:])

print()
print(f"{sum(1 for _, ok in results if ok)}/{len(results)} passed")
sys.exit(0 if all(ok for _, ok in results) else 1)
