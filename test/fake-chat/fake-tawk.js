// Fake Tawk.to embed script, for automated tests.
// It imitates the real widget as observed with the real widget on 2026-10-13 and 2026-10-14
// (notes/research/tawk.md, sections 7 and 8.3). A fake proves the logic; only the real chat proves it works.
//
// Copied from the real widget:
// - Everything is sent twice: first as a "tawk..." CustomEvent on window (tawkLoad, tawkChatMessageAgent
//   and so on), whose detail is what the callback gets (null when it gets nothing), then to the matching
//   Tawk_API.onX callback.
// - Each Tawk_API.onX callback is read ONCE when this script starts. Later changes are ignored.
// - Load order: BeforeLoad, StatusChange("online"), ChatStarted (only if a chat is already going), then
//   Load. getStatus() returns "" until Load.
// - Messages pass { message, attachments: [] } with no ID or time. AgentJoinChat and AgentLeaveChat pass
//   { name, position, image, id }. ChatStarted passes { chatId }.
// - The first visitor message fires ChatMessageVisitor, then ChatStarted.
// - isChatOngoing() is true only after an agent message, and false again once the agent has left.
// - After a page refresh, old messages are shown but NOT fired again; ChatStarted fires again, unless
//   the chat has ended.
// - Agent events, chat start and chat end reach every open tab of the site (a BroadcastChannel stands
//   in for the server). A visitor's message only fires in the tab it was typed in. Each tab gets its own
//   copy, so a handler that throws in one tab can't stop the others.
// - endChat() stands in for the visitor's "End chat": ChatEnded fires, with nothing. When the agent
//   closes the chat (agentLeave()), only AgentLeaveChat fires, never ChatEnded, and the agent can come
//   back to the same chat.
// Not checked against the real widget (assumptions):
// - Visitor messages after the first also stay in their own tab (only the first was seen).
// - Callbacks with no data: the real ones get one argument (null or undefined); the fake passes none.
// - Handler errors: the fake lets them throw.
// Simplifications (the fake does less than the real widget):
// - Agent actions need a visitor message first, though real agents can start a chat themselves.
// - UnreadCountChanged, ChatMaximized, ChatMinimized and the automatic greeting (ChatMessageSystem)
//   are never fired.
// Test option (set before this script loads): window.FakeTawkOptions = { skipOnLoad: true } stops it
// before Load, to test what happens if Tawk.to never finishes loading.
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
  var options = window.FakeTawkOptions || {};

  // Read every callback once, now, like the real widget does.
  var handlers = {};
  CALLBACKS.forEach(function (name) {
    handlers[name] = api[name];
  });

  var loaded = false;
  var channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('fake-tawk') : null;

  // First the window event, then the site's callback, like the real widget. A window listener that
  // throws can't stop the callback (dispatchEvent reports the error instead of throwing it).
  function fire(name, arg) {
    var hasArg = arguments.length > 1;
    window.dispatchEvent(new CustomEvent('tawk' + name.slice(2), { detail: hasArg ? arg : null }));
    var fn = handlers[name];
    if (typeof fn !== 'function') return;
    if (hasArg) fn(arg); else fn();
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
    } else if (type === 'chat_started') {
      fire('onChatStarted', { chatId: payload.chatId });
    } else if (type === 'agent_joined') {
      fire('onAgentJoinChat', Object.assign({}, AGENT));
    } else if (type === 'agent_left') {
      fire('onAgentLeaveChat', Object.assign({}, AGENT));
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
    // Tell the other tabs first: the real server reaches each tab separately, so a handler that
    // throws in this tab must not stop them hearing it.
    broadcast(type, payload);
    deliver(type, payload);
  }

  // ---- Actions (used by the page's buttons and by tests) ----

  function visitorMessage(text) {
    var chat = activeChat();
    var newChatId = null;
    if (!chat) {
      newChatId = makeChatId();
      chat = { chatId: newChatId, agentJoined: false, agentMessages: 0, ongoing: false, ended: false, messages: [] };
    }
    chat.messages.push({ from: 'visitor', text: text });
    saveChat(chat);
    // The other tabs hear that a chat started, but not what the visitor wrote (real widget, 2026-10-14).
    if (newChatId) broadcast('chat_started', { chatId: newChatId });
    deliver('visitor_message', { text: text, newChatId: newChatId });
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
    chat.ongoing = true;
    chat.messages.push({ from: 'agent', text: text });
    saveChat(chat);
    send('agent_message', { text: text });
  }

  // The agent closes the chat in the dashboard (Tawk.to has no "leave" button). The visitor only hears
  // that the agent left; the chat isn't over, and the agent can join and reply again later.
  function agentLeave() {
    var chat = activeChat();
    if (!chat) throw new Error('Fake Tawk.to: there is no chat for the agent to leave.');
    chat.agentJoined = false;
    chat.ongoing = false;
    saveChat(chat);
    send('agent_left', {});
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
    return !!chat && !!chat.ongoing;
  };
  api.isVisitorEngaged = function () {
    return !!activeChat();
  };

  window.FakeTawk = {
    visitorMessage: visitorMessage,
    agentJoin: agentJoin,
    agentMessage: agentMessage,
    agentLeave: agentLeave,
    endChat: endChat,
    reset: reset
  };

  // ---- Start-up sequence, in the real widget's order ----

  setTimeout(function () {
    fire('onBeforeLoad');
    fire('onStatusChange', 'online');
    var chat = activeChat();
    if (chat) fire('onChatStarted', { chatId: chat.chatId });
    if (options.skipOnLoad) return;
    setTimeout(function () {
      loaded = true;
      renderWidget();
      fire('onLoad');
    }, 150);
  }, 20);
})();
