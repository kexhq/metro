# Metro

A Rails- and Phoenix-like web framework for [Kex](https://github.com/kexhq/kex).
Pages are rendered on the server and kept live over a WebSocket; forms are
checked by declared validations; sign-in rests on hashed passwords and
server-side sessions.

Metro was extracted from a working application and holds what that
application needed and nothing speculative. It routes requests itself, on
Kex's `Net.HTTP`; the database is [Harmat](https://github.com/kexhq/harmat)'s,
and Metro does not depend on it.

| | |
| --- | --- |
| `Metro.Router`, `Metro.Path` | routes, pipelines and scopes; addresses said once |
| `Metro.WebRequest`, `Metro.Plugs` | what a plug and an action are handed, and the plugs every application wants |
| `Metro.Live.Socket`, `Hub`, `Presence`, `Client` | live pages: one tab's WebSocket, telling the other tabs, "is typing", and the browser script |
| `Metro.Validation` | `validates(…)` rules, checked into a changeset |
| `Metro.Auth.Password`, `Metro.Auth.Token`, `Metro.Cookies` | password hashes, session tokens, cookies |
| `Metro.Environment` | `METRO_ENV`, `PORT` and `HOST` |
| `Metro.Clock`, `Metro.Id` | the time as a number; ids for rows |
| `Metro.TimeZones` | the names of the world's time zones |
| `Metro.Storage` | files people upload, kept in a folder or elsewhere |
| `Metro.Assets`, `Metro.Static` | stylesheets addressed by their contents; files of `public/` |
| `Metro.Decimal` | decimals as scaled integers |

It needs Kex 0.4.0-rc.1 or newer.

## Routing

```kex
let routes = Metro.Router.define do
  pipeline(:application, [providing(:hub, hub)])
  pipeline(:browser, [Metro.Plugs.sameOrigin, Metro.Plugs.unstored])
  pipeline(:members, [App.Controllers.Application.signedIn()])

  scope "/", via: [:application, :browser, :members] do
    get("/", ~show)
    get(App.Paths.channelPath.template, ~show)
    post("/signout", ~signOut)
    live "/live" do |request, socket| App.Controllers.Chat.joined(request, socket) end
    resources("/channels", App.Controllers.Channels.resource)
  end

  static("public")
end

routes.start("127.0.0.1", 4000)
```

- A **pipeline** is a named list of plugs; a **scope** puts a path in front of
  its routes and runs them through pipelines, after those of the scope around
  it.
- A plug and an action are the same thing, `WebRequest -> WebRequest`. A plug
  notes something for the action (`request.assign(:user, user)`) or answers
  (`request.redirect("/signin")`), and a request that has been answered goes
  no further. An action reads (`request.param("name")`, `request.cookie(…)`,
  `request.assigned(:user)`) and answers (`request.html(…)`,
  `request.json(…)`, `request.redirect(…)`).
- A **live** route is a WebSocket behind the same plugs as a page.
- `resources` declares the usual seven routes for the actions a `Resource`
  record has.
- `Metro.Path.define("/:organization/channels/:name")` is an address said
  once: `.template` for the route, `.filled({…})` for a link,
  `.captured(address)` to read one back.
- `routes.call(Metro.WebRequest.asked("GET", "/"))` answers a request without
  a server, for specs; `routes.listing` is every route, in order.
- `Metro.Plugs.providing(:hub, hub)` notes something on every request, which
  an action reads back with `request.assigned(:hub)`; `sameOrigin` refuses a
  form or a socket from another site, and `unstored` tells the browser not
  to keep a page that is one person's.
- `static("public")` serves the files of a directory, with what a browser
  needs to keep them; `Metro.Assets.marked(markup, "public", ["/app.css"])`
  puts a mark of a file's contents on its address, so that the address
  changes exactly when the file does.
- An action that raises, or answers nothing, is a 500, and is logged with the
  route it was.

Actions are imported by name and referenced bare (`~show`); a reference
through the module does not resolve when called (kexhq/kex#476).

### The database is not passed along

Harmat's queries reach the database through a capability,
`Harmat.Connection`, and not through something on the request. An
application installs its database around *building* its routes as well as
serving them:

```kex
with Harmat.Connection = DB.Store.StoreConnection { store: store } do
  let site = Config.Routes.routes(hub)
  site.start(host, port).try
end
```

An action reaches the connection that was in force when its route was
written, not the one in force when a request arrives — so routes built
outside the `with` answer "no database connected".

## Where the application is running

```kex
match Metro.Environment.current() do
  Ok(Production) => …
  Ok(environment) => IO.printLine("running in ${environment.label}")
  Error(reason) => …      # METRO_ENV names none of the three
end

Metro.Environment.port()   # PORT, or 4000
Metro.Environment.host()   # HOST, or 127.0.0.1
```

| Variable | |
| --- | --- |
| `METRO_ENV` | `development` (the default), `test` or `production`; anything else is an error, not a guess |
| `PORT` | the port to listen on; 4000 unless set |
| `HOST` | the address to bind; 127.0.0.1 unless set |

An application does not name an environment variable of its own for this:
what differs between environments — which database, say — it decides from
`Metro.Environment.current()`, in its `config/`.

## Starting an application

Metro ships a generator for the skeleton every application shares: the
Rails-style layout (`app/`, `config/`, `db/`), a database store with users
and sessions migrations, registration and sign-in behind plugs, one live page
to start from, a setup script, a smoke spec, and a `Dockerfile` and
`docker-compose.yml` that run the application beside PostgreSQL.

It is a Tey plugin, `metro:app`, run from a package that depends on Metro:

```sh
mkdir chat && cd chat
tey init chat --app
tey add harmat --git https://github.com/kexhq/harmat --branch main
tey add metro --git https://github.com/kexhq/metro --branch main   # asks to approve the plugin
tey generate metro:app --force     # --force: it replaces what `tey init` wrote
sh script/setup.sh                 # dependencies, the ODBC port program
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
live "/live" do |request, socket|
  Metro.Live.Socket.attached(
    socket, hub, user.id, Tab {},
    do |tab, event| handled(tab, event) end,   # -> (Tab, Bool): next state, did shared data change?
    do |tab| markup(tab) end                   # -> String: the live region
  )
end
```

`live` is a route like any other: the request has been through the scope's
plugs before the socket is opened, so who is asking is already known.

The browser half is one script, served by `Metro.Live.Client.route()`:

```html
<main id="app">…the live region, rendered on the server…</main>
<span id="status" data-state="connecting"></span>
<script src="/metro/live.js"></script>
```

- A click on any element with `data-event="name"` sends that event with the
  element's other `data-*` attributes as fields.
- A `<form data-live="save">` sends its fields as `save` on submit, and as
  `change` while it is being typed into — once the typing pauses, and at once
  when the field is left. `data-live-change="draft"` names that event
  instead, and `data-live-pause="1000"` makes the pause that many
  milliseconds: a message box that keeps a draft.
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
- `data-wrap="*" data-target="#box"` on a button puts the mark either side of
  the selection in a field.
- `data-live-enter` on a textarea of a live form makes Enter send the form and
  Shift+Enter start a new line.
- `data-live-keep` on an element keeps a patch from writing over it: the
  `#status` request indicator, when it is inside the live region, or a form
  whose fields should keep what is typed in them while the page changes
  around it.
- `<details data-menu>` is a menu: it stays open across patches, and closes
  when something in it is chosen, on a click elsewhere, or on Escape.
- `data-live-hook="Name"` gives an element the application's own script:
  `window.Metro.hooks.Name`, an object with `mounted()`, `updated()` and
  `destroyed()`, called with `this.el` the element and `this.send(fields)`
  to send an event. Register hooks in a script of your own
  (`(window.Metro = window.Metro || {}).hooks = { … }`), before or after
  Metro's. What a hook adds inside the live region is patched away: put it
  on `document.body`, or under `data-live-keep`.
- The server is told whether the page is in front of the person — shown,
  and its window focused — as an `attention` event with `on` "true" or
  "false", when the socket opens and whenever that changes: what arrives
  while nobody looks has not been seen.
- `data-live-typing` on a live form sends a `typing` event, at most every few
  seconds, while somebody types in it; `data-live-until="<ms since 1970>"`
  takes an element off the page when its time is up. `Metro.Live.Presence`
  is the process that remembers such notes ("is typing", "Deploying") until
  they lapse.

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
`calendarDate`, `emailAddress`, `timeZone`, and `passing` for one of your
own. Besides `validates`, a rule list takes `inOrder(earlier, later,
message)` for two dates, and `confirmed(field, again, message)` for a
password typed twice: compared exactly, and only when the second is given.
`Metro.Validation.permitted(entries, names)` keeps only the fields a form may
set.

## Authentication pieces

```kex
let stored = Metro.Auth.Password.hashed(password)     # pbkdf2-sha256$600000$salt$key
Metro.Auth.Password.matches?(password, stored)        # constant-time

let token = Metro.Auth.Token.fresh()                  # give this to the browser
Metro.Auth.Token.digest(token)                        # store this

request.withCookie(Metro.Cookies.issued("session", token, 2592000, secure?))   # HttpOnly; SameSite=Lax
request.cookie("session")
request.withCookie(Metro.Cookies.cleared("session"))

pipeline(:browser, [Metro.Plugs.sameOrigin])          # no POST from another site
```

Metro supplies the pieces; where users and sessions are stored is the
application's.

## Time and ids

```kex
Metro.Clock.seconds()             # since 1970: when a session expires
Metro.Clock.milliseconds()        # when a message was sent, when a note lapses
Metro.Clock.microseconds()

Metro.Id.generate(prefix: "u")    # "u1791741238785550-6": a new row's id
Metro.Id.serial()                 # 6: a tab, a seat — unique while this node runs
```

The clock is the standard library's (`Time.Clock`), so a spec that replaces
it moves these too. A generated id is its kind's prefix, the microsecond it
was made in and a serial number: the prefix says what it is an id of
wherever it turns up, and the time keeps ids of one kind in the order they
were made.

`Metro.TimeZones.NAMES` lists the IANA time zone names — one for each
place in tzdata's zone.tab, and UTC — for a person to pick theirs from;
`known?(name)` says whether a name is one, and the `timeZone` check asks it
of a form's field. They are names only, until Kex's clock knows named zones.

## Files people upload

`Metro.Storage` keeps uploaded files, as Active Storage does: in a folder
unless the application installs something else. A service is a capability,
so swapping the folder for another provider is one `with` where the
application starts:

```kex
# The default: ./storage, or METRO_STORAGE_ROOT.
with Metro.Storage.Service = Metro.Storage.Disk { root: "/var/lib/app/files" } do
  site.start(host, port)
end
```

Another provider is a record that implements `put`, `get` and `delete`
by key: `make S3, implement: Metro.Storage.Service do … end`. Metro has only the
folder for now: S3 needs HMAC-SHA256 in Kex (kexhq/kex#459).

A page marks where files may be dropped. Dropped, pasted or chosen files
are POSTed one by one, each as a request's whole body; the event is then
sent with whatever the upload route answered:

```html
<section data-live-drop="share">
  … <input type="file" multiple>
</section>
```

```kex
post("/uploads", ~uploaded)   # behind the plugs that say who may upload

foul uploaded(request: WebRequest) -> WebRequest do
  match Metro.Storage.received(request) do
    Ok(blob) => request.json(200, {"file": blob.key, "name": blob.filename})   # → a `share` event with these fields
    Error(reason) => request.json(422, {"error": reason})                      # → `share-failed`
  end
end

Metro.Storage.served(request, blob)   # the file, to someone allowed to see it
```

`received` takes the name from `X-Filename` and the type from
`Content-Type`, stores the bytes under a new key and answers with a `Blob`:
key, file name, type, size and SHA-256. What a file belongs to and who may
read it is the application's to keep. `served` shows only pictures, plain
text and PDF in the page, never sniffs, and sandboxes what it sends;
anything else is a download. Net.HTTP refuses a body over 10 MiB
(kexhq/kex#488).

## Also

`Metro.Decimal` — decimals as scaled integers (`scaled("1 250,5", 2)` is
`Just(125050)`), until Kex has a `Decimal`.

## Not here yet

Localization: every message Metro produces (validation errors, the
same-origin refusal) and every generated page is English text in the code.
Components and a view tree, diffing on the server, row-level sync, sessions
and CSRF as one construct, generators beyond `app`. See the plan in Kex's
`docs/web-stack-plan.md`.

## Develop

```sh
tey install
tey test
```

## License

Metro is licensed under the GNU Lesser General Public License, version 3
or (at your option) any later version (`LGPL-3.0-or-later`).
See [COPYING.LESSER](COPYING.LESSER) and [COPYING](COPYING) for the license terms.
