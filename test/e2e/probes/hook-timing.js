// Test-only probe, never part of the real extension. A test registers it as a MAIN-world content
// script at document_start, then checks what the page looked like when it ran. Tawk.to reads its
// callbacks once at load, so the real hook must run before the page's own scripts.
window.__qcTimingProbe = {
  scriptsInDocument: document.scripts.length,
  tawkApiExisted: typeof window.Tawk_API !== 'undefined',
  readyState: document.readyState
};
