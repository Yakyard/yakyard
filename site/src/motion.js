// Yakyard home page motion. Loaded by site.js after the page is up, only when motion isn't reduced.
// GSAP + ScrollTrigger (self-hosted in /vendor). Transforms and opacity only; nothing is hidden from screen readers.
(() => {
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  gsap.registerPlugin(ScrollTrigger);
  // one easing family: OUT for anything arriving, IO for things moving on screen (OUT matches the CSS --ease token)
  const OUT = "power3.out", IO = "power2.inOut";
  gsap.defaults({ ease: OUT, duration: 0.8 });
  document.documentElement.classList.add("motion");
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  // only animate what hasn't been seen yet: anything already on screen stays put
  const fresh = (el) => el && el.getBoundingClientRect().top > innerHeight * 0.9;
  const on = (trigger, start = "top 80%") => ({ trigger, start, once: true });
  function reveal(targets, vars, trigger, start) {
    const t = typeof trigger === "string" ? $(trigger) : trigger;
    if (!fresh(t)) return null;
    return gsap.from(targets, { ...vars, scrollTrigger: on(t, start) });
  }

  // ---------- hero: mockups float with the mouse and drift with the scroll ----------
  // Pointer moves only set targets; quickTo eases toward them on GSAP's own frame loop, and the rect is
  // measured on enter and resize, never inside pointermove.
  const hero = $(".hero");
  const layers = [[$(".browser"), -7, -5, -16], [$(".phone"), 14, 10, -70], [$(".yak-spot"), 10, 6, -30]].filter((l) => l[0]);
  const st = layers.map(() => ({ mx: 0, my: 0, sy: 0 }));
  layers.forEach(([el]) => el.classList.add("is-floating"));
  // tweens only mark the layers dirty; one write per frame, after GSAP has updated every value
  let dirty = false;
  const render = () => { dirty = true; };
  gsap.ticker.add(() => {
    if (!dirty) return;
    dirty = false;
    layers.forEach(([el], i) => { const s = st[i]; el.style.translate = `${s.mx.toFixed(2)}px ${(s.my + s.sy).toFixed(2)}px`; });
  });
  layers.forEach(([, , , sy], i) => {
    gsap.to(st[i], { sy, ease: "none", onUpdate: render, scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.6 } });
  });
  if (fine && hero) {
    const qs = layers.map((_, i) => [gsap.quickTo(st[i], "mx", { duration: 1.1, ease: OUT, onUpdate: render }), gsap.quickTo(st[i], "my", { duration: 1.1, ease: OUT, onUpdate: render })]);
    let box = null;
    const measure = () => { box = hero.getBoundingClientRect(); };
    hero.addEventListener("pointerenter", measure);
    addEventListener("scroll", () => { box = null; }, { passive: true });
    addEventListener("resize", () => { box = null; }, { passive: true });
    hero.addEventListener("pointermove", (e) => {
      if (!box) measure();
      const nx = (e.clientX - box.left) / box.width - 0.5, ny = (e.clientY - box.top) / box.height - 0.5;
      layers.forEach(([, x, y], i) => { qs[i][0](nx * x * 2); qs[i][1](ny * y * 2); });
    }, { passive: true });
    hero.addEventListener("pointerleave", () => qs.forEach(([x, y]) => { x(0); y(0); }));
  }

  // everything below the fold is set up in small idle slices so no single task holds up a frame
  const jobs = [];
  const later = (fn) => jobs.push(fn);

  // ---------- the word band slides with the scroll, both ways ----------
  // it starts from where the page is when motion loads, so a band already on screen never snaps sideways
  later(() => {
    const mq = $(".mq__track");
    if (!mq) return;
    const s0 = scrollY;
    const band = $(".mq");
    gsap.fromTo(mq, { xPercent: 0 }, { xPercent: -22, ease: "none", immediateRender: false, scrollTrigger: { trigger: band, start: () => Math.max(band.getBoundingClientRect().top + scrollY - innerHeight, s0), end: () => "+=" + innerHeight * 2.2, scrub: 0.6, invalidateOnRefresh: true } });
  });

  // ---------- one entrance for supporting content: a short rise and a fade ----------
  later(() => $$(".sec__head").forEach((h) => reveal([...h.children], { y: 28, opacity: 0, stagger: 0.08, duration: 0.9 }, h, "top 85%")));

  // ---------- features: tiles rise in order, chips follow ----------
  later(() => {
    const tiles = $$(".tile");
    if (!tiles.length) return;
    reveal(tiles, { y: 40, opacity: 0, duration: 0.9, stagger: 0.08 }, ".bento", "top 82%");
    reveal($$(".tile__shot img"), { yPercent: 6, duration: 1.1, stagger: 0.08 }, ".bento", "top 78%");
    reveal($$(".also li:not(.lead)"), { y: 10, opacity: 0, duration: 0.5, stagger: 0.03 }, ".also", "top 92%");
    if (!fine) return;
    tiles.forEach((t) => {
      gsap.set(t, { transformPerspective: 900 });
      const rx = gsap.quickTo(t, "rotationX", { duration: 0.7, ease: OUT });
      const ry = gsap.quickTo(t, "rotationY", { duration: 0.7, ease: OUT });
      let box = null;
      t.addEventListener("pointerenter", () => { box = t.getBoundingClientRect(); });
      t.addEventListener("pointermove", (e) => {
        if (!box) box = t.getBoundingClientRect();
        ry(((e.clientX - box.left) / box.width - 0.5) * 5);
        rx(-((e.clientY - box.top) / box.height - 0.5) * 5);
      }, { passive: true });
      t.addEventListener("pointerleave", () => { box = null; rx(0); ry(0); });
    });
  });

  // ---------- voice: a real conversation types itself out ----------
  later(() => {
    reveal($$(".facts > div"), { y: 12, opacity: 0, stagger: 0.06, duration: 0.6 }, ".facts", "top 88%");
    const chat = $("#chat");
    if (!chat || !fresh(chat)) { reveal(".voice__search", { y: 30, opacity: 0, duration: 0.9 }, ".voice__search", "top 95%"); return; }
    // The first message is there from the start; the rest arrive one by one and the panel grows to fit them.
    // The page layout never changes: every message keeps its place from the start (later ones invisible), and the
    // growth is drawn with transforms only. A backdrop layer scales to the height in use, and the typing line and
    // the search card ride up by the height still hidden. No reflow, no layout shift, no reserved height.
    const msgs = $$(".msg", chat);
    const typing = $(".chat__typing", chat);
    const who = $(".chat__who", chat);
    const yakAv = $(".msg--yak .av", chat);
    const btn = $(".vn__play", chat);
    const search = $(".voice__search");
    const bg = document.createElement("div");
    bg.className = "chat__bg";
    bg.setAttribute("aria-hidden", "true");
    chat.prepend(bg);
    chat.classList.add("is-live");
    const LIFT = 30; // while the talk plays, the search card sits a little lower so it never covers the typing line
    let shown = 1, lift = LIFT;
    const hidden = () => { const last = msgs[msgs.length - 1], m = msgs[shown - 1]; return last.offsetTop + last.offsetHeight - (m.offsetTop + m.offsetHeight); };
    const pose = (dur) => {
      const H = chat.offsetHeight, d = hidden();
      const to = (el, v) => (dur ? gsap.to(el, { ...v, duration: dur, ease: OUT, overwrite: "auto" }) : gsap.set(el, v));
      to(bg, { scaleY: (H - d + lift) / H });
      to(typing, { y: -d });
      to(search, { y: lift - d });
    };
    gsap.set(msgs.slice(1), { autoAlpha: 0 });
    pose(0);
    let done = false;
    addEventListener("resize", () => { if (!done) pose(0); }, { passive: true });
    const say = (name) => () => { who.textContent = name; };
    const show = (m) => () => {
      shown++;
      pose(0.5);
      gsap.fromTo(m, { autoAlpha: 0, y: 12, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, delay: 0.05, ease: OUT, clearProps: "transform" });
    };
    const tl = gsap.timeline({ paused: true });
    // the dots only bounce while someone is typing; an idle infinite animation would restyle every frame
    const on1 = (d) => tl.to(typing, { opacity: 1, duration: 0.2, ease: OUT, onStart: () => typing.classList.add("is-on") }, d);
    const off = () => tl.to(typing, { opacity: 0, duration: 0.15, ease: OUT, onComplete: () => typing.classList.remove("is-on") });
    const [m2, m3, m4] = msgs.slice(1);
    // Marco: typing at 0.3 s, message at about 1.1 s
    tl.call(say("Marco is typing"), null, 0.25); on1(0.3); tl.to({}, { duration: 0.65 }); off(); tl.call(show(m2), null, "<");
    // the yak records a voice note: on screen at about 2.5 s, wave and transcript fill in
    tl.call(say("The yak is recording a voice note"), null, "+=0.3"); on1(">"); tl.to({}, { duration: 0.85 }); off(); tl.call(show(m3), null, "<");
    tl.from($$(".vn__wave i", m3), { scaleY: 0.08, duration: 0.5, stagger: 0.01, ease: OUT }, "<0.1")
      .call(() => { yakAv.classList.remove("is-wiggle"); void yakAv.offsetWidth; yakAv.classList.add("is-wiggle"); setTimeout(() => yakAv.classList.remove("is-wiggle"), 700); }, null, "<0.15")
      .from($$(".wd", m3), { opacity: 0, duration: 0.12, stagger: 0.032, ease: "none" }, "<0.05");
    // Lena: typing while the transcript finishes, reply at about 4.6 s
    tl.call(say("Lena is typing"), null, "<0.6"); on1(">"); tl.to({}, { duration: 0.7 }); off(); tl.call(show(m4), null, "<");
    // the talk is over: the search card tucks back under the panel's foot, then everything is plain layout again
    tl.call(() => { lift = 0; pose(0.6); }, null, "+=0.35")
      .call(() => { done = true; gsap.set([bg, typing, search], { clearProps: "transform" }); btn && btn.classList.add("is-invite"); }, null, "+=0.65");
    ScrollTrigger.create({ trigger: chat, start: "top 85%", once: true, onEnter: () => tl.play() });
  });

  // ---------- cost: the controls and the bill rows rise in ----------
  later(() => {
    reveal($$(".calc > *"), { y: 24, opacity: 0, stagger: 0.08, duration: 0.8 }, ".calc", "top 85%");
    reveal($$(".bill li"), { y: 16, opacity: 0, stagger: 0.07, duration: 0.7 }, ".bill", "top 85%");
  });

  // ---------- compare: rows come in, then a highlighter checks each app and settles on Yakyard ----------
  later(() => {
    const wrap = $(".ctable-wrap");
    if (!wrap || !fresh(wrap)) return;
    const rows = $$(".ctable tbody tr", wrap);
    const scan = document.createElement("div");
    scan.className = "scan";
    scan.setAttribute("aria-hidden", "true");
    wrap.append(scan);
    const rel = (r) => r.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
    gsap.set(scan, { opacity: 0 });
    const tl = gsap.timeline({ scrollTrigger: on(wrap, "top 75%") });
    tl.from(rows, { y: 16, opacity: 0, duration: 0.6, stagger: 0.06 });
    rows.forEach((r, i) => {
      tl.to(scan, { y: () => rel(r), scaleY: () => r.offsetHeight / 100, opacity: 0.6, duration: i ? 0.2 : 0.3, ease: IO }, i ? ">0.04" : "-=0.1");
    });
    tl.to(scan, { y: () => rel(rows[0]), scaleY: () => rows[0].offsetHeight / 100, duration: 0.6, ease: IO }, ">0.15")
      .to(scan, { opacity: 0, duration: 0.5 }, ">0.2");
  });

  // ---------- pros and cons: both cards rise together, the sticker lands ----------
  later(() => {
    const pros = $(".pc__col.pros"), cons = $(".pc__col.cons");
    if (!pros || !fresh(pros)) return;
    const tl = gsap.timeline({ scrollTrigger: on($(".pc"), "top 78%") });
    tl.from([pros, cons], { y: 32, opacity: 0, duration: 0.9, stagger: 0.1 })
      .from($(".sticker", pros), { scale: 1.25, rotation: -8, opacity: 0, duration: 0.5, ease: "back.out(1.4)" }, "<0.35")
      .from($$("li", pros), { y: 10, opacity: 0, stagger: 0.04, duration: 0.5 }, "<0.05")
      .from($$("h3, li", cons), { y: 10, opacity: 0, stagger: 0.05, duration: 0.5 }, "<0.15");
  });

  // ---------- install: a rail fills as you read the steps; the terminal types ----------
  later(() => {
    const steps = $(".steps");
    if (steps) {
      gsap.fromTo(".rail i", { scaleY: 0 }, { scaleY: 1, ease: "none", scrollTrigger: { trigger: steps, start: "top 62%", end: "bottom 62%", scrub: 0.6 } });
      $$("li", steps).forEach((li) => ScrollTrigger.create({ trigger: li, start: "top 64%", end: "max", toggleClass: "is-on" }));
    }
    const term = $(".term");
    if (term && fresh(term)) {
      let at = 0.25;
      $$(".tl", term).forEach((l) => {
        const n = Math.max(4, l.textContent.length);
        const d = Math.min(1.4, n * 0.028);
        l.style.setProperty("--n", n);
        l.style.setProperty("--d", d + "s");
        l.style.setProperty("--at", at + "s");
        at += d + 0.18;
      });
      ScrollTrigger.create({ trigger: term, start: "top 80%", once: true, onEnter: () => term.classList.add("is-typing") });
      reveal($$(".install__side > *"), { y: 24, opacity: 0, stagger: 0.1, duration: 0.8 }, ".install__side", "top 85%");
    }
  });

  // ---------- faq and the close ----------
  later(() => {
    reveal($$(".qa details"), { y: 16, opacity: 0, stagger: 0.05, duration: 0.6 }, ".qa", "top 85%");
    const closeYak = $(".yak--close");
    if (!closeYak || !fresh(closeYak)) return;
    gsap.from(closeYak, {
      y: 30, scale: 0.9, opacity: 0, duration: 0.9,
      scrollTrigger: on(closeYak, "top 88%"),
      onComplete: () => { closeYak.classList.add("is-wiggle", "is-typing"); setTimeout(() => closeYak.classList.remove("is-wiggle"), 700); setTimeout(() => closeYak.classList.remove("is-typing"), 1800); },
    });
    reveal($$(".close h2, .close__p, .close .btn-row"), { y: 24, opacity: 0, stagger: 0.08 }, ".close h2", "top 88%");
  });

  const idle = window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 40));
  const run = (dl) => {
    do jobs.shift()(); while (jobs.length && dl.timeRemaining() > 4);
    if (jobs.length) idle(run, { timeout: 400 });
    else ScrollTrigger.refresh();
  };
  idle(run, { timeout: 800 });


  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
})();
