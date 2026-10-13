// Queue Cue service worker.
// Paths are relative to this file. Event listeners must be added at the top level of this script,
// so they exist when Chrome wakes the worker for an event.
importScripts('config.js', 'debug-log.js', 'sites.js', 'keep-awake.js', 'alerts.js');

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
  ((permissions && permissions.origins) || []).forEach(function (pattern) {
    QueueCue.keepAwake.forgetSite(pattern).catch(reportError('Letting the PC sleep after a site was removed'));
  });
});

// Keep-awake ends when the chat's tabs close or leave the site, or after 60 minutes with no chat activity.
chrome.tabs.onRemoved.addListener(function (tabId) {
  QueueCue.keepAwake.onTabClosed(tabId).catch(reportError('Letting the PC sleep after a chat tab closed'));
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status !== 'loading' && !changeInfo.url) return;
  QueueCue.keepAwake.onTabNavigated(tabId).catch(reportError('Checking a chat tab that loaded a new page'));
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  QueueCue.keepAwake.onAlarm(alarm).catch(reportError('Letting the PC sleep after 60 quiet minutes'));
});

// Clicking a notification brings the chat tab to the front; closing it forgets where it pointed.
chrome.notifications.onClicked.addListener(function (notificationId) {
  QueueCue.alerts.openChat(notificationId).catch(reportError('Going to the chat from a notification'));
});

chrome.notifications.onClosed.addListener(function (notificationId) {
  QueueCue.alerts.forget(notificationId).catch(reportError('Forgetting a closed notification'));
});

// Messages from the popup and from the relay content script. A message only counts as the popup's
// if it comes from the popup page of this extension.
function fromPopup(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' &&
    sender.url.indexOf(chrome.runtime.getURL('src/popup/')) === 0;
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message && message.queueCue === 'event') {
    QueueCue.alerts.receive(message, sender).then(function (accepted) {
      sendResponse({ ok: accepted });
    }, function (error) {
      reportError('Handling a chat event')(error);
      sendResponse({ ok: false });
    });
    return true;
  }

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
      return QueueCue.keepAwake.forgetSite(message.pattern);
    }).then(function () {
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
// And finish any alert decision the previous worker didn't get to before it stopped.
QueueCue.alerts.decideDue().catch(reportError('Finishing alert decisions at start-up'));
// And let the PC sleep if the chat's tabs closed while the worker was stopped.
QueueCue.keepAwake.checkAtStartUp().catch(reportError('Checking keep-awake at start-up'));
