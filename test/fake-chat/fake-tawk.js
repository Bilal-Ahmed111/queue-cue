// Fake Tawk.to embed script, for automated tests.
// It imitates the real widget's JavaScript API as observed with the real widget on 2026-10-13
// (notes/research/tawk.md, section 7). A fake proves the logic; only the real chat proves it works.
//
// Copied from the real widget:
// - Each Tawk_API.onX callback is read ONCE when this script starts. Later changes are ignored.
// - Load order: onBeforeLoad, onStatusChange("online"), onChatStarted (only if a chat is already
//   going), then onLoad. getStatus() returns "" until onLoad.
// - Messages pass { message, attachments: [] } with no ID or time. onAgentJoinChat passes
//   { name, position, image, id }. onChatStarted passes { chatId }.
// - The first visitor message fires onChatMessageVisitor, then onChatStarted.
// - isChatOngoing() is true only after the first agent message.
// - After a page refresh, old messages are shown but NOT fired again; onChatStarted fires again.
// - Every open tab of the site fires agent events (a BroadcastChannel stands in for the server).
// Not checked against the real widget (assumptions, see the research notes): visitor messages and
// chat start reaching other tabs, onChatEnded and its argument, and handler errors (the fake lets
// them throw).
(function () {
  'use strict';

  var CALLBACKS = [
    'onBeforeLoad', 'onLoad', 'onStatusChange', 'onChatMaximized', 'onChatMinimized', 'onChatHidden',
    'onChatStarted', 'onChatEnded', 'onPrechatSubmit', 'onOfflineSubmit',
    'onChatMessageVisitor', 'onChatMessageAgent', 'onChatMessageSystem',
    'onAgentJoinChat', 'onAgentLeaveChat', 'onChatSatisfaction', 'onVisitorNameChanged',
    'onFileUpload', 'onTagsUpdated', 'onTranscriptRequest', 'onUnreadCountChanged'
  ];
  var STORAGE_KEY = 'fakeTawkChat';
  var AGENT = {
    name: 'Test Agent',
    position: '',
    image: 'https://embed.tawk.to/_s/v4/assets/images/default-profile.svg',
    id: 'fakeagent00000000000001'
  };

  var api = window.Tawk_API = window.Tawk_API || {};

  // Read every callback once, now, like the real widget does.
  var handlers = {};
  CALLBACKS.forEach(function (name) {
    handlers[name] = api[name];
  });

  var loaded = false;
  var channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('fake-tawk') : null;

  function fire(name, arg) {
    var fn = handlers[name];
    if (typeof fn !== 'function') return;
    if (arguments.length > 1) fn(arg); else fn();
  }

  function loadChat() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return null;
    }
  }

  function saveChat(chat) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chat));
  }

  function activeChat() {
    var chat = loadChat();
    return chat && !chat.ended ? chat : null;
  }

  function makeChatId() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
  }

  // ---- The visible widget (plain HTML; the real one sits in iframes) ----

  var widget = null;

  function renderWidget() {
    if (!document.body) return;
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'fake-tawk-widget';
      widget.setAttribute('aria-label', 'Fake chat widget');
      widget.style.cssText = 'position:fixed;right:16px;bottom:16px;width:280px;max-height:60vh;overflow:auto;' +
        'border:1px solid #888;border-radius:8px;background:#fff;color:#111;font:14px sans-serif;padding:8px;';
      document.body.appendChild(widget);
    }
    var chat = loadChat();
    var lines = ['<strong>Fake chat</strong> (' + (loaded ? 'online' : 'loading') + ')'];
    if (chat) {
      chat.messages.forEach(function (m) {
        lines.push('<div class="fake-tawk-message" data-from="' + m.from + '">' +
          (m.from === 'agent' ? AGENT.name : 'You') + ': ' + escapeHtml(m.text) + '</div>');
      });
      if (chat.ended) lines.push('<em>Chat ended</em>');
    }
    widget.innerHTML = lines.join('');
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- Events: applied in this tab, then sent to the site's other tabs ----

  function broadcast(type, payload) {
    if (channel) channel.postMessage({ type: type, payload: payload });
  }

  function deliver(type, payload) {
    renderWidget();
    if (type === 'visitor_message') {
      fire('onChatMessageVisitor', { message: payload.text, attachments: [] });
      if (payload.newChatId) fire('onChatStarted', { chatId: payload.newChatId });
    } else if (type === 'agent_joined') {
      fire('onAgentJoinChat', Object.assign({}, AGENT));
    } else if (type === 'agent_message') {
      fire('onChatMessageAgent', { message: payload.text, attachments: [] });
    } else if (type === 'chat_ended') {
      fire('onChatEnded');
    }
  }

  if (channel) {
    channel.onmessage = function (event) {
      if (event.data && typeof event.data.type === 'string') deliver(event.data.type, event.data.payload || {});
    };
  }

  function send(type, payload) {
    deliver(type, payload);
    broadcast(type, payload);
  }

  // ---- Actions (used by the page's buttons and by tests) ----

  function visitorMessage(text) {
    var chat = activeChat();
    var newChatId = null;
    if (!chat) {
      newChatId = makeChatId();
      chat = { chatId: newChatId, agentJoined: false, agentMessages: 0, ended: false, messages: [] };
    }
    chat.messages.push({ from: 'visitor', text: text });
    saveChat(chat);
    send('visitor_message', { text: text, newChatId: newChatId });
  }

  function agentJoin() {
    var chat = activeChat();
    if (!chat) throw new Error('Fake Tawk.to: the visitor must send a message before an agent can join.');
    chat.agentJoined = true;
    saveChat(chat);
    send('agent_joined', {});
  }

  function agentMessage(text) {
    var chat = activeChat();
    if (!chat) throw new Error('Fake Tawk.to: there is no chat for the agent to reply to.');
    chat.agentMessages += 1;
    chat.messages.push({ from: 'agent', text: text });
    saveChat(chat);
    send('agent_message', { text: text });
  }

  function endChat() {
    var chat = activeChat();
    if (!chat) return;
    chat.ended = true;
    saveChat(chat);
    send('chat_ended', {});
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    renderWidget();
  }

  // ---- Documented read-only methods ----

  api.getStatus = function () {
    return loaded ? 'online' : '';
  };
  api.isChatOngoing = function () {
    var chat = activeChat();
    return !!chat && chat.agentMessages > 0;
  };
  api.isVisitorEngaged = function () {
    return !!activeChat();
  };

  window.FakeTawk = {
    visitorMessage: visitorMessage,
    agentJoin: agentJoin,
    agentMessage: agentMessage,
    endChat: endChat,
    reset: reset
  };

  // ---- Start-up sequence, in the real widget's order ----

  setTimeout(function () {
    fire('onBeforeLoad');
    fire('onStatusChange', 'online');
    var chat = activeChat();
    if (chat) fire('onChatStarted', { chatId: chat.chatId });
    setTimeout(function () {
      loaded = true;
      renderWidget();
      fire('onLoad');
    }, 150);
  }, 20);
})();
