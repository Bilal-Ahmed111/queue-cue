// Queue Cue service worker.
// Paths are relative to this file. Event listeners must be added at the top level of this script,
// so they exist when Chrome wakes the worker for an event.
importScripts('config.js', 'debug-log.js', 'sites.js');

function reportError(what) {
  return function (error) {
    console.error('Queue Cue: ' + what + ' failed:', error);
  };
}

// A site granted while the popup was closed, or from chrome://extensions. Chrome's grants are the
// source of truth; these events are only prompts to check (notes/research/chrome-mv3.md, Phase 3 research).
chrome.permissions.onAdded.addListener(function (permissions) {
  QueueCue.sites.onPermissionsAdded(permissions).catch(reportError('Watching a newly allowed site'));
});

chrome.permissions.onRemoved.addListener(function (permissions) {
  QueueCue.sites.onPermissionsRemoved(permissions).catch(reportError('Forgetting a site whose access was removed'));
});

// Messages from the popup. Content-script messages arrive here too (from the relay, in a later step);
// a message only counts as the popup's if it comes from the popup page of this extension.
function fromPopup(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' &&
    sender.url.indexOf(chrome.runtime.getURL('src/popup/')) === 0;
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!fromPopup(sender) || !message || message.queueCue !== 'popup') return false;

  var work;
  if (message.action === 'status') {
    // The popup double-checks every time it opens, in case it closed during Chrome's prompt.
    work = QueueCue.sites.reconcile().then(function () {
      return QueueCue.sites.status(message.url);
    });
  } else if (message.action === 'watch') {
    work = QueueCue.sites.watch(message.pattern).then(function () {
      return QueueCue.sites.status(message.url);
    });
  } else if (message.action === 'unwatch') {
    work = QueueCue.sites.unwatch(message.pattern, { removePermission: true }).then(function () {
      return QueueCue.sites.status(message.url);
    });
  } else {
    return false;
  }

  work.then(function (result) {
    sendResponse({ ok: true, result: result });
  }, function (error) {
    reportError('Popup request "' + message.action + '"')(error);
    sendResponse({ ok: false, error: String(error && error.message || error) });
  });
  return true; // the answer is sent later (keep "return true"; returning a Promise needs Chrome 148+)
});

// Each time the worker starts: drop sites whose access was removed while it was asleep, and
// re-register any watched site whose scripts went missing (for example after an extension update).
QueueCue.sites.reconcile().catch(reportError('Checking watched sites at start-up'));
