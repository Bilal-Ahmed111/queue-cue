// Queue Cue service worker.
// Phase 2: loads the build settings and the dev-mode alert log. Alert handling arrives in Phase 3.
// Paths are relative to this file. Event listeners must be added at the top level of this script.
importScripts('config.js', 'debug-log.js');
