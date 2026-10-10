# Metro

A Rails- and Phoenix-like web framework for [Kex](https://github.com/kexhq/kex).
Pages are rendered on the server and kept live over a WebSocket; forms are
checked by declared validations; sign-in rests on hashed passwords and
server-side sessions.

Metro was extracted from a working application and holds what that
application needed and nothing speculative. HTTP is
[Rodolfo](https://github.com/kexhq/rodolfo)'s for now; the database is
[Harmat](https://github.com/kexhq/harmat)'s, and Metro does not depend on it.

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
- Every reply is the live region rendered again; the script patches the page,
  keeping what is being typed.

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

Components and a view tree, diffing on the server, row-level sync, sessions
and CSRF as one construct, a router of its own, generators. See the plan in
Kex's `docs/web-stack-plan.md`.

## Develop

```sh
tey install
tey test
```
