// Applies the saved theme and background choice before the page paints, so it
// never flashes the wrong colours. Kept as a file (not inline) so the Content
// Security Policy can refuse every inline script.
try {
  var t = JSON.parse(localStorage.getItem('lifeTracker.theme'));
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  if (JSON.parse(localStorage.getItem('lifeTracker.background')) === 'off') document.documentElement.dataset.bg = 'off';
} catch (e) {}
