// Apply the persisted theme before first paint to avoid a flash of the wrong
// theme. Loaded as an external script (rather than inline) so the Content-
// Security-Policy can drop script-src 'unsafe-inline'. Keep this tiny and
// render-blocking in <head> so it runs before the body is styled.
(function () {
  var theme = 'light';
  try {
    var t = localStorage.getItem('questhq:theme');
    if (t === 'light' || t === 'dark') theme = t;
  } catch (e) {}
  document.documentElement.setAttribute('data-theme', theme);
  // Keep the PWA / mobile-browser chrome band (meta theme-color) in step with
  // the app canvas so the top strip doesn't read as a stray dark bar.
  try {
    var color = theme === 'dark' ? '#08090A' : '#FBFAF8';
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'theme-color'); document.head.appendChild(m); }
    m.setAttribute('content', color);
  } catch (e) {}
})();
