// Apply the saved theme before React renders; first visit defaults to Light.
// Keep this priority identical to initialTheme() in hooks/useTheme.ts.
// A file of its own rather than inline in index.html, so the page's
// Content-Security-Policy (nginx.conf) can forbid inline scripts outright.
(function () {
  try {
    var t = localStorage.getItem("king-theme");
    if (t !== "light" && t !== "dark") t = "light";
    document.documentElement.dataset.theme = t;
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }
})();
