/* Shelf Scout — "does the house already have this?"
   Books: scan an ISBN barcode (ZXing, vendored — iOS Safari has no native
   BarcodeDetector) or search by title. Movies: search by title.
   Checks the family collection via familynet's read-only scout endpoints
   (same device token as Waypoint); book metadata for unknowns comes from
   Google Books client-side (CORS-friendly, no key). The wishlist is purely
   local to this device. */

const WISH_KEY = "scout-wishlist";
const SYNC_KEY = "scout-sync";
const MODE_KEY = "scout-mode";

let mode = localStorage.getItem(MODE_KEY) === "movies" ? "movies" : "books";
let wishlist = [];
try { wishlist = JSON.parse(localStorage.getItem(WISH_KEY)) || []; } catch {}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

function loadSync() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch { return {}; }
}
function saveWish() { localStorage.setItem(WISH_KEY, JSON.stringify(wishlist)); }

/* ---------- familynet + metadata lookups ---------- */

async function familynet(path) {
  const { url, token } = loadSync();
  if (!url || !token) return { off: true };
  try {
    const res = await fetch(url.replace(/\/+$/, "") + path,
                            { headers: { "X-Api-Key": token } });
    if (!res.ok) return { err: `intranet said ${res.status}` };
    return { data: await res.json() };
  } catch { return { err: "couldn't reach the intranet" }; }
}

async function googleBooks(params) {
  // no key needed for volume search; fine for a hand-held lookup rate
  try {
    const res = await fetch("https://www.googleapis.com/books/v1/volumes?q=" +
                            encodeURIComponent(params) + "&maxResults=5");
    if (!res.ok) return [];
    const j = await res.json();
    return (j.items || []).map((it) => {
      const v = it.volumeInfo || {};
      return { title: v.title || "", author: (v.authors || []).join(", "),
               year: (v.publishedDate || "").slice(0, 4),
               isbn: ((v.industryIdentifiers || []).find((x) => x.type === "ISBN_13") || {}).identifier || "" };
    }).filter((b) => b.title);
  } catch { return []; }
}

/* ---------- rendering ---------- */

function inWishlist(item) {
  return wishlist.some((w) => w.kind === item.kind &&
    w.title.toLowerCase() === item.title.toLowerCase() &&
    (w.author || w.year || "") === (item.author || item.year || ""));
}

/* Each wishlist item also lands in familynet as the SENDER's to-read
   shelf entry (books) or watchlist row (movies) — attributed by the
   username in settings, retried until it succeeds, and idempotent
   server-side (an existing copy on any shelf, or an existing rating, is
   never touched, so re-sends are harmless). */
