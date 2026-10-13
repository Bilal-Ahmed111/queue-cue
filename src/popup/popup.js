// Queue Cue popup: says whether the current site is watched, with "Watch chats on this site" and
// "Stop watching this site" buttons. The service worker does the work (src/background/sites.js).
// The popup only asks Chrome for access, because Chrome shows its prompt only during the user's click.
(function () {
  'use strict';

  var siteEl = document.getElementById('site');
  var statusEl = document.getElementById('status');
  var noteEl = document.getElementById('note');
  var watchButton = document.getElementById('watch');
  var stopButton = document.getElementById('stop');

  var pageUrl = null;
  var current = null; // the service worker's last answer for this page

  async function ask(action, extra) {
    var reply = await chrome.runtime.sendMessage(Object.assign({ queueCue: 'popup', action: action, url: pageUrl }, extra));
    if (!reply || !reply.ok) throw new Error((reply && reply.error) || 'Queue Cue did not answer.');
    return reply.result;
  }

  function setNote(text) {
    noteEl.textContent = text || '';
    noteEl.hidden = !text;
  }

  function show(state, note) {
    current = state;
    watchButton.hidden = true;
    stopButton.hidden = true;
    watchButton.disabled = false;
    stopButton.disabled = false;
    if (!state.supported) {
      siteEl.textContent = '';
      statusEl.textContent = 'Queue Cue only works on websites (addresses starting with http or https).';
    } else if (state.watching) {
      siteEl.textContent = state.host;
      statusEl.textContent = 'Watching chats on this site.';
      stopButton.hidden = false;
      if (!note) note = 'If this page was already open before you started watching, refresh it once.';
    } else {
      siteEl.textContent = state.host;
      statusEl.textContent = 'Not watching this site.';
      watchButton.hidden = false;
    }
    setNote(note);
  }

  function fail(error) {
    statusEl.textContent = 'Something went wrong: ' + ((error && error.message) || error);
    setNote('');
    watchButton.disabled = false;
    stopButton.disabled = false;
  }

  watchButton.addEventListener('click', async function () {
    if (!current || !current.pattern) return;
    // This must be the first call in the click handler, with nothing awaited before it:
    // Chrome only shows its "Allow access?" prompt during the user's click.
    var request = chrome.permissions.request({ origins: [current.pattern] });
    watchButton.disabled = true;
    statusEl.textContent = 'Waiting for Chrome…';
    setNote('');
    try {
      if (!(await request)) {
        show(current, 'Chrome didn\'t get permission, so Queue Cue isn\'t watching this site. Click the button to try again.');
        return;
      }
      // Chrome may close the popup while its prompt shows; then the service worker picks up the
      // grant by itself (chrome.permissions.onAdded) and this line never runs.
      var state = await ask('watch', { pattern: current.pattern });
      show(state, state.watching ? 'Now refresh this page. Queue Cue starts watching from the next page load.' : null);
    } catch (error) {
      fail(error);
    }
  });

  stopButton.addEventListener('click', async function () {
    if (!current || !current.pattern) return;
    stopButton.disabled = true;
    try {
      show(await ask('unwatch', { pattern: current.pattern }), 'Refresh this page to switch Queue Cue off here.');
    } catch (error) {
      fail(error);
    }
  });

  async function start() {
    try {
      // activeTab lets the popup read the address of the tab it was opened on, without the
      // "Read your browsing history" warning that the "tabs" permission brings.
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      pageUrl = (tabs[0] && tabs[0].url) || null;
      show(await ask('status'));
    } catch (error) {
      fail(error);
    }
  }

  start();
})();
