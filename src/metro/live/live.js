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
  const TYPING_PAUSE = 250;

  let socket = null;
  let attempts = 0;
  let typing = null;

  // Where the connection state shows. It may be inside the live region —
  // mark it `data-live-keep`, so a patch leaves what is written here alone.
  function show(state, text) {
    const status = document.getElementById("status");
    if (!status) return;
    status.dataset.state = state;
    status.textContent = text;
  }

  function connect() {
    const scheme = location.protocol === "https:" ? "wss://" : "ws://";
    // The socket is told where the page is, so the server can start the
    // live view at the same place the page was rendered for.
    socket = new WebSocket(scheme + location.host + "/live?at=" + encodeURIComponent(here()));

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

  // --- The address bar ------------------------------------------------------

  // `data-live-path` on an element of the live region says where the page
  // now is: after a render the address bar is made to say the same, as a new
  // history entry. Back and forward send a `visit` event with the address
  // gone to, and the server renders that place. `data-live-title` names the
  // document the same way.
  let visiting = false;

  function here() {
    return location.pathname + location.search;
  }

  function addressed() {
    const placed = app.querySelector("[data-live-path]");
    if (placed && placed.dataset.livePath && placed.dataset.livePath !== here()) {
      // A place arrived at through history is not a new entry in it.
      if (visiting) history.replaceState(null, "", placed.dataset.livePath);
      else history.pushState(null, "", placed.dataset.livePath);
    }
    visiting = false;
    const titled = app.querySelector("[data-live-title]");
    if (titled && document.title !== titled.dataset.liveTitle) document.title = titled.dataset.liveTitle;
  }

  window.addEventListener("popstate", () => {
    visiting = true;
    send({ event: "visit", path: here() });
  });

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
    // `data-wrap` puts a mark either side of what is selected in a field — a
    // bold button over a message box — or of the caret when nothing is.
    const wrapper = click.target.closest("[data-wrap]");
    if (wrapper) {
      const field = app.querySelector(wrapper.dataset.target);
      if (field) wrapWith(field, wrapper.dataset.wrap);
      return;
    }
    const button = click.target.closest("[data-event]");
    if (!button) return;
    // Choosing from a menu closes it.
    const menu = button.closest("details[data-menu]");
    if (menu) menu.open = false;
    flush();
    send({ ...button.dataset });
  });

  function insertAt(field, text) {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    field.value = field.value.slice(0, start) + text + field.value.slice(end);
    field.focus();
    field.setSelectionRange(start + text.length, start + text.length);
  }

  // `<details data-menu>` is a menu: a click anywhere else closes it, and so
  // does Escape.
  document.addEventListener("click", (click) => {
    for (const menu of document.querySelectorAll("details[data-menu][open]")) {
      if (!menu.contains(click.target)) menu.open = false;
    }
  });
  document.addEventListener("keydown", (key) => {
    if (key.key !== "Escape") return;
    for (const menu of document.querySelectorAll("details[data-menu][open]")) menu.open = false;
  });

  function wrapWith(field, mark) {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    field.value = field.value.slice(0, start) + mark + field.value.slice(start, end) + mark + field.value.slice(end);
    field.focus();
    field.setSelectionRange(start + mark.length, end + mark.length);
  }

  // `data-live-enter` on a textarea of a live form: Enter sends the form, as
  // it does in a one-line field, and Shift+Enter starts a new line.
  app.addEventListener("keydown", (key) => {
    if (key.key !== "Enter" || key.shiftKey || key.isComposing) return;
    if (!key.target.matches || !key.target.matches("textarea[data-live-enter]")) return;
    key.preventDefault();
    if (key.target.form) key.target.form.requestSubmit();
  });

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
    if (pending === form) pending = null;
    sendForm(form, form.dataset.live);
    // `data-live-reset`: a form that is sent and then empty again — a message
    // box. The server's reply cannot clear it, because what the person is
    // typing into is left alone when the page is patched.
    if (form.hasAttribute("data-live-reset")) form.reset();
    typed = 0;
  });

  // `data-live-typing` on a live form: while somebody types in it the server
  // is sent a `typing` event, at most one every few seconds, so it can tell
  // the others. What is typed is not sent.
  const TYPING_EVERY = 3000;
  let typed = 0;

  app.addEventListener("input", (input) => {
    const told = input.target.closest("form[data-live-typing]");
    if (told && input.target.value && Date.now() - typed > TYPING_EVERY) {
      typed = Date.now();
      send({ event: "typing" });
    }
    const form = input.target.closest("form[data-live]");
    // `data-live-quiet`: a form the server only hears from when it is sent.
    if (!form || form.hasAttribute("data-live-quiet")) return;
    // `data-live-change="draft"` names the event sent while it is typed
    // into, `change` unless it says; `data-live-pause` how many milliseconds
    // of quiet to wait for first.
    clearTimeout(typing);
    pending = form;
    typing = setTimeout(flush, Number(form.dataset.livePause) || TYPING_PAUSE);
  });

  // What was typed and not yet told goes at once when the field is left, so
  // a click elsewhere — and the patch it brings back — comes after it.
  let pending = null;
  function flush() {
    clearTimeout(typing);
    if (pending && document.contains(pending)) sendForm(pending, pending.dataset.liveChange || "change");
    pending = null;
  }
  app.addEventListener("focusout", (left) => {
    if (pending && pending.contains(left.target)) flush();
  });

  // `data-live-until="<milliseconds since 1970>"`: something true for a
  // while — "Ada is typing". It leaves the page when its time is up, whether
  // or not the server says anything more.
  setInterval(() => {
    for (const passing of app.querySelectorAll("[data-live-until]")) {
      if (Number(passing.dataset.liveUntil) <= Date.now()) passing.remove();
    }
  }, 500);

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
    // A field marked `autofocus` that a patch brings in takes the focus, as
    // it would have on a page load; one that was already there does not.
    const focusable = new Set([...app.querySelectorAll("[autofocus][id]")].map((field) => field.id));
    const wasOpen = Boolean(app.querySelector("#editor"));
    if (!wasOpen) opener = document.activeElement;
    const template = document.createElement("template");
    template.innerHTML = markup;
    patchChildren(app, template.content);

    for (const list of app.querySelectorAll('[data-stick="bottom"][id]')) {
      if (pinned.get(list.id) !== false) list.scrollTop = list.scrollHeight;
    }
    for (const field of app.querySelectorAll("[autofocus][id]")) {
      if (!focusable.has(field.id)) field.focus();
    }
    addressed();

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
    // `data-live-keep`: an element the browser's side writes into — the
    // connection state — and the server's markup must not write over.
    if (existing.hasAttribute("data-live-keep")) return;
    for (const name of existing.getAttributeNames()) {
      // Whether a <details> is open is the person's doing, like what is
      // typed in a field.
      if (name === "open" && existing.nodeName === "DETAILS") continue;
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