async function syncWish(w) {
  const { url, token, person } = loadSync();
  if (!url || !token || !person || w.synced) return;
  const path = w.kind === "movie" ? "/movies/api/scout_add" : "/books/api/scout_add";
  const body = w.kind === "movie"
    ? { person, title: w.title, year: w.year || "" }
    : { person, title: w.title, author: w.author || "", isbn: w.isbn || "" };
  try {
    const res = await fetch(url.replace(/\/+$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": token },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      w.synced = true;
      w.where = j.added === false
        ? (w.kind === "movie" ? (j.status === "rated" ? "already rated" : "already on your watchlist")
                              : `already on your ${j.shelf || ""} shelf`)
        : (w.kind === "movie" ? "on your watchlist" : "on your to-read shelf");
      saveWish(); renderWishlist();
    } else if (res.status === 400) {
      const j = await res.json().catch(() => null);
      if (j && j.error) toast("Sync refused: " + j.error);
    }
  } catch { /* offline — stays queued for the next open */ }
}

async function flushWishlist() {
  for (const w of wishlist) if (!w.synced) await syncWish(w);
}

function wishBtn(item) {
  const dis = inWishlist(item);
  return `<div class="cardrow"><button class="wishbtn" ${dis ? "disabled" : ""}
    data-wish='${esc(JSON.stringify(item))}'>${dis ? "On the wishlist" : "＋ Wishlist"}</button></div>`;
}

function readerChips(rows, kind) {
  return `<div class="readers">` + rows.map((r) => {
    const rating = r.rating != null ? ` · ${r.rating}/10` : "";
    const when = kind === "book"
      ? (r.date_read ? ` · ${esc(String(r.date_read).slice(0, 4))}` : (r.shelf && r.shelf !== "read" ? ` · ${esc(r.shelf)}` : ""))
      : (r.watched_on ? ` · ${esc(String(r.watched_on).slice(0, 4))}` : "");
    return `<span class="reader"><b>${esc(r.username)}</b>${rating}${when}</span>`;
  }).join("") + `</div>`;
}

function card(cls, title, sub, verdictHtml, chipsHtml, item) {
  return `<div class="card ${cls}">
    <div class="title">${esc(title)}</div>
    ${sub ? `<div class="sub">${esc(sub)}</div>` : ""}
    ${verdictHtml}${chipsHtml}
    ${item ? wishBtn(item) : ""}
  </div>`;
}

function setResults(html) {
  $("results").innerHTML = html;
  for (const b of $("results").querySelectorAll(".wishbtn[data-wish]")) {
    b.addEventListener("click", () => {
      const item = JSON.parse(b.getAttribute("data-wish"));
      wishlist.unshift(item);
      saveWish(); renderWishlist();
      b.disabled = true; b.textContent = "On the wishlist";
      toast("Saved to wishlist");
      syncWish(item);
    });
  }
}

function status(msg, err) {
  setResults(`<div class="status ${err ? "err" : ""}">${esc(msg)}</div>`);
}

/* ---------- book flows ---------- */

async function lookupIsbn(isbn) {
  status("Checking the shelves…");
  const [fam, gb] = await Promise.all([
    familynet(`/books/api/scout?isbn=${encodeURIComponent(isbn)}`),
    googleBooks(`isbn:${isbn}`),
  ]);
  const logs = fam.data?.logs || [];
  const meta = fam.data?.meta || gb[0] || null;
  const title = logs[0]?.title || meta?.title || `ISBN ${isbn}`;
  const author = logs[0]?.author || meta?.author || "";
  const item = { kind: "book", title, author, isbn };
  let html = "";
  if (logs.length) {
    html = card("owned", title, author,
      `<div class="verdict own">Already on the family shelf</div>`,
      readerChips(logs, "book"), item);
  } else {
    const why = fam.off ? "collection check is off — set the intranet in ⚙︎"
      : fam.err ? `couldn't check the collection (${fam.err})`
      : "nobody in the family has it";
    html = card("unowned", title, author,
      `<div class="verdict not">Not on the shelf — ${esc(why)}</div>`, "", item);
  }
  setResults(html);
}

async function searchBooks(q) {
  status("Searching…");
  const [fam, gb] = await Promise.all([
    familynet(`/books/api/scout?q=${encodeURIComponent(q)}`),
    googleBooks(q),
  ]);
  const logs = fam.data?.logs || [];
  // group family logs per (title, author)
  const groups = new Map();
  for (const l of logs) {
    const k = `${l.title.toLowerCase()}|${(l.author || "").toLowerCase()}`;
    if (!groups.has(k)) groups.set(k, { title: l.title, author: l.author || "", rows: [] });
    groups.get(k).rows.push(l);
  }
  let html = "";
  for (const g of groups.values()) {
    html += card("owned", g.title, g.author,
      `<div class="verdict own">On the family shelf</div>`,
      readerChips(g.rows, "book"),
      { kind: "book", title: g.title, author: g.author });
  }
  const ownedTitles = new Set([...groups.values()].map((g) => g.title.toLowerCase()));
  for (const b of gb.filter((x) => !ownedTitles.has(x.title.toLowerCase()))) {
    const sub = [b.author, b.year].filter(Boolean).join(" · ");
    html += card("unowned", b.title, sub,
      `<div class="verdict not">Not on the shelf</div>`, "",
      { kind: "book", title: b.title, author: b.author, isbn: b.isbn });
  }
  if (!html) {
    if (fam.off || fam.err) status(fam.err || "Collection check is off — set the intranet in ⚙︎", !!fam.err);
    else status("Nothing found for that.");
    return;
  }
  setResults(html);
}

/* ---------- movie flow ---------- */

async function searchMovies(q) {
  status("Checking the collection…");
  const fam = await familynet(`/movies/api/scout?q=${encodeURIComponent(q)}`);
  if (fam.off) { status("Movie lookups need the intranet — set it up in ⚙︎"); return; }
  if (fam.err) { status(fam.err, true); return; }
  let html = "";
  for (const m of fam.data.movies || []) {
    const rated = m.ratings.filter((r) => r.rating != null);
    const watchlist = rated.length === 0;
    html += card("owned", m.title, m.year,
      `<div class="verdict own">${watchlist ? "On the family watchlist" : "Already rated in the collection"}</div>`,
      readerChips(rated.length ? rated : m.ratings, "movie"),
      { kind: "movie", title: m.title, year: m.year });
  }
  for (const h of fam.data.outside || []) {
    html += card("unowned", h.title, h.year,
      `<div class="verdict not">Not in the collection</div>`, "",
      { kind: "movie", title: h.title, year: h.year });
  }
  setResults(html || `<div class="status">Nothing found for that.</div>`);
}

/* ---------- barcode scanner ---------- */

let reader = null;
function openScanner() {
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13]);
  reader = new ZXing.BrowserMultiFormatReader(hints);
  $("scan-overlay").classList.remove("hidden");
  reader.decodeFromVideoDevice(null, "scan-video", (result) => {
    if (!result) return;                       // per-frame miss — keep going
    const code = result.getText();
    if (!/^97[89]\d{10}$/.test(code)) return;  // an ISBN starts 978/979; the
                                               // price add-on and store codes don't
    closeScanner();
    lookupIsbn(code);
  }).catch((e) => {
    closeScanner();
    toast(String(e).includes("Permission") || String(e).includes("NotAllowed")
      ? "Camera permission was denied" : "Couldn't start the camera");
  });
}
function closeScanner() {
  if (reader) { try { reader.reset(); } catch {} reader = null; }
  $("scan-overlay").classList.add("hidden");
}

