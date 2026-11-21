// Sets the color theme before the page paints, so there is no flash. Choices: system, light, dark, yaky.
(function () {
  var pick = 'system';
  try { pick = localStorage.getItem('yy-theme') || localStorage.getItem('pw-theme') || 'system'; } catch (e) {}
  var dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  var t = pick === 'system' ? (dark ? 'dark' : 'light') : pick;
  document.documentElement.setAttribute('data-theme', t);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#120f2e' : t === 'yaky' ? '#2b1bd6' : '#fff8e6');
})();
