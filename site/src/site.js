// Yakyard website: sticky nav edge, cost calculator, copy buttons, docs table of contents.
(() => {
  const nav = document.querySelector(".nav");
  if (nav && "IntersectionObserver" in window) {
    const s = document.createElement("div");
    s.style.cssText = "position:absolute;top:0;height:1px;width:1px";
    document.body.prepend(s);
    new IntersectionObserver(([e]) => nav.classList.toggle("is-stuck", !e.isIntersecting)).observe(s);
  }

  // Cost calculator. Prices: docs/sources.md, checked 21 November 2026.
  const calc = document.getElementById("calc");
  if (calc) {
    const range = calc.querySelector("#people");
    const out = calc.querySelector("#people-out");
    const bill = document.getElementById("bill");
    const set = (k, v) => { const el = bill.querySelector(`[data-k="${k}"]`); if (el.textContent !== v) el.textContent = v; };
    const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
    const update = () => {
      const n = +range.value;
      const yearly = calc.querySelector('input[name="billing"]:checked').value === "y";
      out.textContent = n;
      range.style.setProperty("--fill", ((n - range.min) / (range.max - range.min)) * 100 + "%");
      set("slack", usd(n * (yearly ? 7.25 : 8.75) * 12));
      set("slack-note", yearly ? "$7.25 per person a month, paid yearly" : "$8.75 per person a month, paid monthly");
      set("google", usd(n * (yearly ? 7 : 8.4) * 12));
      set("google-note", yearly ? "$7 per person a month, annual plan" : "$8.40 per person a month, flexible plan");
      const teams = bill.querySelector('[data-k="teams"]');
      if (yearly) { teams.classList.remove("na"); set("teams", usd(n * 4 * 12)); set("teams-note", "$4 per person a month, paid yearly"); }
      else { teams.classList.add("na"); set("teams", "Not listed"); set("teams-note", "Microsoft's page shows yearly prices only"); }
      if (n <= 50) { set("us", "$0"); set("us-note", "Cloudflare's free plan, up to about 50 people"); }
      else { set("us", "$60"); set("us-note", "Cloudflare Workers Paid, $5 a month for the whole account"); }
    };
    calc.addEventListener("input", update);
    update();
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
})();