/* ---------- wishlist ---------- */

function renderWishlist() {
  const el = $("wishlist");
  $("wish-count").textContent = wishlist.length ? `(${wishlist.length})` : "";
  $("wish-empty").style.display = wishlist.length ? "none" : "";
  const { url, token, person } = loadSync();
  const canSync = url && token && person;
  el.innerHTML = wishlist.map((w, i) => {
    const sub = w.author || w.year || w.sub || "";
    const state = w.synced ? `✓ ${w.where || "sent to familynet"}`
      : canSync ? "queued for familynet"
      : "";
    return `<div class="wishrow">
      <span class="kind">${w.kind === "movie" ? "🎬" : "📖"}</span>
      <div class="w-main">
        <div class="w-t">${esc(w.title)}</div>
        <div class="w-s">${esc(sub)}${sub && state ? " · " : ""}${esc(state)}</div>
      </div>
      <button class="del" data-i="${i}" aria-label="Remove">✕</button>
    </div>`;
  }).join("");
  for (const b of el.querySelectorAll(".del")) {
    b.addEventListener("click", () => {
      wishlist.splice(Number(b.getAttribute("data-i")), 1);
      saveWish(); renderWishlist();
    });
  }
}

/* ---------- mode + wiring ---------- */

function setMode(m) {
  mode = m;
  localStorage.setItem(MODE_KEY, m);
  $("mode-books").classList.toggle("on", m === "books");
  $("mode-movies").classList.toggle("on", m === "movies");
  $("scan-btn").style.display = m === "books" ? "" : "none";
  $("search-q").placeholder = m === "books" ? "…or search by title" : "Search a movie title";
  $("results").innerHTML = "";
}

function init() {
  $("mode-books").addEventListener("click", () => setMode("books"));
  $("mode-movies").addEventListener("click", () => setMode("movies"));
  $("scan-btn").addEventListener("click", openScanner);
  $("scan-cancel").addEventListener("click", closeScanner);
  $("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("search-q").value.trim();
    if (!q) return;
    const digits = q.replace(/[-\s]/g, "");
    if (mode === "books" && /^97[89]\d{10}$/.test(digits)) lookupIsbn(digits);
    else if (mode === "books") searchBooks(q);
    else searchMovies(q);
  });

  $("settings-btn").addEventListener("click", () => {
    const s = loadSync();
    $("set-url").value = s.url || "";
    $("set-token").value = s.token || "";
    $("set-person").value = s.person || "";
    $("settings-overlay").classList.remove("hidden");
  });
  $("set-token-show").addEventListener("click", () => {
    const f = $("set-token");
    const showing = f.type === "text";
    f.type = showing ? "password" : "text";
    $("set-token-show").textContent = showing ? "Show" : "Hide";
  });
  $("settings-cancel").addEventListener("click",
    () => $("settings-overlay").classList.add("hidden"));
  $("settings-save").addEventListener("click", () => {
    localStorage.setItem(SYNC_KEY, JSON.stringify(
      { url: $("set-url").value.trim(), token: $("set-token").value.trim(),
        person: $("set-person").value.trim().toLowerCase() }));
    $("settings-overlay").classList.add("hidden");
    toast("Saved");
    renderWishlist();
    flushWishlist();
  });

  setMode(mode);
  renderWishlist();
  flushWishlist();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
