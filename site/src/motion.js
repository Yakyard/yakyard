// Yakyard home page motion. Loaded by site.js after the page is up, only when motion isn't reduced.
// GSAP + ScrollTrigger (self-hosted in /vendor). Transforms and opacity only; nothing is hidden from screen readers.
(() => {
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  gsap.registerPlugin(ScrollTrigger);
  gsap.defaults({ ease: "power3.out", duration: 0.8 });
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
  const hero = $(".hero");
  const layers = [[$(".browser"), -7, -5, -16], [$(".phone"), 14, 10, -70], [$(".yak-spot"), 10, 6, -30]].filter((l) => l[0]);
  const st = layers.map(() => ({ mx: 0, my: 0, sy: 0 }));
  const render = () => layers.forEach(([el], i) => { const s = st[i]; el.style.translate = `${s.mx.toFixed(2)}px ${(s.my + s.sy).toFixed(2)}px`; });
  layers.forEach(([, , , sy], i) => {
    gsap.to(st[i], { sy, ease: "none", onUpdate: render, scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.6 } });
  });
  if (fine && hero) {
    const qs = layers.map((_, i) => [gsap.quickTo(st[i], "mx", { duration: 0.9, ease: "power3", onUpdate: render }), gsap.quickTo(st[i], "my", { duration: 0.9, ease: "power3", onUpdate: render })]);
    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
      layers.forEach(([, x, y], i) => { qs[i][0](nx * x * 2); qs[i][1](ny * y * 2); });
    });
    hero.addEventListener("pointerleave", () => qs.forEach(([x, y]) => { x(0); y(0); }));
  }

  // everything below the fold is set up in a second, idle step so the first one stays short
  const later = () => {
  // ---------- the word band slides with the scroll, both ways ----------
  // it starts from where the page is when motion loads, so a band already on screen never snaps sideways
  const mq = $(".mq__track");
  if (mq) {
    const s0 = scrollY;
    const band = $(".mq");
    gsap.fromTo(mq, { xPercent: 0 }, { xPercent: -22, ease: "none", immediateRender: false, scrollTrigger: { trigger: band, start: () => Math.max(band.getBoundingClientRect().top + scrollY - innerHeight, s0), end: () => "+=" + innerHeight * 2.2, scrub: 0.5, invalidateOnRefresh: true } });
  }

  // ---------- section headings: each one lands a little differently ----------
  $$(".sec__head").forEach((h, i) => {
    const kids = [...h.children];
    reveal(kids, { y: 36, x: i % 2 ? 0 : -18, opacity: 0, stagger: 0.1, duration: 0.9 }, h, "top 85%");
  });

  // ---------- features: tiles drop in, screenshots rise inside them, chips pop ----------
  const tiles = $$(".tile");
  if (tiles.length) {
    reveal(tiles, { y: 70, rotation: (i) => (i % 2 ? 2.5 : -2.5), opacity: 0, duration: 1, stagger: 0.12, ease: "back.out(1.3)" }, ".bento", "top 82%");
    reveal($$(".tile__shot img"), { yPercent: 14, duration: 1.2, stagger: 0.12, ease: "power4.out" }, ".bento", "top 78%");
    reveal($$(".also li:not(.lead)"), { scale: 0.6, opacity: 0, duration: 0.5, stagger: 0.04, ease: "back.out(2.2)" }, ".also", "top 92%");
    if (fine) {
      tiles.forEach((t) => {
        gsap.set(t, { transformPerspective: 900 });
        const rx = gsap.quickTo(t, "rotationX", { duration: 0.6, ease: "power3" });
        const ry = gsap.quickTo(t, "rotationY", { duration: 0.6, ease: "power3" });
        t.addEventListener("pointermove", (e) => {
          const r = t.getBoundingClientRect();
          ry(((e.clientX - r.left) / r.width - 0.5) * 6);
          rx(-((e.clientY - r.top) / r.height - 0.5) * 6);
        });
        t.addEventListener("pointerleave", () => { rx(0); ry(0); });
      });
    }
  }

  // ---------- voice: a real conversation types itself out ----------
  reveal($$(".facts > div"), { x: -24, opacity: 0, stagger: 0.07, duration: 0.6 }, ".facts", "top 88%");
  reveal(".voice__search", { y: 50, rotation: 3, opacity: 0, duration: 1, ease: "back.out(1.4)" }, ".voice__search", "top 95%");
  const chat = $("#chat");
  if (chat && fresh(chat)) {
    // the first message is there from the start; the rest arrive one by one and the panel grows to fit them,
    // so it never shows a tall empty box. The column keeps its final height reserved, so nothing below jumps.
    const log = $(".chat__log", chat);
    const msgs = $$(".msg", chat);
    const typing = $(".chat__typing", chat);
    const who = $(".chat__who", chat);
    const yakAv = $(".msg--yak .av", chat);
    const btn = $(".vn__play", chat);
    const col = chat.parentElement;
    const reserve = () => { col.style.minHeight = ""; msgs.forEach((m) => (m.style.display = "")); const h = col.offsetHeight; msgs.slice(shown).forEach((m) => (m.style.display = "none")); col.style.minHeight = h + "px"; };
    let shown = 1;
    reserve();
    addEventListener("resize", () => { if (shown < msgs.length) reserve(); });
    const say = (name) => () => { who.textContent = name; };
    const show = (m) => () => {
      const h0 = log.offsetHeight;
      m.style.display = "";
      shown++;
      const h1 = log.offsetHeight;
      gsap.fromTo(log, { height: h0, overflow: "hidden" }, { height: h1, duration: 0.34, ease: "power3.out", clearProps: "height,overflow" });
      gsap.fromTo(m, { opacity: 0, y: 10, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: "back.out(1.6)", clearProps: "transform" });
    };
    const on1 = (d) => tl.to(typing, { opacity: 1, duration: 0.16, ease: "power2.out" }, d);
    const off = () => tl.to(typing, { opacity: 0, duration: 0.12, ease: "power2.out" });
    const [m2, m3, m4] = msgs.slice(1);
    const tl = gsap.timeline({ paused: true });
    // Marco: typing at 0.3 s, message at about 1.1 s
    tl.call(say("Marco is typing"), null, 0.25); on1(0.3); tl.to({}, { duration: 0.65 }); off(); tl.call(show(m2), null, "<");
    // the yak records a voice note: on screen at about 2.5 s, wave and transcript fill in
    tl.call(say("The yak is recording a voice note"), null, "+=0.3"); on1(">"); tl.to({}, { duration: 0.85 }); off(); tl.call(show(m3), null, "<");
    tl.from($$(".vn__wave i", m3), { scaleY: 0.08, duration: 0.4, stagger: 0.01, ease: "back.out(2)" }, "<0.08")
      .call(() => { yakAv.classList.remove("is-wiggle"); void yakAv.offsetWidth; yakAv.classList.add("is-wiggle"); setTimeout(() => yakAv.classList.remove("is-wiggle"), 700); }, null, "<0.15")
      .from($$(".wd", m3), { opacity: 0, duration: 0.05, stagger: 0.032 }, "<0.05");
    // Lena: typing while the transcript finishes, reply at about 4.6 s
    tl.call(say("Lena is typing"), null, "<0.6"); on1(">"); tl.to({}, { duration: 0.7 }); off(); tl.call(show(m4), null, "<");
    tl.to(chat, { paddingBottom: 0, duration: 0.4, ease: "power3.inOut", clearProps: "paddingBottom" }, "+=0.35")
      .call(() => { btn && btn.classList.add("is-invite"); col.style.minHeight = ""; });
    msgs.slice(1).forEach((m) => (m.style.display = "none"));
    // the search card overlaps the panel's foot; lift the typing line clear of it while the talk plays
    gsap.set(chat, { paddingBottom: 30 });
    ScrollTrigger.create({ trigger: chat, start: "top 85%", once: true, onEnter: () => tl.play() });
  }

  // ---------- cost: the controls slide in, the bill deals its rows ----------
  reveal($$(".calc > *"), { x: -30, opacity: 0, stagger: 0.12, duration: 0.7 }, ".calc", "top 85%");
  reveal($$(".bill li"), { x: 50, opacity: 0, stagger: 0.09, duration: 0.7, ease: "back.out(1.4)" }, ".bill", "top 85%");

  // ---------- compare: rows come in, then a highlighter checks each app and settles on Yakyard ----------
  const wrap = $(".ctable-wrap");
  if (wrap && fresh(wrap)) {
    const rows = $$(".ctable tbody tr", wrap);
    const scan = document.createElement("div");
    scan.className = "scan";
    scan.setAttribute("aria-hidden", "true");
    wrap.append(scan);
    const rel = (r) => r.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
    gsap.set(scan, { opacity: 0 });
    const tl = gsap.timeline({ scrollTrigger: on(wrap, "top 75%") });
    tl.from(rows, { y: 18, opacity: 0, duration: 0.5, stagger: 0.06 });
    rows.forEach((r, i) => {
      tl.to(scan, { y: () => rel(r), scaleY: () => r.offsetHeight / 100, opacity: 0.6, duration: i ? 0.16 : 0.25, ease: "power2.inOut" }, i ? ">0.04" : "-=0.1");
    });
    tl.to(scan, { y: () => rel(rows[0]), scaleY: () => rows[0].offsetHeight / 100, duration: 0.55, ease: "expo.inOut" }, ">0.15")
      .to(scan, { opacity: 0, duration: 0.5 }, ">0.2");
  }

  // ---------- pros and cons: each card slides in from its own side ----------
  const pros = $(".pc__col.pros"), cons = $(".pc__col.cons");
  if (pros && fresh(pros)) {
    const tl = gsap.timeline({ scrollTrigger: on($(".pc"), "top 78%") });
    tl.from(pros, { x: -60, rotation: -1.5, opacity: 0, duration: 0.9, ease: "back.out(1.2)" })
      .from(cons, { x: 60, rotation: 1.5, opacity: 0, duration: 0.9, ease: "back.out(1.2)" }, "<0.12")
      .from($(".sticker", pros), { scale: 1.7, rotation: -14, opacity: 0, duration: 0.45, ease: "back.out(2)" }, "<0.3")
      .from($$("li", pros), { y: 12, opacity: 0, stagger: 0.04, duration: 0.45 }, "<0.1")
      .from($$("h3, li", cons), { y: 12, opacity: 0, stagger: 0.06, duration: 0.45 }, "<0.2");
  }

  // ---------- install: a rail fills as you read the steps; the terminal types ----------
  const steps = $(".steps");
  if (steps) {
    gsap.fromTo(".rail i", { scaleY: 0 }, { scaleY: 1, ease: "none", scrollTrigger: { trigger: steps, start: "top 62%", end: "bottom 62%", scrub: 0.4 } });
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
    reveal($$(".install__side > *"), { y: 24, opacity: 0, stagger: 0.12, duration: 0.7 }, ".install__side", "top 85%");
  }

  // ---------- faq and the close ----------
  reveal($$(".qa details"), { y: 16, opacity: 0, stagger: 0.05, duration: 0.6 }, ".qa", "top 85%");
  const closeYak = $(".yak--close");
  if (closeYak && fresh(closeYak)) {
    gsap.from(closeYak, {
      y: 40, scale: 0.7, opacity: 0, duration: 0.9, ease: "back.out(2)",
      scrollTrigger: on(closeYak, "top 88%"),
      onComplete: () => { closeYak.classList.add("is-wiggle", "is-typing"); setTimeout(() => closeYak.classList.remove("is-wiggle"), 700); setTimeout(() => closeYak.classList.remove("is-typing"), 1800); },
    });
    reveal($$(".close h2, .close__p, .close .btn-row"), { y: 30, opacity: 0, stagger: 0.1 }, ".close h2", "top 88%");
  }

    ScrollTrigger.refresh();
  };
  (window.requestIdleCallback || ((f) => setTimeout(f, 60)))(later, { timeout: 800 });

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
})();
