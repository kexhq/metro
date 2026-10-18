# Components: an aspirational example

**None of this compiles yet.** It is how a Metro app is meant to read once
Metro has components, written as real files so the shape can be judged,
argued with and changed before anything is built. The app is a small slice
of [Slick](https://github.com/akoskovacs/slick): a sidebar, a conversation,
reactions, the message box and the new-channel dialog.

The aim, in one line: **a component is a record, its events are its slots,
and its markup is the `.ket` beside it** — and the same component runs as a
live component on the server today, and as JavaScript in the browser once
Kex compiles to it.

```
app/
  ui/                 stateless pieces: Button, Dialog, Field, Entry
  components/
    channel_form      client, with state: a dialog that asks the server once
    composer          client, with state: the message box and @ suggestions
    reactions         client, with state: changes shown at once, undone if refused
    emoji_picker      client, with state: never asks the server at all
    sidebar           server, no state: reads channels, groups, teams
    conversation_pane server, no state: reads messages, holds client components
  pages/chat          server, with state: where the tab is, which dialog is open
  actions.kex         everything that changes what is stored, one per tab
  rules.kex           checks shared by components and actions
spec/
  components.spec.kex components driven one event at a time
```

## Nothing new to learn

Almost all of it is Kex that exists today, used one way:

| React | Here | Kex already has |
|---|---|---|
| a component | a `record` | records |
| props | the fields its parent sets in the tag | record literals |
| `useState` | the fields its parent doesn't set | defaults, `New { … }`, `new.x = …` |
| event handlers | `slot on(Event)` clauses | `serving`, multi-clause slots |
| `onClick={() => …}` | `on:click="<%= Toggled(tally.emoji) %>"`: a value | sum types |
| JSX | the `.ket` file beside the module | `.ket` templates |
| `useEffect` on mount | `slot mounted` | slots |
| server actions | the slots of `App.Actions` | `serving`, `Server<…>` |

There are no hooks, so there are no rules of hooks. State is the record's
fields and can be read in one place. An event is data, not a closure, which
is what lets it cross a socket.

## Three kinds, two questions

Whether a component **has state** is whether it has a `serving` block or
only a `make` one. Whether it **may read what is stored** is whether its
module is a `client module`:

| | No state (`make`) | State and events (`serving`) |
|---|---|---|
| **`client module`**: runs on the server or in the browser | `Button`, `Dialog`, `Field`, `Entry` | `ChannelForm`, `Composer`, `Reactions`, `EmojiPicker` |
| **`module`**: stays on the server, may read data | `Sidebar`, `ConversationPane` | the `Chat` page |

A client module can't use a server one: no repositories, no `Server<…>` of
the app's own, no FFI, no clock. Its only way to the database is an action.

## How one component runs in two places

| | Live on the server (first) | In the browser (once Kex compiles to JS) |
|---|---|---|
| the record | in a process of the tab's socket | in a process of Kex's JS runtime |
| a click | the browser sends the event's node; Metro delivers its value to the slot | the listener delivers the value to the slot |
| a render | the view is diffed on the server and patches sent | diffed in the browser |
| `Actions.current.react(…)` | a call to the tab's `Actions` process | the same call, over the socket |
| `Metro.ask`, `Metro.later` | a task, a timer | the same |

A route says where client components run, `components: Metro.Client` or
`Metro.Server`, and until the JavaScript backend exists `Client` means
`Server`. Moving a component into the browser changes no line of it.
Because a record is plain data, a component rendered on the server can be
handed to the browser as it stands: its fields are its whole state.

## The rules Metro keeps

- **A tag is a record literal.** `<Button kind="primary">Save</Button>` is
  `Button { kind: "primary", children: … }`. Attributes are typed by the
  fields: `Bool` for `disabled`, an `Event` for `onClick`, a list for
  `tallies`. A required field left out is a compile error.
- **The template is found by name.** `channel_form.kex` renders
  `channel_form.html.ket`, beside it, with `this` in scope: `@title`, and the
  `make`/`serving` block's own functions, like `found` and `channels`.
  `render("other.html.ket")` picks another template when one module needs
  two.
- **Props are set again, state is kept.** Each time a parent renders, the
  fields it passes are replaced; the rest stay. `key=` keeps a component in a
  list the same component when the list changes order.
- **An event goes to the component whose template made it.**
  `onClick="<%= Cancelled %>"` given to a `<Button>` inside `ChannelForm` is
  `ChannelForm`'s `Cancelled`, wherever the button is. A function from a
  field's value to an event, like `on:input="<%= Named %>"`, gets the value.
  `None` leaves the handler out.
- **To tell the parent, emit what it gave you.** `onCreated : String ->
  Metro.Event` holds the parent's `Opened`, and `Metro.emit(@onCreated(id))`
  sends it there.
- **Waiting is an event too.** `Metro.ask({ call }, Answered)` makes the call
  beside the component and delivers the reply as `Answered(…)`, so the
  component renders "busy" in the meantime. `Metro.later(ms, event)` delivers
  an event later.
- **Trust lives in actions.** `App.Actions` is started per tab from the
  session; `@user` is who signed in. A component in the browser belongs to
  whoever runs it, so every check is in an action, again — the `Rules` a
  component runs to say what is wrong as somebody types are run again there.
- **Data changes re-render who listened.** An action calls
  `Metro.publish("conversation:c1")`; every component whose `listens`
  includes it, in every tab, renders again. Client components in it keep
  what they hold: a message arriving doesn't clear the message box.

## What Slick loses

The same parts of Slick today, for comparison:

- `App.Live.Tab` holds every dialog's fields in one record, with `dialog :
  String` naming which of eleven is open. Here the page holds `dialog :
  Open`, and each dialog's fields are its own.
- `App.Live.Chat.handled` matches about sixty event names in one place.
  Here each component matches its own few, by type.
- `App.Live.Chat.markup` runs every query for every render, a keystroke's
  included. Here a component reads what it shows, and renders again only
  when its topic is published.
- `App.Views.Chat.index` takes 21 arguments and its templates take
  markup already rendered as `String`s. Here a template holds components.
- The `Composer` hook in `public/app.js` reads who can be mentioned from
  JSON in a `data-` attribute. Here the suggestions are the composer's
  state, in Kex.

## What it needs

From **Metro**: `Metro.Event` and `Metro.View`, the server runner (a process
per component, routing events by node, diffing), `Metro.emit`, `ask`,
`later`, `publish`, `navigate`, `Metro.actions`, `Metro.Test.mounted`, and
`live.js` as a host that applies patches. These can start before Kex
changes, with views built by functions until templates can build trees.

From **Kex**:

- a view mode for `.ket` lowering: markup checked while compiling, built as
  a tree, typed attribute holes, `<Component>` tags as record literals,
  `this` in scope, the template found beside its module;
- `client module`, and a check that one never uses a server module;
- the JavaScript backend and its process runtime, with calls to a server
  process compiled into requests over a socket;
- fixes already filed that this leans on: kexhq/kex#309 (named arguments to
  a generated template), #455 (template compile time), #448 (a field read
  as a function call in a template), #487 and #509 (building records and
  constructors by name, for events and records crossing the socket).

Later, perhaps: a `component` keyword joining `record`, `serving` and the
template in one block, from which the compiler builds `Event` and checks
every `on:` against it.
