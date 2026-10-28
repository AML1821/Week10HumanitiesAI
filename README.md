# Dead Signal

A sci-fi horror watch tracker styled like an amber CRT terminal on a derelict ship. Static HTML, CSS and JavaScript with no build step, made for GitHub Pages.

- `index.html`, `style.css`, `app.js`: the page
- `scifi_horror_films.json`: 496 films (from Wikipedia's *List of science fiction horror films*), loaded with `fetch()`

## Tabs

- **Archive**: search by title, filter by decade, tag, franchise and your status. Click a film to open its dossier and set status (Queued / Watching / Finished / Dropped), a 1–10 rating, a date, a favorite star and notes. Changes save as you edit.
- **My log**: your rated films ranked (rating, then favorite, then most recent date), with unrated entries grouped by status below.
- **Signals**: recommendations built from the tags of films you rated 7+. Each tag is weighted by how highly you rated those films and by rarity (`ln(496 / films with tag)`), so uncommon tags count more. Unseen films in a franchise you rated highly get a boost (full for sequels, half for earlier entries).
- **Readouts**: charts of your ratings and log.

Keys `1`–`4` switch tabs.

## Your data

The log is stored in this browser's `localStorage` (key `deadSignal.log.v1`). Use **Backup** to export it as a JSON file and import it on another browser or device. Import can merge (the newer edit wins) or replace.

## Running it

On GitHub Pages: Settings → Pages → deploy from the branch, root folder. Locally, `fetch()` needs a web server rather than `file://`:

```bash
python3 -m http.server
```

then open http://localhost:8000.
