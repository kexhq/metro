# Metro

A Rails- and Phoenix-like web framework for [Kex](https://github.com/kexhq/kex).
Pages are rendered on the server and kept live over a WebSocket; forms are
checked by declared validations; sign-in rests on hashed passwords and
server-side sessions.

Metro was extracted from a working application and holds what that
application needed and nothing speculative. HTTP is
[Rodolfo](https://github.com/kexhq/rodolfo)'s for now; the database is
[Harmat](https://github.com/kexhq/harmat)'s, and Metro does not depend on it.

## Starting an application

Metro ships a generator for the skeleton every application shares: the
Rails-style layout (`app/`, `config/`, `db/`), a database store with users
and sessions migrations, registration and sign-in behind plugs, one live page
to start from, a setup script and a smoke spec.

It is a Tey plugin, `metro:app`, run from a package that depends on Metro:

```sh
mkdir chat && cd chat
tey init chat --app
tey add rodolfo --git https://github.com/kexhq/rodolfo --branch main
tey add harmat --git https://github.com/kexhq/harmat --branch database-migrations-repositories
tey add metro --git https://github.com/akoskovacs/metro --branch main   # asks to approve the plugin
tey generate metro:app --force     # --force: it replaces what `tey init` wrote
sh script/setup.sh                 # src link, dependencies, the ODBC port program
tey server                         # http://127.0.0.1:4000
```

`--name chat_room` names the app differently from its directory; `--metro`
and `--harmat` give other sources for those two dependencies.

Once the app exists, Harmat's plugin adds migrations to it:
`tey generate harmat:migration --name add_channels --force`.

`tey generate` needs a Tey that has it (newer than 0.2.1). From a Metro
checkout the same generator also runs in one step, with any Tey:

```sh
tey new-app ../chat
```

## Live pages

A live page is three things you supply — a starting state, a function from
(state, event) to the next state, and a function from state to markup — run
against a WebSocket:

```kex
ws "/live" do |env, socket|
  Metro.Live.Socket.attached(
    socket, hub, user.id, Tab {},
    do |tab, event| handled(db, tab, event) end,   # -> (Tab, Bool): next state, did shared data change?
    do |tab| markup(db, tab) end                   # -> String: the live region
  )
end
```

The browser half is one script, served by `Metro.Live.Client.route()`:

```html
<main id="app">…the live region, rendered on the server…</main>
<span id="status" data-state="connecting"></span>
<script src="/metro/live.js"></script>
```

- A click on any element with `data-event="name"` sends that event with the
  element's other `data-*` attributes as fields.
- A `<form data-live="save">` sends its fields as `save` on submit, and as
  `change` while it is being typed into.
- An element with class `backdrop` is a modal: Escape or a click on the
  backdrop sends `cancel`, and Tab stays inside it.
- `data-live-reset` on a form empties it once it is sent (a message box);
  `data-live-quiet` keeps it from reporting each keystroke.
- `data-stick="bottom"` on an element with an id keeps a growing list scrolled
  to its newest end, unless the reader has scrolled up.
- `data-insert="😄" data-target="#box"` on a button types into a field without
  a round trip.
- Every reply is the live region rendered again; the script patches the page,
  keeping what is being typed.
- `data-live-path="/channels/general"` on an element of the live region puts
  that address in the address bar after a render; back and forward send a
  `visit` event with a `path` field, and the socket is opened with
  `/live?at=<the page's address>`. `data-live-title` sets the document title.
- A field with `autofocus` and an id takes the focus when a patch brings it in.

`Metro.Live.Hub` groups connections — by user, by channel, by whatever shares
data. When a step reports that shared data changed, the rest of the group is
told its page is stale and asks for a fresh render.

## Validation

```kex
let registration = rules do
  validates("email", "Email", [present, emailAddress])
  validates("password", "Password", [present, sized(10, 200)])
  inOrder("startDate", "endDate", "The end date is before the start date.")
end

let changeset = Metro.Validation.checked(registration, values)
changeset.valid?          # false
changeset.errors          # [("email", "Email is required."), …]
changeset.on("email")     # ["Email is required."]
```

Checks: `present`, `sized`, `decimal`, `moreThanZero`, `atMost`,
`calendarDate`, `emailAddress`, and `passing` for one of your own.
`Metro.Validation.permitted(entries, names)` keeps only the fields a form may
set.

## Authentication pieces

```kex
let stored = Metro.Auth.Password.hashed(password)     # pbkdf2-sha256$600000$salt$key
Metro.Auth.Password.matches?(password, stored)        # constant-time

let token = Metro.Auth.Token.fresh()                  # give this to the browser
Metro.Auth.Token.digest(token)                        # store this

Metro.Cookies.issued("session", token, 2592000, secure?)   # HttpOnly; SameSite=Lax
Metro.Plugs.cookie(env, "session")

plug(Metro.Plugs.sameOrigin)                          # no POST from another site
```

Metro supplies the pieces; where users and sessions are stored is the
application's.

## Also

`Metro.Decimal` — decimals as scaled integers (`scaled("1 250,5", 2)` is
`Just(125050)`), until Kex has a `Decimal`.

## Not here yet

Localization: every message Metro produces (validation errors, the
same-origin refusal) and every generated page is English text in the code.
Components and a view tree, diffing on the server, row-level sync, sessions
and CSRF as one construct, a router of its own, generators beyond `app`. See the plan in
Kex's `docs/web-stack-plan.md`.

## Develop

```sh
tey install
tey test
```
