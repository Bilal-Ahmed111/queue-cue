// Watched sites. The popup asks Chrome for access to a site (that must come from the user's click);
// this file keeps the list of watched sites in chrome.storage.local and registers the hook and relay
// content scripts for each one. Chrome may close the popup while its "Allow access?" prompt shows, so
// a new grant is also picked up from chrome.permissions.onAdded (see service-worker.js).
self.QueueCue = self.QueueCue || {};

QueueCue.sites = (function () {
  var STORAGE_KEY = 'watchedSites';
  // MAIN world: the hook first, then the detectors, which add to the hook's namespace.
  var MAIN_FILES = ['src/content/hook.js', 'src/detectors/tawk.js'];
  var RELAY_FILES = ['src/content/relay.js'];
  var ID_PREFIX = /^qc-(main|relay)\|/;

  // Changes run one after another, so a grant reported by the popup and by onAdded at the same
  // moment can't overwrite each other's list. Only the service worker changes the list.
  var pending = Promise.resolve();
  function queue(task) {
    var run = pending.then(task);
    pending = run.catch(function () {});
    return run;
  }

  // A page address becomes a whole-site pattern: scheme, host name, then "/*", dropping the port, path
  // and query. Chrome ignores paths in permission requests, and a pattern without a port covers
  // every port. null for pages that aren't websites (chrome:, file:, about: and so on).
  function patternFor(url) {
    var u;
    try {
      u = new URL(url);
    } catch (e) {
      return null;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname) return null;
    return u.protocol + '//' + u.hostname + '/*';
  }

  // True only for one exact site pattern, as made by patternFor (no wildcard host, no path).
  function isSitePattern(pattern) {
    return typeof pattern === 'string' && patternFor(pattern.slice(0, -1)) === pattern && pattern.indexOf('*') === pattern.length - 1;
  }

  function hostOf(pattern) {
    return new URL(pattern.slice(0, -1)).hostname;
  }

  function ids(pattern) {
    return { main: 'qc-main|' + pattern, relay: 'qc-relay|' + pattern };
  }

  function registrations(pattern) {
    var id = ids(pattern);
    // Top frame only: Tawk.to's callbacks fire in the top page, not in its iframes (notes/research/tawk.md, section 7).
    return [
      { id: id.main, matches: [pattern], js: MAIN_FILES, runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: true },
      { id: id.relay, matches: [pattern], js: RELAY_FILES, runAt: 'document_start', world: 'ISOLATED', allFrames: false, persistAcrossSessions: true }
    ];
  }

  async function readList() {
    var stored = await chrome.storage.local.get(STORAGE_KEY);
    return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  }

  function writeList(list) {
    return chrome.storage.local.set({ [STORAGE_KEY]: list });
  }

  function registered(pattern) {
    var id = ids(pattern);
    return chrome.scripting.getRegisteredContentScripts({ ids: [id.main, id.relay] });
  }

  function sameFiles(a, b) {
    return JSON.stringify(a || []) === JSON.stringify(b || []);
  }

  // Registers both scripts, replacing any registration that is missing or out of date.
  async function ensureRegistered(pattern) {
    var wanted = registrations(pattern);
    var existing = await registered(pattern);
    var upToDate = wanted.every(function (w) {
      return existing.some(function (e) {
        return e.id === w.id && e.world === w.world && e.runAt === w.runAt && sameFiles(e.js, w.js) && sameFiles(e.matches, w.matches);
      });
    });
    if (upToDate) return;
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: existing.map(function (s) { return s.id; }) });
    }
    await chrome.scripting.registerContentScripts(wanted);
  }

  async function unregister(pattern) {
    var existing = await registered(pattern);
    if (existing.length) {
      await chrome.scripting.unregisterContentScripts({ ids: existing.map(function (s) { return s.id; }) });
    }
  }

  // Starts watching a site Chrome has granted. Returns false (and changes nothing) without the grant.
  function watch(pattern) {
    return queue(async function () {
      if (!isSitePattern(pattern)) return false;
      if (!(await chrome.permissions.contains({ origins: [pattern] }))) return false;
      var list = await readList();
      if (list.indexOf(pattern) === -1) await writeList(list.concat(pattern));
      await ensureRegistered(pattern);
      return true;
    });
  }

  // Stops watching a site. Scripts already running in open pages keep running until they're refreshed.
  // With removePermission, Chrome's access to the site is given back too ("Stop watching this site").
  function unwatch(pattern, options) {
    return queue(async function () {
      var list = await readList();
      var next = list.filter(function (p) { return p !== pattern; });
      if (next.length !== list.length) await writeList(next);
      if (isSitePattern(pattern)) await unregister(pattern);
      if (options && options.removePermission && isSitePattern(pattern)) {
        try {
          await chrome.permissions.remove({ origins: [pattern] });
        } catch (e) {
          // Chrome refuses to remove access the extension can't do without (none in the real extension).
        }
      }
      return true;
    });
  }

  // Brings the registrations back in line with the list and Chrome's grants. Runs when the service
  // worker starts and each time the popup opens: a site whose access was removed is dropped, a
  // watched site whose scripts went missing gets them back, and leftover registrations are removed.
  function reconcile() {
    return queue(async function () {
      var list = await readList();
      var keep = [];
      for (var i = 0; i < list.length; i++) {
        var pattern = list[i];
        if (isSitePattern(pattern) && keep.indexOf(pattern) === -1 && await chrome.permissions.contains({ origins: [pattern] })) {
          keep.push(pattern);
          await ensureRegistered(pattern);
        } else if (isSitePattern(pattern)) {
          await unregister(pattern);
        }
      }
      if (keep.length !== list.length) await writeList(keep);
      var stray = (await chrome.scripting.getRegisteredContentScripts()).filter(function (s) {
        return ID_PREFIX.test(s.id) && keep.indexOf(s.id.replace(ID_PREFIX, '')) === -1;
      });
      if (stray.length) {
        await chrome.scripting.unregisterContentScripts({ ids: stray.map(function (s) { return s.id; }) });
      }
      return keep;
    });
  }

  // What the popup shows for a page address.
  function status(url) {
    return queue(async function () {
      var pattern = patternFor(url);
      if (!pattern) return { supported: false };
      var list = await readList();
      var granted = await chrome.permissions.contains({ origins: [pattern] });
      var scripts = await registered(pattern);
      return {
        supported: true,
        pattern: pattern,
        host: hostOf(pattern),
        watching: granted && list.indexOf(pattern) !== -1 && scripts.length === 2
      };
    });
  }

  // chrome.permissions.onAdded: a site granted while the popup was closed (or from chrome://extensions).
  function onPermissionsAdded(permissions) {
    var origins = (permissions && permissions.origins) || [];
    return Promise.all(origins.filter(isSitePattern).map(function (pattern) { return watch(pattern); }));
  }

  // chrome.permissions.onRemoved: access removed in the popup or at chrome://extensions.
  function onPermissionsRemoved(permissions) {
    var origins = (permissions && permissions.origins) || [];
    return Promise.all(origins.map(function (pattern) { return unwatch(pattern); }));
  }

  return {
    patternFor: patternFor,
    isSitePattern: isSitePattern,
    readList: readList,
    watch: watch,
    unwatch: unwatch,
    reconcile: reconcile,
    status: status,
    onPermissionsAdded: onPermissionsAdded,
    onPermissionsRemoved: onPermissionsRemoved
  };
})();
