/* Dead Signal: sci-fi horror watch tracker.
   Plain JS, no build step. Film data comes from scifi_horror_films.json via fetch();
   the user's log lives in localStorage under STORE_KEY. */
(() => {
  "use strict";

  const DATA_URL = "scifi_horror_films.json";
  const STORE_KEY = "deadSignal.log.v1";
  const PAGE_SIZE = 60;

  // Status values match the dataset's schema (meta.notes); labels are what the UI shows.
  const STATUSES = {
    want: "Queued",
    in_progress: "Watching",
    completed: "Finished",
    dropped: "Dropped",
  };

  const $ = (sel, root = document) => root.querySelector(sel);

  const state = {
    films: [],          // items from the JSON
    byId: new Map(),
    franchises: {},     // franchise name -> [ids]
    tagCounts: new Map(),
    log: {},            // id -> { status, rating, date, notes, favorite, updated }
    tab: "archive",
    shown: PAGE_SIZE,
    current: null,      // id open in the dossier
  };

  // ---------- helpers ----------
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const decadeOf = (y) => (y ? Math.floor(y / 10) * 10 : null);
  const sortTitle = (t) => t.replace(/^(the|a|an)\s+/i, "").toLowerCase();
  const entry = (id) => state.log[id] || null;

  function isEmptyEntry(e) {
    return !e || (!e.status && !e.rating && !e.date && !e.notes && !e.favorite);
  }

  // ---------- storage ----------
  function loadLog() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      console.warn("Could not read saved log", err);
      return {};
    }
  }

  function saveLog() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.log));
      return true;
    } catch (err) {
      console.warn("Could not save log", err);
      setStatusLine("WARNING: LOCAL STORAGE UNAVAILABLE. CHANGES WILL NOT PERSIST. USE BACKUP.", true);
      return false;
    }
  }

  function updateEntry(id, patch) {
    const next = { ...(state.log[id] || {}), ...patch, updated: new Date().toISOString() };
    if (isEmptyEntry(next)) delete state.log[id];
    else state.log[id] = next;
    return saveLog();
  }

  function setStatusLine(text, warn = false) {
    const el = $("#status-line");
    el.innerHTML = `&gt; ${esc(text)}<span class="cursor">_</span>`;
    el.classList.toggle("warn", warn);
  }

  // ---------- boot ----------
  async function boot() {
    state.log = loadLog();
    try {
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      ingest(data);
    } catch (err) {
      console.error(err);
      setStatusLine("SIGNAL LOST", true);
      $("#archive-list").outerHTML = `<div class="boot-error"><p><strong>Could not load the archive.</strong> (${esc(err.message)})</p>
        <p>The page needs <code>${DATA_URL}</code> served over HTTP. On GitHub Pages this works automatically; locally, run
        <code>python3 -m http.server</code> in the repository folder and open <code>http://localhost:8000</code>.</p></div>`;
      return;
    }
    setupFilters();
    setupTabs();
    setupDossier();
    setupBackup();
    const logged = Object.keys(state.log).length;
    setStatusLine(`LINK ESTABLISHED. ${state.films.length} RECORDS RECOVERED. ${logged} LOG ENTR${logged === 1 ? "Y" : "IES"} ON FILE.`);
    renderAll();
  }

  function ingest(data) {
    const items = Array.isArray(data) ? data : data.items || [];
    state.films = items.filter((f) => f && f.id && f.title);
    state.byId = new Map(state.films.map((f) => [f.id, f]));
    state.franchises = data.franchises || {};
    // Make sure every franchise in items is represented, even if the map is missing it.
    for (const f of state.films) {
      if (!f.franchise) continue;
      const ids = (state.franchises[f.franchise] ||= []);
      if (!ids.includes(f.id)) ids.push(f.id);
    }
    state.tagCounts = new Map();
    for (const f of state.films) for (const t of f.tags || []) state.tagCounts.set(t, (state.tagCounts.get(t) || 0) + 1);
    // Seed from the dataset's own user fields only for ids the browser has never logged.
    for (const f of state.films) {
      const u = f.user;
      if (!u || state.log[f.id]) continue;
      const seeded = { status: u.status || "", rating: u.rating || 0, date: u.date_completed || "", notes: u.review || "", favorite: !!u.favorite };
      if (!isEmptyEntry(seeded)) state.log[f.id] = seeded;
    }
  }

  // ---------- tabs ----------
  function setupTabs() {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const select = (tab, focus = false) => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute("aria-selected", on);
        t.tabIndex = on ? 0 : -1;
        $("#" + t.getAttribute("aria-controls")).hidden = !on;
      }
      state.tab = tab.dataset.tab;
      if (focus) tab.focus();
      try { history.replaceState(null, "", "#" + state.tab); } catch (_) { /* ignore */ }
      renderCurrent();
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(t));
      t.addEventListener("keydown", (e) => {
        let j = null;
        if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = tabs.length - 1;
        if (j !== null) { e.preventDefault(); select(tabs[j], true); }
      });
    });
    // Number keys 1–4 switch tabs when not typing.
    document.addEventListener("keydown", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || $("dialog[open]")) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= tabs.length) select(tabs[n - 1]);
    });
    const fromHash = tabs.find((t) => "#" + t.dataset.tab === location.hash);
    if (fromHash) select(fromHash);
  }

  function renderCurrent() {
    ({ archive: renderArchive, log: renderLog, signals: renderSignals, readouts: renderReadouts }[state.tab])();
  }
  function renderAll() { renderCurrent(); }

  // ---------- archive ----------
  function setupFilters() {
    const decades = [...new Set(state.films.map((f) => decadeOf(f.year)).filter(Boolean))].sort((a, b) => a - b);
    $("#f-decade").insertAdjacentHTML("beforeend", decades.map((d) => `<option value="${d}">${d}s</option>`).join(""));
    const tags = [...state.tagCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    $("#f-tag").insertAdjacentHTML("beforeend", tags.map(([t, n]) => `<option value="${esc(t)}">${esc(t)} (${n})</option>`).join(""));
    const fr = Object.keys(state.franchises).sort((a, b) => a.localeCompare(b));
    $("#f-franchise").insertAdjacentHTML("beforeend", `<option value="__none">— Standalone —</option>` + fr.map((n) => `<option value="${esc(n)}">${esc(n)} (${state.franchises[n].length})</option>`).join(""));

    const rerender = () => { state.shown = PAGE_SIZE; renderArchive(); };
    let timer;
    $("#f-search").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(rerender, 120); });
    for (const id of ["#f-decade", "#f-tag", "#f-franchise", "#f-status", "#f-sort"]) $(id).addEventListener("change", rerender);
    $("#f-reset").addEventListener("click", () => { $("#filters").reset(); rerender(); $("#f-search").focus(); });
    $("#archive-more").addEventListener("click", () => { state.shown += PAGE_SIZE; renderArchive(); });
    $("#archive-list").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-open]");
      if (btn) openDossier(btn.dataset.open);
    });
  }

  function filteredFilms() {
    const q = $("#f-search").value.trim().toLowerCase();
    const decade = $("#f-decade").value;
    const tag = $("#f-tag").value;
    const fr = $("#f-franchise").value;
    const st = $("#f-status").value;
    const sort = $("#f-sort").value;
    const words = q.split(/\s+/).filter(Boolean);
    let list = state.films.filter((f) => {
      if (words.length) {
        const hay = f.title.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      if (decade && String(decadeOf(f.year)) !== decade) return false;
      if (tag && !(f.tags || []).includes(tag)) return false;
      if (fr === "__none" && f.franchise) return false;
      if (fr && fr !== "__none" && f.franchise !== fr) return false;
      if (st) {
        const e = entry(f.id);
        if (st === "none" && e && e.status) return false;
        if (st === "fav" && !(e && e.favorite)) return false;
        if (st !== "none" && st !== "fav" && (!e || e.status !== st)) return false;
      }
      return true;
    });
    const byTitle = (a, b) => sortTitle(a.title).localeCompare(sortTitle(b.title));
    const cmp = {
      title: byTitle,
      year: (a, b) => (a.year || 0) - (b.year || 0) || byTitle(a, b),
      "year-desc": (a, b) => (b.year || 0) - (a.year || 0) || byTitle(a, b),
      rating: (a, b) => (entry(b.id)?.rating || 0) - (entry(a.id)?.rating || 0) || byTitle(a, b),
    }[sort];
    return list.sort(cmp);
  }

  function statusPill(e) {
    return e && e.status ? `<span class="pill s-${e.status}">${STATUSES[e.status]}</span>` : "";
  }

  function filmCard(f) {
    const e = entry(f.id);
    const rating = e && e.rating ? `<span class="pill">${e.rating}/10</span>` : "";
    const tags = (f.tags || []).slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const fr = f.franchise ? `<span class="tag franchise">${esc(f.franchise)}</span>` : "";
    return `<li><button type="button" class="film-card" data-open="${esc(f.id)}">
      ${e && e.favorite ? '<span class="fav" aria-label="Favorite">★</span>' : ""}
      <span class="t">${esc(f.title)}</span>
      <span class="y">${f.year || "????"} ${statusPill(e)} ${rating}</span>
      <span class="badges">${fr}${tags}</span>
    </button></li>`;
  }

  function renderArchive() {
    const list = filteredFilms();
    const shown = list.slice(0, state.shown);
    $("#archive-count").textContent = list.length === state.films.length
      ? `${list.length} records in archive`
      : `${list.length} of ${state.films.length} records match`;
    $("#archive-list").innerHTML = shown.length
      ? shown.map(filmCard).join("")
      : `<li class="empty" style="grid-column:1/-1">NO RECORDS MATCH. ADJUST FILTERS.</li>`;
    const more = $("#archive-more");
    more.hidden = list.length <= state.shown;
    more.textContent = `Load more records (${list.length - shown.length} remaining)`;
  }

  // ---------- dossier ----------
  function setupDossier() {
    const dlg = $("#dossier");
    const rating = $("#d-rating");
    const commit = (patch) => {
      if (!state.current) return;
      const ok = updateEntry(state.current, patch);
      $("#d-saved").textContent = ok ? "Saved to log." : "Not saved: storage unavailable.";
    };

    dlg.addEventListener("change", (e) => {
      if (e.target.name === "status") {
        const patch = { status: e.target.value };
        // Finishing a film with no date stamps today's date.
        if (e.target.value === "completed" && !$("#d-date").value) {
          const today = new Date();
          const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
          $("#d-date").value = iso;
          patch.date = iso;
        }
        commit(patch);
      }
    });
    rating.addEventListener("input", () => {
      const v = Number(rating.value);
      $("#d-rating-out").textContent = v ? `${v}/10` : "—";
      commit({ rating: v });
    });
    $("#d-date").addEventListener("change", (e) => commit({ date: e.target.value }));
    let notesTimer;
    $("#d-notes").addEventListener("input", (e) => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => commit({ notes: e.target.value }), 300);
    });
    $("#d-notes").addEventListener("blur", (e) => { clearTimeout(notesTimer); commit({ notes: e.target.value }); });
    $("#d-fav").addEventListener("click", (e) => {
      const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
      setFavButton(on);
      commit({ favorite: on });
    });
    $("#d-clear").addEventListener("click", () => {
      if (!state.current || !entry(state.current)) return;
      if (!confirm("Purge this film from your log?")) return;
      delete state.log[state.current];
      saveLog();
      fillDossier(state.current);
      $("#d-saved").textContent = "Entry purged.";
    });
    $("#dossier-meta").addEventListener("click", (e) => {
      const b = e.target.closest("[data-open]");
      if (b) { flushNotes(); openDossier(b.dataset.open); }
    });
    const flushNotes = () => {
      clearTimeout(notesTimer);
      if (state.current) {
        const v = $("#d-notes").value;
        if ((entry(state.current)?.notes || "") !== v) updateEntry(state.current, { notes: v });
      }
    };
    dlg.addEventListener("close", () => { flushNotes(); state.current = null; renderCurrent(); });

    // Open dossiers from the ranked lists too.
    for (const id of ["#log-list", "#log-unrated", "#signals-list", "#readouts"]) {
      const root = $(id);
      root.addEventListener("click", (e) => {
        const li = e.target.closest("[data-open]");
        if (li) openDossier(li.dataset.open);
      });
      root.addEventListener("keydown", (e) => {
        const li = e.target.closest("[data-open]");
        if (li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDossier(li.dataset.open); }
      });
    }
  }

  function setFavButton(on) {
    const b = $("#d-fav");
    b.setAttribute("aria-pressed", on);
    b.textContent = on ? "★ Favorite" : "☆ Mark";
  }

  function fillDossier(id) {
    const f = state.byId.get(id);
    const e = entry(id) || {};
    $("#dossier-file").textContent = `Dossier // ${f.id}`;
    $("#dossier-title").textContent = f.title;
    const related = [...new Set([...(f.related_ids || []), ...(f.franchise ? state.franchises[f.franchise] || [] : [])])]
      .filter((r) => r !== id && state.byId.has(r))
      .map((r) => state.byId.get(r))
      .sort((a, b) => (a.year || 0) - (b.year || 0));
    const rows = [
      ["Year", f.year || "Unknown"],
      f.franchise ? ["Franchise", esc(f.franchise)] : null,
      f.director ? ["Director", esc(f.director)] : null,
      f.country ? ["Country", esc(f.country)] : null,
      f.subgenres?.length ? ["Subgenre", esc(f.subgenres.join(", "))] : null,
      ["Tags", (f.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("") || "—"],
      related.length ? ["Linked", related.map((r) => `<button type="button" class="related-link" data-open="${esc(r.id)}">${esc(r.title)}</button> <span class="dim">(${r.year || "?"})</span>`).join("<br>")] : null,
      f.notes ? ["Notes", esc(f.notes)] : null,
      f.wikipedia_url ? ["Source", `<a href="${esc(f.wikipedia_url)}" target="_blank" rel="noopener">Wikipedia ↗</a>`] : null,
    ].filter(Boolean);
    $("#dossier-meta").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");

    for (const r of document.querySelectorAll('#d-status input[name="status"]')) r.checked = r.value === (e.status || "");
    $("#d-rating").value = e.rating || 0;
    $("#d-rating-out").textContent = e.rating ? `${e.rating}/10` : "—";
    $("#d-date").value = e.date || "";
    $("#d-notes").value = e.notes || "";
    setFavButton(!!e.favorite);
    $("#d-saved").textContent = e.updated ? `Last logged ${new Date(e.updated).toLocaleString()}` : "";
  }

  function openDossier(id) {
    if (!state.byId.has(id)) return;
    state.current = id;
    fillDossier(id);
    const dlg = $("#dossier");
    if (!dlg.open) dlg.showModal();
    $("#dossier-form").scrollTop = 0;
  }

  // ---------- my log ----------
  function loggedFilms() {
    return Object.entries(state.log)
      .filter(([id]) => state.byId.has(id))
      .map(([id, e]) => ({ f: state.byId.get(id), e }));
  }

  function rankRow(n, f, mainExtra, scoreHtml) {
    return `<li tabindex="0" data-open="${esc(f.id)}">
      <span class="n">${n}</span>
      <span class="main"><span class="t">${esc(f.title)}</span> <span class="dim">(${f.year || "?"})</span>${mainExtra}</span>
      <span class="score">${scoreHtml}</span>
    </li>`;
  }

  function renderLog() {
    const all = loggedFilms();
    const rated = all.filter(({ e }) => e.rating > 0).sort((a, b) =>
      b.e.rating - a.e.rating ||
      (b.e.favorite ? 1 : 0) - (a.e.favorite ? 1 : 0) ||
      String(b.e.date || "").localeCompare(String(a.e.date || "")) ||
      sortTitle(a.f.title).localeCompare(sortTitle(b.f.title)));

    // Competition ranking: equal ratings share a rank number.
    let rank = 0;
    $("#log-list").innerHTML = rated.length
      ? rated.map(({ f, e }, i) => {
          if (i === 0 || e.rating !== rated[i - 1].e.rating) rank = i + 1;
          const bits = [e.favorite ? "★" : "", statusPill(e), e.date ? `<span class="dim small">${esc(e.date)}</span>` : ""].filter(Boolean).join(" ");
          const notes = e.notes ? `<span class="why">“${esc(e.notes.length > 140 ? e.notes.slice(0, 140) + "…" : e.notes)}”</span>` : "";
          return rankRow(rank, f, `<br>${bits}${notes ? "<br>" + notes : ""}<span class="bar-mini"><i style="width:${e.rating * 10}%"></i></span>`, `${e.rating}<small>/10</small>`);
        }).join("")
      : `<li class="empty" style="display:block;cursor:default">NO RATED FILMS. OPEN A DOSSIER IN THE ARCHIVE AND SET A RATING.</li>`;

    const unrated = all.filter(({ e }) => !(e.rating > 0) && (e.status || e.favorite || e.notes || e.date));
    const groups = ["in_progress", "want", "completed", "dropped", ""].map((s) => ({
      s,
      items: unrated.filter(({ e }) => (e.status || "") === s).sort((a, b) => sortTitle(a.f.title).localeCompare(sortTitle(b.f.title))),
    })).filter((g) => g.items.length);
    $("#log-unrated").innerHTML = groups.map((g) => `
      <h3 class="section-label">${g.s ? STATUSES[g.s] : "Other"} · unrated (${g.items.length})</h3>
      <ul class="rank-list">${g.items.map(({ f, e }) => rankRow(e.favorite ? "★" : "·", f, e.date ? ` <span class="dim small">${esc(e.date)}</span>` : "", "")).join("")}</ul>`).join("");
  }

  // ---------- signals ----------
  // Recommendation model:
  //  1. Each film rated 7+ adds (rating - 6) to every one of its tags, so a 10 counts 4x a 7.
  //  2. Tags are weighted by rarity (inverse document frequency): ln(films / films with tag).
  //     "alien" (158 films) is worth ~1.1; "anthology" (5 films) is worth ~4.6.
  //  3. A candidate's tag score is sum(profile[tag] * idf[tag]) / sqrt(its tag count),
  //     so films aren't rewarded just for carrying lots of tags.
  //  4. Unseen films in a franchise where you rated something 7+ get a boost; full for
  //     sequels (released after the film you rated), half for earlier entries.
  const LIKED_MIN = 7;
  const FRANCHISE_BOOST = 2.5;

  function idf(tag) {
    const n = state.tagCounts.get(tag) || 1;
    return Math.log(state.films.length / n);
  }

  function computeSignals() {
    const profile = new Map();
    const liked = [];
    for (const { f, e } of loggedFilms()) {
      if (!(e.rating >= LIKED_MIN)) continue;
      const w = e.rating - (LIKED_MIN - 1);
      liked.push({ f, w });
      for (const t of f.tags || []) profile.set(t, (profile.get(t) || 0) + w);
    }
    if (!liked.length) return { profile, liked, recs: [] };

    // Average liked weight per franchise, and the earliest year you rated highly in it.
    const fr = new Map();
    for (const { f, w } of liked) {
      if (!f.franchise) continue;
      const cur = fr.get(f.franchise) || { sum: 0, n: 0, firstYear: Infinity, titles: [] };
      cur.sum += w; cur.n++; cur.titles.push(f.title);
      cur.firstYear = Math.min(cur.firstYear, f.year || Infinity);
      fr.set(f.franchise, cur);
    }

    const recs = [];
    for (const f of state.films) {
      const e = entry(f.id);
      if (e && (e.rating > 0 || ["completed", "in_progress", "dropped"].includes(e.status))) continue;
      const tags = f.tags || [];
      const parts = tags
        .filter((t) => profile.has(t))
        .map((t) => ({ t, v: profile.get(t) * idf(t) }))
        .sort((a, b) => b.v - a.v);
      const norm = Math.sqrt(Math.max(tags.length, 1));
      let tagScore = parts.reduce((s, p) => s + p.v, 0) / norm;

      let boost = 0, frWhy = "";
      const info = f.franchise && fr.get(f.franchise);
      if (info) {
        const avg = info.sum / info.n;
        const isSequel = (f.year || 0) > info.firstYear;
        boost = FRANCHISE_BOOST * avg * (isSequel ? 1 : 0.5);
        frWhy = `${isSequel ? "sequel" : "earlier entry"} in ${f.franchise} (you rated ${info.titles.slice(0, 2).join(", ")}${info.titles.length > 2 ? "…" : ""})`;
      }
      const score = tagScore + boost;
      if (score <= 0) continue;
      recs.push({ f, score, parts, frWhy, queued: e?.status === "want" });
    }
    recs.sort((a, b) => b.score - a.score || sortTitle(a.f.title).localeCompare(sortTitle(b.f.title)));
    return { profile, liked, recs };
  }

  function renderSignals() {
    const { profile, liked, recs } = computeSignals();
    if (!liked.length) {
      $("#signals-profile").innerHTML = `<p class="empty">NO SIGNAL. RATE AT LEAST ONE FILM ${LIKED_MIN}/10 OR HIGHER TO CALIBRATE THE RECEIVER.</p>`;
      $("#signals-list").innerHTML = "";
      return;
    }
    const top = [...profile.entries()]
      .map(([t, w]) => ({ t, w, v: w * idf(t) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 12);
    $("#signals-profile").innerHTML = `<div class="profile"><span class="dim small">CALIBRATED ON ${liked.length} FILM${liked.length === 1 ? "" : "S"} · STRONGEST FREQUENCIES:</span>
      ${top.map((p) => `<span class="tag" title="liked weight ${p.w} × rarity ${idf(p.t).toFixed(2)}">${esc(p.t)} <b>${p.v.toFixed(1)}</b></span>`).join("")}</div>`;

    const shown = recs.slice(0, 30);
    const max = shown[0]?.score || 1;
    $("#signals-list").innerHTML = shown.length
      ? shown.map((r, i) => {
          const why = [
            r.frWhy ? `▲ ${esc(r.frWhy)}` : "",
            r.parts.length ? `tags: ${r.parts.slice(0, 4).map((p) => esc(p.t)).join(", ")}` : "",
          ].filter(Boolean).join(" · ");
          const pct = Math.round((r.score / max) * 100);
          return rankRow(i + 1, r.f,
            `${r.queued ? ` <span class="pill s-want">Queued</span>` : ""}<br><span class="why">${why}</span><span class="bar-mini"><i style="width:${pct}%"></i></span>`,
            `${pct}<small>%</small>`);
        }).join("")
      : `<li class="empty" style="display:block;cursor:default">ARCHIVE EXHAUSTED. NOTHING LEFT MATCHES YOUR FREQUENCIES.</li>`;
  }

  // ---------- readouts ----------
  function hbars(rows, { max, fmt = (v) => v, title = () => "" } = {}) {
    const m = max ?? Math.max(...rows.map((r) => r.v), 1);
    return rows.map((r) => `<div class="hbar" title="${esc(title(r))}"${r.id ? ` data-open="${esc(r.id)}" tabindex="0" style="cursor:pointer"` : ""}>
      <span class="lbl">${esc(r.label)}</span>
      <span class="trk"><span class="fill" style="display:block;width:${(r.v / m) * 100}%"></span></span>
      <span class="val">${fmt(r.v)}</span></div>`).join("");
  }

  function avgBy(rated, keysOf) {
    const acc = new Map();
    for (const { f, e } of rated) for (const k of keysOf(f)) {
      const a = acc.get(k) || { sum: 0, n: 0 };
      a.sum += e.rating; a.n++;
      acc.set(k, a);
    }
    return [...acc.entries()].map(([k, a]) => ({ label: k, v: a.sum / a.n, n: a.n }));
  }

  function renderReadouts() {
    const all = loggedFilms();
    const rated = all.filter(({ e }) => e.rating > 0);
    const root = $("#readouts");
    if (!rated.length) {
      root.innerHTML = `<p class="empty">NO TELEMETRY. RATE SOME FILMS TO GENERATE READOUTS.</p>`;
      return;
    }
    const count = (s) => all.filter(({ e }) => e.status === s).length;
    const mean = rated.reduce((s, r) => s + r.e.rating, 0) / rated.length;
    const favs = all.filter(({ e }) => e.favorite).length;
    const stats = [
      ["Logged", all.length],
      ["Rated", rated.length],
      ["Mean rating", mean.toFixed(1)],
      ["Finished", count("completed")],
      ["Queued", count("want")],
      ["Favorites", favs],
      ["Archive seen", `${Math.round((count("completed") / state.films.length) * 100)}%`],
    ];

    // Rating distribution 1..10
    const dist = Array.from({ length: 10 }, (_, i) => rated.filter(({ e }) => e.rating === i + 1).length);
    const dmax = Math.max(...dist, 1);
    const distHtml = `<div class="vbars" role="img" aria-label="Rating distribution: ${dist.map((n, i) => `${i + 1}: ${n}`).join(", ")}">
      ${dist.map((n) => `<div class="col"><span class="c">${n || ""}</span><span class="b${n ? "" : " zero"}" style="height:${(n / dmax) * 100}%"></span></div>`).join("")}
    </div><div class="vlabels">${dist.map((_, i) => `<span>${i + 1}</span>`).join("")}</div>`;

    const byDecade = avgBy(rated, (f) => (f.year ? [`${decadeOf(f.year)}s`] : [])).sort((a, b) => a.label.localeCompare(b.label));
    const byTag = avgBy(rated, (f) => f.tags || []).filter((r) => r.n >= 2).sort((a, b) => b.v - a.v || b.n - a.n).slice(0, 10);
    const statusRows = Object.entries(STATUSES).map(([k, label]) => ({ label, v: count(k) }));

    // Titles watched per month (by logged date), last 12 months that have data.
    const months = new Map();
    for (const { e } of all) if (e.date && /^\d{4}-\d{2}/.test(e.date) && e.status === "completed") {
      const k = e.date.slice(0, 7);
      months.set(k, (months.get(k) || 0) + 1);
    }
    const monthRows = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([label, v]) => ({ label, v }));

    const chart = (title, body) => `<section class="chart"><h3>${title}</h3>${body}</section>`;
    const r1 = (v) => v.toFixed(1);
    root.innerHTML = `
      <div class="stats">${stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>
      <div class="charts">
        ${chart("Rating distribution", distHtml)}
        ${chart("Mean rating by decade", hbars(byDecade, { max: 10, fmt: r1, title: (r) => `${r.n} rated` }))}
        ${chart("Highest-rated tags (2+ films)", byTag.length ? hbars(byTag, { max: 10, fmt: r1, title: (r) => `${r.n} rated` }) : `<p class="dim small">Rate at least two films sharing a tag.</p>`)}
        ${chart("Log status", hbars(statusRows))}
        ${monthRows.length ? chart("Finished per month", hbars(monthRows)) : ""}
      </div>`;
  }

  // ---------- backup ----------
  function setupBackup() {
    const dlg = $("#backup");
    const msg = (text, cls = "") => { const m = $("#backup-msg"); m.textContent = text; m.className = "small " + cls; };
    const summary = () => {
      const n = Object.keys(state.log).length;
      $("#backup-summary").textContent = `${n} entr${n === 1 ? "y" : "ies"} currently in this browser.`;
    };
    $("#backup-btn").addEventListener("click", () => { summary(); msg(""); dlg.showModal(); });

    $("#export-btn").addEventListener("click", () => {
      const payload = {
        app: "dead-signal",
        version: 1,
        exported: new Date().toISOString(),
        count: Object.keys(state.log).length,
        log: state.log,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `dead-signal-log-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      msg(`Exported ${payload.count} entries.`, "ok");
    });

    $("#import-file").addEventListener("change", async (ev) => {
      const file = ev.target.files[0];
      ev.target.value = "";
      if (!file) return;
      let incoming;
      try {
        incoming = parseBackup(JSON.parse(await file.text()));
      } catch (err) {
        msg(`Import failed: ${err.message}`, "err");
        return;
      }
      const ids = Object.keys(incoming);
      const known = ids.filter((id) => state.byId.has(id)).length;
      const merge = $("#import-merge").checked;
      if (!merge && !confirm(`Replace your current log (${Object.keys(state.log).length} entries) with ${ids.length} imported entries?`)) {
        msg("Import cancelled.");
        return;
      }
      if (merge) {
        // Newer edit wins when both sides have the same film.
        for (const [id, e] of Object.entries(incoming)) {
          const cur = state.log[id];
          if (!cur || String(e.updated || "") >= String(cur.updated || "")) state.log[id] = e;
        }
      } else {
        state.log = incoming;
      }
      saveLog();
      summary();
      msg(`Imported ${ids.length} entries${known < ids.length ? ` (${ids.length - known} not in this archive, kept anyway)` : ""}.`, "ok");
      renderCurrent();
    });
  }

  // Accepts this app's export, a bare {id: entry} map, or the dataset format with items[].user.
  function parseBackup(data) {
    if (!data || typeof data !== "object") throw new Error("not a JSON object");
    let raw;
    if (data.log && typeof data.log === "object") raw = data.log;
    else if (Array.isArray(data.items)) {
      raw = {};
      for (const it of data.items) if (it?.id && it.user) {
        raw[it.id] = { status: it.user.status, rating: it.user.rating, date: it.user.date_completed, notes: it.user.review, favorite: it.user.favorite };
      }
    } else raw = data;
    const out = {};
    for (const [id, e] of Object.entries(raw)) {
      if (!e || typeof e !== "object") continue;
      const clean = {
        status: e.status in STATUSES ? e.status : "",
        rating: Math.max(0, Math.min(10, Math.round(Number(e.rating) || 0))),
        date: typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : "",
        notes: typeof e.notes === "string" ? e.notes : "",
        favorite: e.favorite === true,
      };
      if (typeof e.updated === "string") clean.updated = e.updated;
      if (!isEmptyEntry(clean)) out[id] = clean;
    }
    if (!Object.keys(out).length && Object.keys(raw).length) throw new Error("no valid log entries found");
    return out;
  }

  boot();
})();
