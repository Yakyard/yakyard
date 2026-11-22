// Yakyard website: sticky nav edge, cost calculator, copy buttons, docs table of contents,
// and on the home page the yak (voice, captions, easter egg), the voice note player and the motion loader.
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const me = document.currentScript;

  const nav = document.querySelector(".nav");
  if (nav && "IntersectionObserver" in window) {
    const s = document.createElement("div");
    s.style.cssText = "position:absolute;top:0;height:1px;width:1px";
    document.body.prepend(s);
    new IntersectionObserver(([e]) => nav.classList.toggle("is-stuck", !e.isIntersecting)).observe(s);
  }

  // ---------- sound: only ever after a click, never on its own ----------
  // Clips are fetched as bytes and played through Web Audio. The context is woken inside the first tap or
  // key press (what iOS Safari needs), so a clip that arrives a moment later still plays. Plain <audio> is
  // the fallback for browsers without Web Audio. Sound is on by default; the toggle remembers "off" only.
  const MUTE = "yakyard-mute";
  let soundOn = true;
  try { soundOn = localStorage.getItem(MUTE) !== "1"; localStorage.removeItem("yakyard-sound"); } catch {}
  const snd = document.querySelector(".snd");
  const sndTxt = snd && snd.querySelector(".snd__txt");
  const paintSnd = () => {
    if (!snd) return;
    snd.setAttribute("aria-pressed", String(soundOn));
    snd.title = soundOn ? "Yak sound is on" : "Yak sound is off";
    if (sndTxt) sndTxt.textContent = soundOn ? "Sound on" : "Sound off";
  };
  paintSnd();

  // a small, polite note under the speaker button when sound is off or the browser held it back
  let hintEl = null, hintT = 0;
  function hint(text) {
    if (!snd) return;
    if (!hintEl) {
      hintEl = document.createElement("p");
      hintEl.className = "snd-hint";
      hintEl.setAttribute("role", "status");
      snd.after(hintEl);
    }
    hintEl.textContent = text;
    hintEl.classList.add("is-on");
    clearTimeout(hintT);
    hintT = setTimeout(() => hintEl.classList.remove("is-on"), 3600);
  }
  const unhint = () => { clearTimeout(hintT); hintEl && hintEl.classList.remove("is-on"); };

  const AC = window.AudioContext || window.webkitAudioContext;
  const apple = navigator.vendor === "Apple Computer, Inc.";
  const EXT = (() => { try { return !apple && new Audio().canPlayType('audio/webm; codecs="opus"') ? "webm" : "mp3"; } catch { return "mp3"; } })();
  let ac = null, out = null;
  function ctx() {
    if (!AC) return null;
    if (!ac) {
      try { ac = new AC(); out = ac.createGain(); out.gain.value = soundOn ? 1 : 0; out.connect(ac.destination); }
      catch { ac = null; }
    }
    return ac;
  }
  // call only inside a user gesture: starts (or restarts) the audio context
  function wake() {
    const c = ctx();
    if (!c || c.state === "running") return;
    c.resume().catch(() => {});
    try { const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0); } catch {}
  }
  const GESTURES = ["pointerup", "touchend", "keydown", "click"];
  const onGesture = () => { wake(); if (ac && ac.state === "running") GESTURES.forEach((g) => removeEventListener(g, onGesture, true)); };
  GESTURES.forEach((g) => addEventListener(g, onGesture, { capture: true, passive: true }));

  const raw = new Map(), bufs = new Map();
  function bytes(name, ext = EXT) {
    const k = `${name}.${ext}`;
    if (!raw.has(k)) {
      const p = fetch(`/audio/${k}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
      p.catch(() => raw.delete(k));
      raw.set(k, p);
    }
    return raw.get(k);
  }
  function buffer(name) {
    if (!bufs.has(name)) {
      const c = ctx();
      const dec = (ab) => new Promise((ok, no) => { const r = c.decodeAudioData(ab.slice(0), ok, no); if (r && r.then) r.then(ok, no); });
      const p = bytes(name).then(dec).catch(() => bytes(name, "mp3").then(dec));
      p.catch(() => bufs.delete(name));
      bufs.set(name, p);
    }
    return bufs.get(name);
  }
  const warm = (name) => { bytes(name).catch(() => {}); };

  let cur = null; // one clip at a time, so the yak never talks over itself
  // play(name, seconds, {onStart, onEnd}) -> { stop(), time() }. time() is the audio clock, or null while nothing is audible.
  function play(name, dur, { onStart, onEnd } = {}) {
    cur && cur.stop();
    let done = false, src = null, el = null, t0 = 0, timer = 0;
    const asked = performance.now();
    const h = {
      stop() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (src) { src.onended = null; try { src.stop(); } catch {} }
        if (el) { el.onended = null; el.pause(); }
        if (cur === h) cur = null;
        if (navigator.audioSession) try { navigator.audioSession.type = "auto"; } catch {}
        onEnd && onEnd();
      },
      time() {
        if (done) return null;
        if (src) return ac.currentTime - t0;
        if (el && !el.paused && el.currentTime > 0) return el.currentTime;
        return null;
      },
    };
    cur = h;
    const endIn = (s) => { clearTimeout(timer); timer = setTimeout(() => h.stop(), s * 1000); };
    endIn(dur + 0.8); // captions always finish, sound or not
    if (!soundOn) { hint("Sound is off. Turn it on with the speaker button."); return h; }
    unhint();
    const started = (len) => { endIn(len + 0.6); onStart && onStart(); };
    const blocked = () => { if (!done) hint("Your browser held the sound back. Tap again to hear the yak."); };
    const viaElement = () => {
      el = new Audio(`/audio/${name}.${EXT}`);
      el.onended = () => h.stop();
      const p = el.play();
      if (p && p.then) p.then(() => started(dur), blocked); else started(dur);
    };
    const c = ctx();
    if (!c) { viaElement(); return h; }
    wake();
    if (navigator.audioSession) try { navigator.audioSession.type = "playback"; } catch {} // plays with the iPhone's silent switch on, like a video
    buffer(name).then((b) => {
      if (done) return;
      const go = () => {
        if (done) return;
        if (c.state !== "running") return blocked();
        if (performance.now() - asked > 2500) return hint("The yak's voice is still on its way. Tap again in a second.");
        src = c.createBufferSource();
        src.buffer = b;
        src.connect(out);
        src.onended = () => h.stop();
        src.start();
        t0 = c.currentTime;
        started(b.duration);
      };
      if (c.state === "running") go();
      else Promise.race([c.resume(), new Promise((r) => setTimeout(r, 2000))]).then(go, go);
    }, () => { if (!done) hint("The yak's voice didn't load. Tap again to try once more."); });
    return h;
  }

  snd?.addEventListener("click", () => {
    soundOn = !soundOn;
    try { soundOn ? localStorage.removeItem(MUTE) : localStorage.setItem(MUTE, "1"); } catch {}
    paintSnd();
    if (out) out.gain.setTargetAtTime(soundOn ? 1 : 0, ac.currentTime, 0.015);
    if (soundOn) { wake(); unhint(); }
  });
  // for the site's own audio check (and curious people): is the yak audible right now?
  window.yakyardSound = { position: () => (cur ? cur.time() : null), state: () => (ac ? ac.state : "none"), on: () => soundOn };

  // fetch the clips (about 70 KB) once the page is idle, so the first tap answers at once. Nothing plays until a tap.
  const preload = () => ["hi-1", "hi-2", "note"].forEach(warm);
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(preload, { timeout: 4000 });

  // ---------- the yak ----------
  const LINES = [
    ["hi-1", "Yak all you want. Pay nobody.", 2.4],
    ["hi-2", "Quiet in here. Say something.", 2.3],
    ["hi-3", "Zero dollars a seat. I checked.", 2.4],
    ["hi-4", "Your chat lives on your account. Not mine.", 2.9],
  ];
  const EGG = ["egg", "Okay, okay. I'm a yak, not a doorbell.", 2.7];
  let lineIx = 0, clicks = 0, clickT = 0;

  function retrigger(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    clearTimeout(el["_" + cls]);
    el["_" + cls] = setTimeout(() => el.classList.remove(cls), ms);
  }

  function talk(yak, line) {
    const say = yak.parentElement.querySelector(".say");
    const [file, text, dur] = line;
    document.querySelectorAll(".yak.is-talking").forEach((y) => y.classList.remove("is-talking"));
    yak.classList.add("is-talking");
    if (!reduce) retrigger(yak, "is-wiggle", 700);
    if (say) { clearTimeout(yak._hide); say.textContent = text; say.classList.add("is-on"); }
    play(file, dur, {
      onEnd: () => {
        yak.classList.remove("is-talking");
        clearTimeout(yak._hide);
        yak._hide = setTimeout(() => say && say.classList.remove("is-on"), 1400);
      },
    });
  }

  function egg(origin) {
    const targets = [origin, ...document.querySelectorAll("[data-yak-logo]")];
    if (!reduce) {
      targets.forEach((t) => retrigger(t, "is-spin", 800));
      confetti(origin);
    }
  }

  function confetti(from) {
    const r = from.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const colors = ["#ffd93b", "#2b1bd6", "#ff4b2b"];
    for (let i = 0; i < 26; i++) {
      const b = document.createElement("span");
      b.className = "bub-bit";
      b.style.background = colors[i % colors.length];
      document.body.append(b);
      const a = (Math.PI * 2 * i) / 26 + Math.random() * 0.4;
      const d = 70 + Math.random() * 90;
      const dx = Math.cos(a) * d, dy = Math.sin(a) * d - 40;
      const rot = (Math.random() - 0.5) * 300;
      const s = 0.7 + Math.random() * 0.6;
      b.animate([
        { transform: `translate(${cx}px, ${cy}px) scale(.4)`, opacity: 1 },
        { transform: `translate(${cx + dx}px, ${cy + dy}px) rotate(${rot / 2}deg) scale(${s})`, opacity: 1, offset: 0.45 },
        { transform: `translate(${cx + dx * 1.25}px, ${cy + dy + 140}px) rotate(${rot}deg) scale(${s * 0.8})`, opacity: 0 },
      ], { duration: 950 + Math.random() * 350, easing: "cubic-bezier(.23, 1, .32, 1)" }).onfinish = () => b.remove();
    }
  }

  function countClick(el) {
    const now = performance.now();
    clicks = now - clickT < 1800 ? clicks + 1 : 1;
    clickT = now;
    if (clicks >= 5) { clicks = 0; egg(el); return true; }
    return false;
  }

  document.querySelectorAll("[data-yak]").forEach((yak) => {
    yak.addEventListener("pointerenter", () => LINES.forEach(([f]) => warm(f)), { once: true });
    yak.addEventListener("click", () => {
      if (countClick(yak)) { talk(yak, EGG); return; }
      talk(yak, LINES[lineIx++ % LINES.length]);
    });
  });
  const hero = document.querySelector(".yak--hero");
  if (hero) {
    // after the intro the yak offers to talk once, quietly, so people know it has a voice. Never plays by itself.
    setTimeout(() => {
      hero.classList.remove("is-intro");
      const say = hero.parentElement.querySelector(".say");
      if (!say || say.classList.contains("is-on") || scrollY > innerHeight / 2) return;
      say.setAttribute("aria-live", "off");
      say.textContent = "Poke me. I talk.";
      say.classList.add("is-on", "is-invite");
      hero._hide = setTimeout(() => say.classList.remove("is-on"), 5200);
      hero.addEventListener("click", () => { say.setAttribute("aria-live", "polite"); say.classList.remove("is-invite"); }, { once: true, capture: true });
    }, 3600);
  }

  // nav logo on the home page: you're already home, so it types back instead of reloading
  const logo = document.querySelector("[data-yak-logo]");
  if (logo) {
    logo.addEventListener("click", (e) => {
      e.preventDefault();
      if (scrollY > 40) scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      if (countClick(logo)) { const h = document.querySelector(".yak--hero"); talk(h || logo, EGG); egg(logo); return; }
      if (!reduce) retrigger(logo, "is-typing", 1900);
    });
    if (!reduce) {
      // now and then the logo types, like someone is about to say something. Three times, then it rests.
      let n = 0;
      const id = setInterval(() => {
        if (document.hidden) return;
        retrigger(logo, "is-typing", 1900);
        if (++n >= 3) clearInterval(id);
      }, 11000);
    }
  }

  // ---------- voice note player: waveform and transcript follow the audio ----------
  const chat = document.getElementById("chat");
  if (chat) {
    const btn = chat.querySelector(".vn__play");
    const bars = [...chat.querySelectorAll(".vn__wave i")];
    const words = [...chat.querySelectorAll(".vn__tx .wd")];
    const tx = chat.querySelector(".vn__tx");
    const time = chat.querySelector(".vn__time");
    const yakAv = chat.querySelector(".msg--yak .av");
    const dur = +chat.dataset.dur;
    const total = Math.round(dur - 0.4);
    let raf = 0, start = 0, clip = null;
    const fmt = (s) => "0:" + String(Math.max(0, Math.floor(s))).padStart(2, "0");
    const paint = (t) => {
      const p = t / dur;
      bars.forEach((b, i) => b.classList.toggle("on", i / bars.length < p));
      let cur = -1;
      words.forEach((w, i) => { const said = +w.dataset.t <= t; w.classList.toggle("said", said); if (said) cur = i; });
      words.forEach((w, i) => w.classList.toggle("now", i === cur && t < dur - 0.3));
      time.textContent = fmt(t);
    };
    const reset = () => {
      cancelAnimationFrame(raf);
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", `Play the yak's voice note, ${total} seconds`);
      tx.classList.remove("is-playing");
      bars.forEach((b) => b.classList.remove("on"));
      words.forEach((w) => w.classList.remove("said", "now"));
      time.textContent = fmt(total);
    };
    const tick = () => {
      // the audio clock when it's really playing, a plain clock when sound is off or blocked
      const a = clip && soundOn ? clip.time() : null;
      const t = a != null ? a : (performance.now() - start) / 1000;
      paint(Math.min(t, dur));
      if (t >= dur) { clip && clip.stop(); return; }
      raf = requestAnimationFrame(tick);
    };
    btn.addEventListener("pointerenter", () => warm("note"), { once: true });
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-pressed") === "true") { clip && clip.stop(); return; }
      start = performance.now();
      clip = play("note", dur, { onStart: () => { start = performance.now(); }, onEnd: () => { clip = null; reset(); } });
      btn.classList.remove("is-invite");
      btn.setAttribute("aria-pressed", "true");
      btn.setAttribute("aria-label", "Pause the yak's voice note");
      tx.classList.add("is-playing");
      if (!reduce && yakAv) retrigger(yakAv, "is-wiggle", 700);
      raf = requestAnimationFrame(tick);
    });
  }

  // ---------- cost calculator. Prices: docs/sources.md, checked 21 November 2026. ----------
  const calc = document.getElementById("calc");
  if (calc) {
    const range = calc.querySelector("#people");
    const out = calc.querySelector("#people-out");
    const bill = document.getElementById("bill");
    const say = document.getElementById("bill-say");
    const el = (k) => bill.querySelector(`[data-k="${k}"]`);
    const setText = (k, v) => { const e = el(k); if (e.textContent !== v) e.textContent = v; };
    const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
    const shown = { slack: 0, google: 0, teams: 0, us: 0 };
    const want = { ...shown };
    let anim = 0, seen = reduce || !("IntersectionObserver" in window);
    const draw = () => {
      for (const k of Object.keys(shown)) {
        if (k === "teams" && want.teams == null) { setText("teams", "Not listed"); continue; }
        setText(k, usd(shown[k]));
      }
    };
    const tween = (ms) => {
      cancelAnimationFrame(anim);
      const from = { ...shown }, t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
        for (const k of Object.keys(shown)) shown[k] = want[k] == null ? 0 : from[k] + (want[k] - from[k]) * e;
        draw();
        if (p < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    };
    const bars = () => {
      const max = Math.max(...Object.values(want).filter((v) => v != null), 1);
      for (const k of Object.keys(want)) {
        const i = el(k).parentElement.querySelector(".bar i");
        if (i) i.style.transform = `scaleX(${seen ? (want[k] || 0) / max : 0})`;
      }
    };
    let sayT = 0;
    const update = (instant) => {
      const n = +range.value;
      const yearly = calc.querySelector('input[name="billing"]:checked').value === "y";
      out.textContent = n;
      range.style.setProperty("--fill", ((n - range.min) / (range.max - range.min)) * 100 + "%");
      want.slack = n * (yearly ? 7.25 : 8.75) * 12;
      setText("slack-note", yearly ? "$7.25 per person a month, paid yearly" : "$8.75 per person a month, paid monthly");
      want.google = n * (yearly ? 7 : 8.4) * 12;
      setText("google-note", yearly ? "$7 per person a month, annual plan" : "$8.40 per person a month, flexible plan");
      const teams = el("teams");
      if (yearly) { teams.classList.remove("na"); want.teams = n * 4 * 12; setText("teams-note", "$4 per person a month, paid yearly"); }
      else { teams.classList.add("na"); want.teams = null; setText("teams-note", "Microsoft's page shows yearly prices only"); }
      if (n <= 50) { want.us = 0; setText("us-note", "Cloudflare's free plan, up to about 50 people"); }
      else { want.us = 60; setText("us-note", "Cloudflare Workers Paid, $5 a month for the whole account"); }
      if (instant || reduce || !seen) { Object.assign(shown, Object.fromEntries(Object.entries(want).map(([k, v]) => [k, v ?? 0]))); if (seen) draw(); }
      else tween(380);
      bars();
      // one calm announcement after the slider settles, not one per frame
      clearTimeout(sayT);
      sayT = setTimeout(() => {
        say.textContent = `${n} people: Slack Pro ${usd(want.slack)}, Google Workspace ${usd(want.google)}, Microsoft Teams ${want.teams == null ? "not listed" : usd(want.teams)}, Yakyard ${usd(want.us)} a year.`;
      }, 700);
    };
    calc.addEventListener("input", () => update(false));
    update(true);
    if (!seen) {
      // first time the bill scrolls into view, the numbers count up and the bars grow
      const io = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        seen = true;
        for (const k of Object.keys(shown)) shown[k] = 0;
        draw();
        requestAnimationFrame(() => { bars(); tween(1100); });
      }, { rootMargin: "0px 0px -20% 0px" });
      // if it's already on screen at load, leave it as it is
      const r = bill.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) { seen = true; draw(); bars(); }
      else io.observe(bill);
    }
  }

  // Copy buttons
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    const label = b.querySelector("span");
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      label.textContent = "Copied";
    } catch {
      label.textContent = "Couldn't copy. Select it by hand";
    }
    clearTimeout(b._t);
    b._t = setTimeout(() => (label.textContent = "Copy"), 1800);
  });

  // Docs: mark the section you're reading in the sidebar
  const toc = document.querySelector(".toc");
  if (toc && "IntersectionObserver" in window) {
    const links = new Map([...toc.querySelectorAll("a")].map((a) => [a.hash.slice(1), a]));
    const seen = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => (en.isIntersecting ? seen.add(en.target.id) : seen.delete(en.target.id)));
      const first = [...links.keys()].find((id) => seen.has(id));
      if (first) links.forEach((a, id) => a.classList.toggle("on", id === first));
    }, { rootMargin: "-90px 0px -60% 0px" });
    links.forEach((_, id) => { const h = document.getElementById(id); if (h) io.observe(h); });
  }

  // ---------- the 80-second tour: plays muted while in view, never with reduced motion or Save-Data, and stops once someone uses the controls ----------
  const tour = document.querySelector("[data-tour]");
  const saveData = navigator.connection && navigator.connection.saveData;
  if (tour && !reduce && !saveData && "IntersectionObserver" in window) {
    let auto = true;
    const off = () => { auto = false; };
    tour.addEventListener("pointerdown", off);
    tour.addEventListener("keydown", off);
    tour.addEventListener("volumechange", () => { if (!tour.muted) off(); });
    new IntersectionObserver(([e]) => {
      if (!auto) return;
      if (e.isIntersecting) { tour.preload = "auto"; tour.muted = true; tour.play().catch(() => {}); }
      else tour.pause();
    }, { threshold: 0.6 }).observe(tour);
  }

  // ---------- home page motion: GSAP and ScrollTrigger load after the page, never when motion is reduced ----------
  const motionSrc = me && me.dataset.motion;
  if (motionSrc && !reduce) {
    const load = (src) => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.append(s); });
    const go = () => load("/vendor/gsap-3.15.1.min.js").then(() => load("/vendor/ScrollTrigger-3.15.1.min.js")).then(() => load(motionSrc)).catch(() => {});
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
    if (document.readyState === "complete") idle(go, { timeout: 1500 });
    else addEventListener("load", () => idle(go, { timeout: 1500 }), { once: true });
  }
})();
