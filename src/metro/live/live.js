// The browser half of the live page. The server renders; this file only
//   - opens the WebSocket and reconnects when it drops,
//   - turns clicks, typing and form submissions into events, and
//   - patches the markup the server sends back into the page.
//
// An event is form-encoded text ("event=save&name=…"). A reply is either
// "render\n<markup for #app>" or the single word "stale", which means another
// tab changed something and this one should ask for a fresh render.
(() => {
  "use strict";

  const app = document.getElementById("app");
  const status = document.getElementById("status");
  const TYPING_PAUSE = 250;

  let socket = null;
  let attempts = 0;
  let typing = null;

  function show(state, text) {
    status.dataset.state = state;
    status.textContent = text;
  }

  function connect() {
    const scheme = location.protocol === "https:" ? "wss://" : "ws://";
    socket = new WebSocket(scheme + location.host + "/live");

    socket.addEventListener("open", () => {
      attempts = 0;
      show("live", "Live");
      // A reconnect starts a new session on the server, which knows nothing
      // of a form left open here; sending it back restores the draft.
      const form = app.querySelector("form[data-live]");
      if (form) sendForm(form, "change");
    });

    socket.addEventListener("message", (message) => {
      if (message.data === "stale") return send({ event: "refresh" });
      const cut = message.data.indexOf("\n");
      if (message.data.slice(0, cut) === "render") render(message.data.slice(cut + 1));
    });

    socket.addEventListener("close", () => {
      show("offline", "Reconnecting…");
      attempts += 1;
      setTimeout(connect, Math.min(5000, 250 * 2 ** attempts));
    });
  }

  function send(fields) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(new URLSearchParams(fields).toString());
    }
  }

  function sendForm(form, event) {
    const fields = new URLSearchParams(new FormData(form));
    fields.set("event", event);
    send(fields);
  }

  // --- Events -------------------------------------------------------------

  app.addEventListener("click", (click) => {
    // A click on the dimmed page around the dialog, not in it, dismisses it.
    if (click.target.classList.contains("backdrop")) return send({ event: "cancel" });
    // `data-insert` types into a field instead of telling the server: an
    // emoji button beside a message box. `data-target` is the field's selector.
    const inserter = click.target.closest("[data-insert]");
    if (inserter) {
      const field = app.querySelector(inserter.dataset.target);
      if (field) insertAt(field, inserter.dataset.insert);
      return;
    }
    const button = click.target.closest("[data-event]");
    if (!button) return;
    clearTimeout(typing);
    send({ ...button.dataset });
  });

  function insertAt(field, text) {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    field.value = field.value.slice(0, start) + text + field.value.slice(end);
    field.focus();
    field.setSelectionRange(start + text.length, start + text.length);
  }

  // While the dialog is open the keyboard belongs to it: Escape dismisses it
  // and Tab goes round its own controls instead of out to the page behind.
  document.addEventListener("keydown", (key) => {
    const dialog = app.querySelector(".backdrop");
    if (!dialog) return;
    if (key.key === "Escape") {
      key.preventDefault();
      clearTimeout(typing);
      return send({ event: "cancel" });
    }
    if (key.key !== "Tab") return;
    const stops = Array.from(dialog.querySelectorAll("input:not([type=hidden]), textarea, button"));
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!dialog.contains(document.activeElement)) {
      key.preventDefault();
      first.focus();
    } else if (key.shiftKey && document.activeElement === first) {
      key.preventDefault();
      last.focus();
    } else if (!key.shiftKey && document.activeElement === last) {
      key.preventDefault();
      first.focus();
    }
  });

  app.addEventListener("submit", (submission) => {
    const form = submission.target.closest("form[data-live]");
    if (!form) return;
    submission.preventDefault();
    clearTimeout(typing);
    sendForm(form, form.dataset.live);
    // `data-live-reset`: a form that is sent and then empty again — a message
    // box. The server's reply cannot clear it, because what the person is
    // typing into is left alone when the page is patched.
    if (form.hasAttribute("data-live-reset")) form.reset();
  });

  app.addEventListener("input", (input) => {
    const form = input.target.closest("form[data-live]");
    // `data-live-quiet`: a form the server only hears from when it is sent.
    if (!form || form.hasAttribute("data-live-quiet")) return;
    clearTimeout(typing);
    typing = setTimeout(() => sendForm(form, "change"), TYPING_PAUSE);
  });

  // --- Patching -----------------------------------------------------------

  // What had the focus before the dialog opened, to hand it back on close.
  let opener = null;

  function render(markup) {
    // `data-stick="bottom"` on an element with an id keeps a list that grows
    // downwards showing its newest end: after a patch it is scrolled to the
    // bottom if it was there before, or is new. Someone reading further up
    // is left where they are.
    const pinned = new Map();
    for (const list of app.querySelectorAll('[data-stick="bottom"][id]')) {
      pinned.set(list.id, list.scrollHeight - list.scrollTop - list.clientHeight < 48);
    }
    const wasOpen = Boolean(app.querySelector("#editor"));
    if (!wasOpen) opener = document.activeElement;
    const template = document.createElement("template");
    template.innerHTML = markup;
    patchChildren(app, template.content);

    for (const list of app.querySelectorAll('[data-stick="bottom"][id]')) {
      if (pinned.get(list.id) !== false) list.scrollTop = list.scrollHeight;
    }

    const editor = app.querySelector("#editor");
    if (editor && !wasOpen) {
      const first = editor.querySelector("input:not([type=hidden]), textarea");
      if (first) first.focus();
    }
    if (!editor && wasOpen && opener && document.contains(opener)) opener.focus();
    const problem = app.querySelector(".field.invalid input, .field.invalid textarea");
    if (problem && editor && !editor.contains(document.activeElement)) problem.focus();
  }

  // Makes `current`'s children match `wanted`'s, reusing the nodes that are
  // already there. An element with an id is matched by it, so a row keeps its
  // node when rows before it come and go; everything else is matched by
  // position and tag.
  function patchChildren(current, wanted) {
    let index = 0;
    for (const next of Array.from(wanted.childNodes)) {
      let existing = current.childNodes[index];
      if (next.nodeType === Node.ELEMENT_NODE && next.id) {
        const keyed = Array.from(current.children).find((child) => child.id === next.id);
        if (keyed && keyed !== existing) {
          current.insertBefore(keyed, existing || null);
          existing = keyed;
        }
      }
      if (!existing) {
        current.appendChild(document.importNode(next, true));
      } else if (sameNode(existing, next)) {
        patchNode(existing, next);
      } else if (existing.nodeType === Node.ELEMENT_NODE && existing.id) {
        // A keyed element out of place is wanted further on, not gone: put
        // the new node ahead of it rather than over it.
        current.insertBefore(document.importNode(next, true), existing);
      } else {
        current.replaceChild(document.importNode(next, true), existing);
      }
      index += 1;
    }
    while (current.childNodes.length > index) current.lastChild.remove();
  }

  function sameNode(existing, next) {
    return existing.nodeType === next.nodeType
      && existing.nodeName === next.nodeName
      && (existing.id || "") === (next.id || "");
  }

  function patchNode(existing, next) {
    if (existing.nodeType !== Node.ELEMENT_NODE) {
      if (existing.nodeValue !== next.nodeValue) existing.nodeValue = next.nodeValue;
      return;
    }
    for (const name of existing.getAttributeNames()) {
      if (!next.hasAttribute(name)) existing.removeAttribute(name);
    }
    for (const name of next.getAttributeNames()) {
      const value = next.getAttribute(name);
      if (existing.getAttribute(name) !== value) existing.setAttribute(name, value);
    }
    // What is typed lives in a property, not in the markup — and whatever the
    // person is typing into right now is theirs, not the server's.
    const typedInto = existing === document.activeElement;
    if (existing.nodeName === "INPUT") {
      if (!typedInto) existing.value = next.getAttribute("value") || "";
      return;
    }
    if (existing.nodeName === "TEXTAREA") {
      if (!typedInto) existing.value = next.textContent;
      return;
    }
    patchChildren(existing, next);
  }

  // The page as the server first sent it has its lists at the top.
  for (const list of app.querySelectorAll('[data-stick="bottom"][id]')) list.scrollTop = list.scrollHeight;

  connect();
})();
