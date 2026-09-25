# Skynet Counter — Mac desktop widget

The counter, its dial and its band, on the desktop. It reads
`https://skynet-counter.com/api/skynet/summary` (or `/summary/all` for every
counter) every 15 minutes and draws it — it never runs a sweep and never touches
`data/skynet.db`. Clicking a counter opens its page on the site.

## Install

[Übersicht](https://tracesof.net/uebersicht/) renders HTML widgets onto the
desktop wallpaper layer. It is free and unsigned by Apple, so the first launch
needs a right-click → Open.

```bash
brew install --cask ubersicht
open -a Übersicht                      # grants it Screen Recording on first run
cp skynet-counter.jsx "$HOME/Library/Application Support/Übersicht/widgets/"
```

Übersicht picks the file up immediately — there is no reload step. It also loads
**every** `.jsx` in that directory as a widget, so copy the one file rather than
the folder.

## Picking a layout

`LAYOUT` at the top of `skynet-counter.jsx`:

| Value | Shows |
|---|---|
| `'tile'` | the default domain alone, full-size dial (the original widget) |
| `'column'` | every domain, stacked |
| `'row'` | every domain, side by side |
| `'grid'` | every domain, three to a row |

The multi-counter layouts read the domain list from the server, so a domain added
to the site shows up here with no widget edit. Progress domains draw green, as on
the site. For two layouts at once, copy the file under a second name and set
`LAYOUT` in each.

## Moving and resizing it

Both live in the `className` export at the top of `skynet-counter.jsx`:

```js
top: 40px;      // distance from the top of the screen
left: 40px;     // from the left; swap for `right:` to pin to the other side
width: 300px;   // the tile's gauge scales with this; the other layouts size to their cards
```

Save the file and the widget redraws.

## If it says SIGNAL LOST

That is the widget reporting, not failing — it means the curl came back empty,
errored, or returned something that was not JSON, and the note underneath is the
reason verbatim. Check the endpoint by hand:

```bash
curl -sS --max-time 10 https://skynet-counter.com/api/skynet/summary
```

A healthy response is one line: `{"counter":41.3,"updatedAt":"…","status":"…"}`.

**STALE** is a different thing and not an error: the number is real, but the last
sweep landed over three hours ago, and the pipeline is supposed to run hourly. It
points at the pipeline container or the host, not at the widget.

## Changing it

`bun test tests/widgets/` covers the render — the bands, the needle geometry, the
staleness cutoff and all three failure paths — without Übersicht running. The
test lives in `tests/widgets/` rather than beside the widget precisely because
Übersicht would otherwise install it as a second, broken widget.
