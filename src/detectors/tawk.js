// Tawk.to detector. Runs in the page's MAIN world right after src/content/hook.js, at document_start,
// before the page's own scripts. Facts it relies on (notes/research/tawk.md, section 7, real widget):
// - Tawk.to keeps the Tawk_API object the site's snippet created, and reads each Tawk_API.onX callback
//   ONCE when its script starts, keeping what it read. So our wrappers must be in place before then.
// - Messages arrive as { message, attachments } with no ID; onAgentJoinChat gets { name, position, image, id }.
// - Old messages are not fired again after a refresh, and every open tab of the chat fires.
// How it stays out of the site's way (CLAUDE.md, "Never break the host site"):
// - It doesn't create Tawk_API. It watches the global with a getter/setter and only wraps a Tawk_API
//   object once the site creates one. The getter returns undefined until then, so the snippet's
//   "var Tawk_API = Tawk_API || {}" behaves as usual (the var keeps our accessor: research Q5).
// - The site's handlers are kept and called, whether set before or after us. Each wrapper is tied to
//   the handler that was current when it was read, so a handler the site sets after Tawk.to has loaded
//   is not called, just as Tawk.to wouldn't call it (Bilal's decision, 2026-10-13).
// - Our part runs first and can't throw; the site's handler then runs exactly as it would without us,
//   errors included.
(function () {
  'use strict';

  var queueCue = window.__queueCue;
  if (!queueCue || queueCue.detectors.tawk) return;
  queueCue.detectors.tawk = true;

  // Kept now, before the page's scripts run, in case the page replaces them later.
  var defineProperty = Object.defineProperty;
  var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  var setTimer = window.setTimeout.bind(window);

  var CALLBACKS = ['onBeforeLoad', 'onLoad', 'onAgentJoinChat', 'onChatMessageAgent', 'onChatMessageVisitor', 'onChatEnded'];
  // If onLoad never comes, start listening this long after onBeforeLoad anyway (onLoad normally
  // arrives under a second after it).
  var READY_FALLBACK_MS = 5000;

  // Nothing counts until Tawk.to has finished loading. Old messages aren't fired again after a refresh
  // (research), but if they ever were, it would be while the widget loads.
  var ready = false;
  var fallbackStarted = false;

  // A short code worked out from the text (FNV-1a, 32 bits). The same text always gives the same code,
  // but the code can't be turned back into the text, so the text never leaves the page.
  function fingerprint(text) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return ('0000000' + hash.toString(16)).slice(-8);
  }

  function messageText(message) {
    var text = message && typeof message.message === 'string' ? message.message : '';
    var files = message && Array.isArray(message.attachments) ? message.attachments.length : 0;
    return text + '\u0000' + files;
  }

  function emit(type, text) {
    if (!ready) return;
    queueCue.emit({ type: type, platform: 'tawk', messageKey: text === null ? type : type + ':' + fingerprint(text) });
  }

  var observers = {
    onBeforeLoad: function () {
      if (fallbackStarted) return;
      fallbackStarted = true;
      setTimer(function () { ready = true; }, READY_FALLBACK_MS);
    },
    onLoad: function () {
      ready = true;
    },
    onAgentJoinChat: function (agent) {
      emit('agent_joined', String((agent && (agent.id || agent.name)) || ''));
    },
    onChatMessageAgent: function (message) {
      emit('agent_message', messageText(message));
    },
    onChatMessageVisitor: function (message) {
      emit('visitor_message', messageText(message));
    },
    onChatEnded: function () {
      emit('chat_ended', null);
    }
  };

  // While a callback's outermost wrapper runs, wrappers called from inside it only pass the call on.
  // That covers sites that chain handlers ("var old = Tawk_API.onLoad; Tawk_API.onLoad = function () { old(); ... }"):
  // we observe each event once, and every handler in the chain still runs once.
  var running = {};

  // One wrapper per callback and site handler, so reading the same property twice gives the same function.
  var wrappers = {};
  var bareWrappers = {};
  CALLBACKS.forEach(function (name) { wrappers[name] = new WeakMap(); });

  function wrapperFor(name, handler) {
    var isFunction = typeof handler === 'function';
    var known = isFunction ? wrappers[name].get(handler) : bareWrappers[name];
    if (known) return known;
    var wrapper = function () {
      var outermost = !running[name];
      if (outermost) {
        running[name] = true;
        try {
          observers[name].apply(null, arguments);
        } catch (e) {
          // Never let Queue Cue break the chat.
        }
      }
      try {
        if (isFunction) return handler.apply(this, arguments);
      } finally {
        if (outermost) running[name] = false;
      }
    };
    if (isFunction) wrappers[name].set(handler, wrapper); else bareWrappers[name] = wrapper;
    return wrapper;
  }

  var wrapped = new WeakSet();

  // Puts a getter/setter on each callback we need. The site's own handler, set before or after this,
  // is kept and called by the wrapper.
  function wrapApi(api) {
    if (!api || (typeof api !== 'object' && typeof api !== 'function') || wrapped.has(api)) return;
    wrapped.add(api);
    CALLBACKS.forEach(function (name) {
      try {
        var existing = getOwnPropertyDescriptor(api, name);
        if (existing && !existing.configurable) return;
        var handler = existing ? (existing.get ? existing.get.call(api) : existing.value) : undefined;
        defineProperty(api, name, {
          configurable: true,
          enumerable: true,
          get: function () { return wrapperFor(name, handler); },
          set: function (value) { handler = value; }
        });
      } catch (e) {
        // A frozen or sealed object: leave it alone.
      }
    });
  }

  // Waits for the site to create Tawk_API, without creating it ourselves. Configurable, so a site that
  // declares it with let/const, or deletes it, still can.
  var globalProperty = getOwnPropertyDescriptor(window, 'Tawk_API');
  if (globalProperty) {
    // Only if this ran late, after the page made Tawk_API; normally it runs first.
    wrapApi(globalProperty.value);
    return;
  }
  var current;
  try {
    defineProperty(window, 'Tawk_API', {
      configurable: true,
      enumerable: true,
      get: function () { return current; },
      set: function (value) {
        current = value;
        try {
          wrapApi(value);
        } catch (e) {
          // Never let Queue Cue break the page.
        }
      }
    });
  } catch (e) {
    // Leave the page alone.
  }
})();
