// Apply the persisted theme before first paint to avoid a flash of the wrong
// theme. Loaded as an external script (rather than inline) so the Content-
// Security-Policy can drop script-src 'unsafe-inline'. Keep this tiny and
// render-blocking in <head> so it runs before the body is styled.
(function () {
  try {
    var t = localStorage.getItem('questhq:theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.setAttribute('data-theme', 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
