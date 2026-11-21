// Password stretching runs here, in your browser (PBKDF2-SHA256, 600,000 rounds), so the server only does
// one quick hash and sign-in fits the free plan's 10 ms CPU limit. The password itself is never sent,
// except once to upgrade an account made before this change.
(() => {
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  async function derive(password, saltB64, iter = 600000) {
    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256));
  }
  async function saltOf(email) {
    const r = await fetch('/auth/salt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    if (r.status === 429) throw new Error((await r.json()).error);
    if (!r.ok) throw new Error();
    return r.json();
  }
  const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));
  window.yyKdf = { derive, saltOf, newSalt };

  const put = (f, name, value) => { let i = f.querySelector(`input[type=hidden][name="${name}"]`); if (!i) { i = document.createElement('input'); i.type = 'hidden'; i.name = name; f.append(i); } i.value = value; };
  for (const f of document.querySelectorAll('form[data-kdf]')) {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = f.querySelector('[data-pw]'), btn = f.querySelector('button[type=submit]');
      if (!f.reportValidity()) return;
      const label = btn.textContent; btn.disabled = true; btn.textContent = 'One moment…';
      try {
        if (f.dataset.kdf === 'login') {
          const s = await saltOf(f.querySelector('[name=email]').value.trim().toLowerCase());
          put(f, 'key', await derive(pw.value, s.salt, s.iter));
          if (s.legacy) put(f, 'password', pw.value);
        } else {
          put(f, 'key', await derive(pw.value, f.querySelector('[name=salt]').value));
          put(f, 'len', String(pw.value.length));
        }
        f.submit();
      } catch (er) {
        btn.disabled = false; btn.textContent = label;
        let p = f.parentNode.querySelector('.login-error');
        if (!p) { p = document.createElement('p'); p.className = 'login-error'; p.setAttribute('role', 'alert'); f.before(p); }
        p.textContent = er.message || "Can't reach your server. Try again.";
      }
    });
  }
})();
