/* =========================================================
   Team hub – organisers only
   ---------------------------------------------------------
   Five tabs:
     Dashboard  registrations, payments, photos waiting, news,
                next meeting and actions – live from Firebase
     Meetings   next and past meetings: time, link, agenda, notes
     Actions    shared action tracker: owner, due date, done
     Documents  links to all the plans, grouped by section
     Tools      post news, approve photos, preview the visitor app…

   Firebase collections (organisers only – the security rules are
   kept with the visitor app: silage-day-visitor/firebase/firestore.rules):
     meetings/{id}  title, start, end, link, agendaUrl, guests, notes
     actions/{id}   text, owner, due, done, createdBy, createdAt, updatedAt
     teamDocs/{id}  title, note, url, section, access, order
     config/facts   the key facts the visitor app shows – edited on facts.html
   It also READS the visitor app's registrations, checkins,
   pending (photos) and news for the dashboard.

   The document links and meetings are typed in through the app
   (or imported once – see "Import" on the Documents tab), so no
   private links are kept in this public code.
   ========================================================= */

const $ = (id) => document.getElementById(id);
const hub = $("hub");
const nav = $("team-nav");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// The show date – from the key facts (config/facts, A1); this is the fallback
let showDayIso = "2027-09-11";
const showDay = () => { const p = showDayIso.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const SECTIONS = ["Running the event", "Site and safety", "Exhibitors and traders", "Sponsors, marketing and money", "Event app", "Other"];
const ACCESS = { open: ["Open", "opens straight from the link"], sign: ["Sign in", "needs a free Claude account"], invite: ["Invite only", "organisers invited by the owner"] };

let fb, user;
let meetings = [], actions = [], docs = [];
let tab = (location.hash || "#dashboard").slice(1);
let stops = [];
let actionFilter = "open";

function msg(text) { const m = $("msg"); if (m) { m.hidden = !text; m.textContent = text || ""; } }
const tsMs = (v) => v && v.toMillis ? v.toMillis() : null;
const fmtDate = (ms, opts) => new Date(ms).toLocaleString("en-GB", opts || { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDay = (ms) => new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const toInput = (ms, withTime) => { if (!ms) return ""; const d = new Date(ms); const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString(); return withTime ? iso.slice(0, 16) : iso.slice(0, 10); };


/* ---------- Signing in ---------- */
async function start() {
  if (!firebaseConfigured()) { msg("Firebase isn't set up yet (js/firebase-config.js)."); $("signin").disabled = true; return; }
  fb = await getFirebase();
  const { A, auth } = fb;
  $("signin").onclick = () => A.signInWithPopup(auth, new A.GoogleAuthProvider())
    .catch((e) => msg(e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment"
      ? "Sign-in couldn't open here. Try opening the Team hub in Safari or Chrome instead of from the Home Screen."
      : "Sign-in didn't work: " + e.message));
  $("signout").onclick = signOut;
  A.onAuthStateChanged(auth, async (u) => {
    stops.forEach((s) => s()); stops = [];
    user = u && !u.isAnonymous ? u : null;
    $("signout").hidden = !user;
    $("who-short").textContent = user ? user.email : "Organisers only";
    if (!user) { nav.hidden = true; return showSignIn(); }
    try {
      // Check this account is on the organisers' list before showing anything
      await fb.F.getDocs(fb.F.query(fb.F.collection(fb.db, "meetings"), fb.F.limit(1)));
    } catch (e) {
      nav.hidden = true;
      return showSignIn("This Google account (" + user.email + ") isn't on the organisers' list. Ask for it to be added to firebase/firestore.rules, or sign out and use another account.");
    }
    nav.hidden = false;
    listen();
    show();
  });
}

function showSignIn(text) {
  hub.innerHTML = '<section class="card" id="signin-card"><h1 class="page-title">Team hub</h1>' +
    '<p>For the Pembrokeshire Silage Day organising team. Sign in with your organiser Google account.</p>' +
    (user ? '' : '<button type="button" class="btn" id="signin">Sign in with Google</button>') +
    '<p class="map-message" id="msg" hidden></p></section>';
  if (!user) $("signin").onclick = () => fb.A.signInWithPopup(fb.auth, new fb.A.GoogleAuthProvider()).catch((e) => msg("Sign-in didn't work: " + e.message));
  if (text) msg(text);
}

async function signOut() {
  await fb.A.signOut(fb.auth);
  // Remove the saved copy of team data from this device (for shared phones/computers)
  try { await fb.F.terminate(fb.db); await fb.F.clearIndexedDbPersistence(fb.db); } catch (e) {}
  location.reload();
}


/* ---------- Live data ---------- */
function listen() {
  const { F, db } = fb;
  stops.push(F.onSnapshot(F.query(F.collection(db, "meetings"), F.orderBy("start", "desc"), F.limit(60)), (s) => {
    meetings = s.docs.map((d) => ({ id: d.id, ...d.data() })); if (["dashboard", "meetings"].includes(tab)) show();
  }));
  stops.push(F.onSnapshot(F.query(F.collection(db, "actions"), F.orderBy("createdAt", "desc"), F.limit(300)), (s) => {
    actions = s.docs.map((d) => ({ id: d.id, ...d.data() })); if (["dashboard", "actions"].includes(tab)) show();
  }));
  stops.push(F.onSnapshot(F.query(F.collection(db, "teamDocs"), F.orderBy("order", "asc"), F.limit(300)), (s) => {
    docs = s.docs.map((d) => ({ id: d.id, ...d.data() })); if (tab === "docs") show();
  }));
}

window.addEventListener("hashchange", () => { tab = (location.hash || "#dashboard").slice(1); show(); window.scrollTo(0, 0); });

function show() {
  if (!user) return;
  if (!["dashboard", "meetings", "actions", "docs", "tools"].includes(tab)) tab = "dashboard";
  nav.querySelectorAll("a").forEach((a) => { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  ({ dashboard: showDashboard, meetings: showMeetings, actions: showActions, docs: showDocs, tools: showTools })[tab]();
}

function nextMeeting() {
  const now = Date.now() - 2 * 3600e3; // still "next" until 2 hours after it starts
  return meetings.filter((m) => tsMs(m.start) >= now).sort((a, b) => tsMs(a.start) - tsMs(b.start))[0];
}
function openActions() { return actions.filter((a) => !a.done); }
function isOverdue(a) { return !a.done && a.due && tsMs(a.due) < new Date().setHours(0, 0, 0, 0); }


/* ---------- Dashboard ---------- */
let stats = null, statsAt = 0, statsLoading = false;
async function loadStats() {
  if (statsLoading) return;
  statsLoading = true;
  const { F, db } = fb;
  const s = { groups: 0, people: 0, adult: 0, child: 0, under5: 0, week: 0, paid: 0, photos: 0, newsLive: 0, newsScheduled: 0, latest: null, errors: [],
    prices: null, expected: 0, taken: 0 };
  const types = {}; // "CODE|n" → ticket type, to price what's been paid
  try {
    // Prices are key facts now (config/facts, G5); config/prices is the old place
    const fa = await F.getDoc(F.doc(db, "config", "facts"));
    if (fa.exists()) { const f = fa.data(); s.prices = { adult: f.adult, child: f.child, show: !!f.showPrices }; if (f.date) showDayIso = f.date; }
    else { const pr = await F.getDoc(F.doc(db, "config", "prices")); if (pr.exists()) s.prices = pr.data(); }
  } catch (e) { s.errors.push("prices"); }
  const priceOf = (type) => !s.prices ? 0 : type === "adult" ? Number(s.prices.adult) || 0 : type === "child" ? Number(s.prices.child) || 0 : 0;
  const weekAgo = Date.now() - 7 * 864e5;
  try {
    const regs = await F.getDocs(F.collection(db, "registrations"));
    regs.forEach((d) => {
      const r = d.data(); s.groups++;
      (r.members || []).forEach((m) => { s.people++; if (s[m.type] !== undefined) s[m.type]++; types[d.id + "|" + m.n] = m.type; s.expected += priceOf(m.type); });
      if (tsMs(r.createdAt) > weekAgo) s.week++;
    });
  } catch (e) { s.errors.push("registrations"); }
  try {
    const ch = await F.getDocs(F.collection(db, "checkins"));
    ch.forEach((d) => { (d.data().paid || []).forEach((n) => { s.paid++; s.taken += priceOf(types[d.id + "|" + n]); }); });
  } catch (e) { s.errors.push("payments"); }
  try {
    const c = await F.getCountFromServer(F.collection(db, "pending"));
    s.photos = c.data().count;
  } catch (e) { s.errors.push("photos"); }
  try {
    const n = await F.getDocs(F.query(F.collection(db, "news"), F.orderBy("publishAt", "desc"), F.limit(50)));
    const now = Date.now();
    n.forEach((d) => {
      const p = d.data(), pub = tsMs(p.publishAt), hide = tsMs(p.hideAt);
      if (pub > now) s.newsScheduled++;
      else if (!hide || hide > now) { s.newsLive++; if (!s.latest) s.latest = p.titleEn || p.titleCy; }
    });
  } catch (e) { s.errors.push("news"); }
  stats = s; statsAt = Date.now(); statsLoading = false;
  if (tab === "dashboard") showDashboard();
}

function showDashboard() {
  if (!stats || Date.now() - statsAt > 60000) loadStats(); // figures refresh at most once a minute
  const s = stats;
  const days = Math.max(0, Math.ceil((showDay() - new Date().setHours(0, 0, 0, 0)) / 864e5));
  const m = nextMeeting();
  const open = openActions(), overdue = open.filter(isOverdue);
  const tile = (num, label, link, warn) => '<a class="dash-tile' + (warn ? " warn" : "") + '" href="' + link + '"><b>' + num + '</b><span>' + label + '</span></a>';
  hub.innerHTML =
    '<h1 class="page-title">Dashboard</h1>' +
    '<div class="countdown"><b>' + days + '</b><div>days to go until<br><strong>' + showDay().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + '</strong></div></div>' +
    '<section class="card"><h2>🎟️ Tickets</h2>' + (s ?
      '<div class="dash-grid">' + tile(s.groups, "groups registered", "#dashboard") + tile(s.people, "people", "#dashboard") +
        tile(s.week, "new groups this week", "#dashboard") + tile(s.paid, "paid at the gate", "#dashboard") + '</div>' +
      (s.prices ? '<p class="money-line">💷 <b>' + money(s.expected) + '</b> expected at the gate if everyone comes · <b>' + money(s.taken) + '</b> taken so far' +
        (s.prices.show ? '' : ' <span class="muted">(using the proposed prices – not yet shown to visitors)</span>') + '</p>'
        : '<p class="muted">Set ticket prices in <a href="facts.html">Key facts</a> to see expected takings.</p>') +
      '<p class="muted">' + s.adult + (s.adult === 1 ? ' adult' : ' adults') + ' · ' + s.child + (s.child === 1 ? ' child' : ' children') + ' · ' + s.under5 + ' under-5' + (s.under5 === 1 ? '' : 's') + '</p>'
      : '<p class="muted">Loading…</p>') + '</section>' +
    '<section class="card"><h2>🗓️ Next meeting</h2>' + (m ? meetingSummary(m) : '<p class="muted">None booked. <a href="#meetings">Add one</a>.</p>') + '</section>' +
    '<section class="card"><h2>✅ Actions</h2><div class="dash-grid">' +
      tile(open.length, "open actions", "#actions") + tile(overdue.length, "overdue", "#actions", overdue.length > 0) +
      tile(open.filter((a) => (a.owner || "").toLowerCase() === (user.displayName || "").toLowerCase() || (a.owner || "").toLowerCase() === user.email.toLowerCase()).length, "yours", "#actions") +
    '</div></section>' +
    '<section class="card"><h2>📷 Photos and 📣 news</h2>' + (s ?
      '<div class="dash-grid">' + tile(s.photos, "photos waiting", "photos.html", s.photos > 0) +
        tile(s.newsLive, "news posts live", "news.html") + tile(s.newsScheduled, "scheduled", "news.html") + '</div>' +
      (s.latest ? '<p class="muted">Latest: ' + esc(s.latest) + '</p>' : '')
      : '<p class="muted">Loading…</p>') + '</section>' +
    (s && s.errors.length ? '<p class="form-error">Couldn\'t load: ' + s.errors.join(", ") + '. Check the security rules include the team hub section.</p>' : '') +
    '<div class="pad-x"><button type="button" class="btn alt" id="refresh">↻ Refresh figures</button></div>';
  $("refresh").onclick = () => { stats = null; statsAt = 0; showDashboard(); };
}

// "meet.google.com/abc" → "https://meet.google.com/abc" (people rarely type the https://)
function fixLink(v) {
  v = (v || "").trim();
  if (!v) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : "https://" + v.replace(/^\/+/, "");
}

/* ---------- Add to Google Calendar ----------
   Opens Google Calendar (in the signed-in organiser account) with the
   meeting filled in. There, click "Add Google Meet video conferencing"
   and Save – then paste the Meet link back into the hub with Edit. */
function calendarLink(m) {
  const g = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = tsMs(m.start), end = tsMs(m.end) || start + 90 * 60000;
  const details = [
    m.agendaUrl ? "Agenda and papers: " + m.agendaUrl : "",
    "Team hub: " + location.origin + location.pathname + "#meetings",
    m.notes || ""
  ].filter(Boolean).join("\n\n");
  const q = new URLSearchParams({ action: "TEMPLATE", text: m.title || "Organising meeting", dates: g(start) + "/" + g(end), details: details });
  if (m.link) q.set("location", m.link);
  if (m.guests) q.set("add", m.guests.split(/[\s,;]+/).filter(Boolean).join(","));
  if (user && user.email) q.set("authuser", user.email); // open in the organiser account, not someone's personal one
  return "https://calendar.google.com/calendar/render?" + q.toString();
}
function calendarButton(m) {
  return '<a class="btn alt" href="' + esc(calendarLink(m)) + '" target="_blank" rel="noopener">📅 Add to Google Calendar</a>';
}

function money(n) { return "£" + (Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toFixed(2)); }

function meetingSummary(m) {
  return '<p class="meet-when"><b>' + esc(m.title || "Organising meeting") + '</b><br>' + fmtDate(tsMs(m.start)) +
    (m.end ? '–' + new Date(tsMs(m.end)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : '') + '</p>' +
    '<div class="meet-links">' +
      (m.link ? '<a class="btn" href="' + esc(m.link) + '" target="_blank" rel="noopener">Join meeting</a>' : '<span class="muted">No meeting link yet.</span>') +
      (m.agendaUrl ? '<a class="btn alt" href="' + esc(m.agendaUrl) + '" target="_blank" rel="noopener">Agenda and papers</a>' : '') +
      calendarButton(m) +
    '</div>' +
    (m.link ? '' : '<p class="muted cal-tip">To set up a Google Meet: tap <b>Add to Google Calendar</b>, click <b>Add Google Meet video conferencing</b>, then <b>Save</b>. Copy the Meet link back here with <b>Edit</b>.</p>');
}


/* ---------- Meetings ---------- */
let editingMeeting = null;
function showMeetings() {
  const next = nextMeeting();
  const upcoming = meetings.filter((m) => tsMs(m.start) >= Date.now() - 2 * 3600e3).sort((a, b) => tsMs(a.start) - tsMs(b.start));
  const past = meetings.filter((m) => tsMs(m.start) < Date.now() - 2 * 3600e3);
  hub.innerHTML = '<h1 class="page-title">Meetings</h1>' +
    (next ? '<section class="card next-meeting"><h2>Next meeting</h2>' + meetingSummary(next) + '</section>' : '') +
    '<div class="pad-x"><button type="button" class="btn" id="add-meeting">＋ Add a meeting</button></div>' +
    '<div id="meeting-form"></div>' +
    (upcoming.length > 1 ? '<h2 class="admin-h">Coming up</h2>' + upcoming.slice(1).map(meetingCard).join("") : '') +
    (past.length ? '<h2 class="admin-h">Past meetings</h2>' + past.map(meetingCard).join("") : '');
  $("add-meeting").onclick = () => meetingForm(null);
  hub.querySelectorAll("[data-edit-meeting]").forEach((b) => b.onclick = () => meetingForm(meetings.find((m) => m.id === b.dataset.editMeeting)));
  if (next) { const b = document.createElement("button"); b.type = "button"; b.className = "btn alt small"; b.textContent = "Edit"; b.onclick = () => meetingForm(next); hub.querySelector(".next-meeting").appendChild(b); }
}
function meetingCard(m) {
  return '<section class="card"><p class="meet-when"><b>' + esc(m.title || "Organising meeting") + '</b> · ' + fmtDate(tsMs(m.start)) + '</p>' +
    (m.agendaUrl ? '<p><a href="' + esc(m.agendaUrl) + '" target="_blank" rel="noopener">Agenda and papers</a></p>' : '') +
    (m.notes ? '<div class="meet-notes">' + esc(m.notes).replace(/\n/g, "<br>") + '</div>' : '') +
    '<div class="meet-card-btns">' + (tsMs(m.start) > Date.now() ? calendarButton(m).replace('class="btn alt"', 'class="btn alt small"') : '') +
    '<button type="button" class="btn alt small" data-edit-meeting="' + m.id + '">Edit</button></div></section>';
}
function meetingForm(m) {
  editingMeeting = m;
  $("meeting-form").innerHTML = '<form class="card form-card" id="mf"><h2>' + (m ? "Edit meeting" : "New meeting") + '</h2>' +
    '<label class="field" for="m-title">Title</label><input class="input" id="m-title" maxlength="120" value="' + esc(m ? m.title : "Organising meeting") + '">' +
    '<label class="field" for="m-start">Starts</label><input class="input" id="m-start" type="datetime-local" required value="' + toInput(m && tsMs(m.start), true) + '">' +
    '<label class="field" for="m-end">Ends</label><input class="input" id="m-end" type="datetime-local" value="' + toInput(m && tsMs(m.end), true) + '">' +
    '<label class="field" for="m-link">Meeting link (Zoom, Teams, Meet…)</label><input class="input" id="m-link" type="text" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="meet.google.com/abc-defg-hij" value="' + esc(m ? m.link : "") + '">' +
    '<label class="field" for="m-agenda">Agenda and papers link</label><input class="input" id="m-agenda" type="text" inputmode="url" autocapitalize="off" spellcheck="false" value="' + esc(m ? m.agendaUrl : "") + '">' +
    '<label class="field" for="m-guests">Who to invite (email addresses)</label>' +
    '<p class="field-hint">Separated by commas. Used by "Add to Google Calendar" to send the invites.</p>' +
    '<input class="input" id="m-guests" type="text" inputmode="email" autocapitalize="off" spellcheck="false" maxlength="1000" value="' + esc(m ? m.guests : "") + '">' +
    '<label class="field" for="m-notes">Notes and decisions</label><textarea class="input" id="m-notes" rows="5" maxlength="10000">' + esc(m ? m.notes : "") + '</textarea>' +
    '<p class="form-error" id="mf-err" hidden></p>' +
    '<button type="submit" class="btn">Save</button>' +
    (m ? '<button type="button" class="btn alt" id="mf-del">Delete meeting</button>' : '') +
    '<button type="button" class="btn alt" id="mf-cancel">Cancel</button></form>';
  $("mf").scrollIntoView({ behavior: "smooth" });
  $("mf-cancel").onclick = () => { $("meeting-form").innerHTML = ""; };
  if (m) $("mf-del").onclick = async () => { if (confirm("Delete this meeting?")) { await fb.F.deleteDoc(fb.F.doc(fb.db, "meetings", m.id)); } };
  $("mf").onsubmit = async (e) => {
    e.preventDefault();
    const { F, db } = fb;
    const start = $("m-start").value, end = $("m-end").value;
    if (!start) { $("mf-err").textContent = "Please set when it starts."; $("mf-err").hidden = false; return; }
    const data = {
      title: $("m-title").value.trim(), start: F.Timestamp.fromDate(new Date(start)),
      end: end ? F.Timestamp.fromDate(new Date(end)) : null,
      link: fixLink($("m-link").value), agendaUrl: fixLink($("m-agenda").value), notes: $("m-notes").value.trim(),
      guests: $("m-guests").value.trim(),
      updatedAt: F.serverTimestamp()
    };
    try {
      if (editingMeeting) await F.updateDoc(F.doc(db, "meetings", editingMeeting.id), data);
      else await F.addDoc(F.collection(db, "meetings"), Object.assign(data, { createdAt: F.serverTimestamp() }));
    } catch (err) { $("mf-err").textContent = "That didn't save: " + err.message; $("mf-err").hidden = false; }
  };
}


/* ---------- Actions ---------- */
function showActions() {
  // Keep anything half-typed in the "New action" form when the list updates
  const keep = ["a-text", "a-owner", "a-due"].map((id) => $(id) ? $(id).value : "");
  const list = actions
    .filter((a) => actionFilter === "all" || (actionFilter === "open" ? !a.done : actionFilter === "mine" ? !a.done && mine(a) : a.done))
    .sort((a, b) => (a.done - b.done) || ((tsMs(a.due) || 9e15) - (tsMs(b.due) || 9e15)));
  const f = (k, label) => '<button type="button" class="chip' + (actionFilter === k ? " on" : "") + '" data-filter="' + k + '">' + label + '</button>';
  hub.innerHTML = '<h1 class="page-title">Actions</h1>' +
    '<form class="card form-card add-action" id="af"><label class="field" for="a-text">New action</label>' +
      '<input class="input" id="a-text" maxlength="300" placeholder="What needs doing?" required>' +
      '<div class="action-row"><div><label class="field" for="a-owner">Owner</label><input class="input" id="a-owner" maxlength="60" list="owners"></div>' +
      '<div><label class="field" for="a-due">Due</label><input class="input" id="a-due" type="date"></div></div>' +
      '<datalist id="owners">' + [...new Set(actions.map((a) => a.owner).filter(Boolean))].map((o) => '<option value="' + esc(o) + '">').join("") + '</datalist>' +
      '<button type="submit" class="btn">Add action</button></form>' +
    '<div class="chips" role="group" aria-label="Show">' + f("open", "Open") + f("mine", "Mine") + f("done", "Done") + f("all", "All") + '</div>' +
    (list.length ? '<ul class="action-list">' + list.map(actionItem).join("") + '</ul>' : '<p class="pad-x muted">Nothing here.</p>');
  ["a-text", "a-owner", "a-due"].forEach((id, i) => { $(id).value = keep[i]; });
  hub.querySelectorAll("[data-filter]").forEach((b) => b.onclick = () => { actionFilter = b.dataset.filter; showActions(); });
  hub.querySelectorAll("[data-done]").forEach((c) => c.onchange = () => fb.F.updateDoc(fb.F.doc(fb.db, "actions", c.dataset.done), { done: c.checked, updatedAt: fb.F.serverTimestamp() }));
  hub.querySelectorAll("[data-del-action]").forEach((b) => b.onclick = () => { if (confirm("Delete this action?")) fb.F.deleteDoc(fb.F.doc(fb.db, "actions", b.dataset.delAction)); });
  $("af").onsubmit = async (e) => {
    e.preventDefault();
    const { F, db } = fb;
    const due = $("a-due").value;
    const form = e.target;
    await F.addDoc(F.collection(db, "actions"), {
      text: $("a-text").value.trim(), owner: $("a-owner").value.trim(),
      due: due ? F.Timestamp.fromDate(new Date(due + "T12:00")) : null, done: false,
      createdBy: user.email, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp()
    });
    ["a-text", "a-owner", "a-due"].forEach((id) => { if ($(id)) $(id).value = ""; });
    if ($("a-text")) $("a-text").focus();
  };
}
function mine(a) {
  const o = (a.owner || "").toLowerCase();
  return o && (o === (user.displayName || "").toLowerCase() || o === user.email.toLowerCase() || (user.displayName || "").toLowerCase().split(" ")[0] === o);
}
function actionItem(a) {
  const due = tsMs(a.due);
  return '<li class="action' + (a.done ? " done" : "") + (isOverdue(a) ? " overdue" : "") + '">' +
    '<input type="checkbox" id="ac-' + a.id + '" data-done="' + a.id + '"' + (a.done ? " checked" : "") + '>' +
    '<label for="ac-' + a.id + '"><span class="action-text">' + esc(a.text) + '</span>' +
    '<span class="action-meta">' + (a.owner ? esc(a.owner) : "No owner") + (due ? ' · due ' + fmtDay(due) + (isOverdue(a) ? ' – overdue' : '') : '') + '</span></label>' +
    '<button type="button" class="icon-btn" data-del-action="' + a.id + '" aria-label="Delete action">✕</button></li>';
}


/* ---------- Documents ---------- */
let editingDocs = false;
function showDocs() {
  const bySection = {};
  docs.forEach((d) => (bySection[d.section] ||= []).push(d));
  const order = SECTIONS.concat(Object.keys(bySection).filter((s) => !SECTIONS.includes(s)));
  hub.innerHTML = '<h1 class="page-title">Documents</h1>' +
    '<p class="key">' + Object.entries(ACCESS).map(([k, v]) => '<span><span class="badge ' + k + '">' + v[0] + '</span> ' + v[1] + '</span>').join(" ") + '</p>' +
    (docs.length ? order.filter((s) => bySection[s]).map((s) =>
      '<h2 class="admin-h">' + esc(s) + '</h2><ul class="doc-list">' + bySection[s].map(docItem).join("") + '</ul>').join("")
      : '<section class="card"><p>No documents yet. Use <b>Import</b> below to bring in the list from the old Team hub, or add them one by one.</p></section>') +
    '<div class="pad-x doc-actions"><button type="button" class="btn alt" id="toggle-edit">' + (editingDocs ? "Done editing" : "✏️ Edit list") + '</button>' +
    '<button type="button" class="btn alt" id="add-doc">＋ Add a document</button>' +
    '<button type="button" class="btn alt" id="import-docs">⤓ Import</button></div><div id="doc-form"></div>';
  $("toggle-edit").onclick = () => { editingDocs = !editingDocs; showDocs(); };
  $("add-doc").onclick = () => docForm(null);
  $("import-docs").onclick = importForm;
  hub.querySelectorAll("[data-edit-doc]").forEach((b) => b.onclick = (e) => { e.preventDefault(); docForm(docs.find((d) => d.id === b.dataset.editDoc)); });
}
function docItem(d) {
  const a = ACCESS[d.access] ? d.access : "sign";
  return '<li><a href="' + esc(d.url) + '" target="_blank" rel="noopener"><span><b>' + esc(d.title) + '</b>' + (d.note ? '<small>' + esc(d.note) + '</small>' : '') + '</span>' +
    (editingDocs ? '<button type="button" class="btn alt small" data-edit-doc="' + d.id + '">Edit</button>' : '<span class="badge ' + a + '">' + ACCESS[a][0] + '</span>') + '</a></li>';
}
function docForm(d) {
  $("doc-form").innerHTML = '<form class="card form-card" id="df"><h2>' + (d ? "Edit document" : "Add a document") + '</h2>' +
    '<label class="field" for="d-title">Title</label><input class="input" id="d-title" required maxlength="120" value="' + esc(d ? d.title : "") + '">' +
    '<label class="field" for="d-note">Short description (optional)</label><input class="input" id="d-note" maxlength="200" value="' + esc(d ? d.note : "") + '">' +
    '<label class="field" for="d-url">Link</label><input class="input" id="d-url" type="text" inputmode="url" autocapitalize="off" spellcheck="false" required value="' + esc(d ? d.url : "") + '">' +
    '<label class="field" for="d-section">Section</label><select class="input" id="d-section">' + SECTIONS.map((s) => '<option' + (d && d.section === s ? " selected" : "") + '>' + s + '</option>').join("") + '</select>' +
    '<label class="field" for="d-access">Who can open it</label><select class="input" id="d-access">' + Object.entries(ACCESS).map(([k, v]) => '<option value="' + k + '"' + (d && d.access === k ? " selected" : "") + '>' + v[0] + ' – ' + v[1] + '</option>').join("") + '</select>' +
    '<button type="submit" class="btn">Save</button>' + (d ? '<button type="button" class="btn alt" id="df-del">Remove from list</button>' : '') +
    '<button type="button" class="btn alt" id="df-cancel">Cancel</button></form>';
  $("df").scrollIntoView({ behavior: "smooth" });
  $("df-cancel").onclick = () => { $("doc-form").innerHTML = ""; };
  if (d) $("df-del").onclick = async () => { if (confirm("Remove this document from the list? (The document itself isn't deleted.)")) { await fb.F.deleteDoc(fb.F.doc(fb.db, "teamDocs", d.id)); $("doc-form").innerHTML = ""; } };
  $("df").onsubmit = async (e) => {
    e.preventDefault();
    const { F, db } = fb;
    const data = { title: $("d-title").value.trim(), note: $("d-note").value.trim(), url: fixLink($("d-url").value),
      section: $("d-section").value, access: $("d-access").value };
    if (d) await F.updateDoc(F.doc(db, "teamDocs", d.id), data);
    else await F.addDoc(F.collection(db, "teamDocs"), Object.assign(data, { order: docs.length ? Math.max(...docs.map((x) => x.order || 0)) + 1 : 1 }));
    $("doc-form").innerHTML = "";
  };
}
// One-off import: paste the list (JSON) that came with this update
function importForm() {
  $("doc-form").innerHTML = '<form class="card form-card" id="if"><h2>Import</h2>' +
    '<p>Choose the <b>team-hub-import.json</b> file – or paste its contents in the box. It adds the documents and meetings to the hub (anything already there is kept).</p>' +
    '<label class="field" for="imp-file">The file</label><input class="input" id="imp-file" type="file" accept=".json,application/json,text/plain">' +
    '<label class="field" for="imp">…or paste the text</label><textarea class="input" id="imp" rows="6" spellcheck="false" autocapitalize="off" autocorrect="off"></textarea>' +
    '<p class="form-error" id="if-err" hidden></p><button type="submit" class="btn">Import</button>' +
    '<button type="button" class="btn alt" id="if-cancel">Cancel</button></form>';
  $("if-cancel").onclick = () => { $("doc-form").innerHTML = ""; };
  $("if").onsubmit = async (e) => {
    e.preventDefault();
    const err = (t) => { $("if-err").textContent = t; $("if-err").hidden = false; };
    let text = $("imp").value;
    const file = $("imp-file").files[0];
    if (file) text = await file.text();
    // Forgive the usual copy-and-paste damage: curly "smart" quotes, stray text around it
    text = text.replace(/^\uFEFF/, "").replace(/[\u201C\u201D\u201E\u2033]/g, '"').replace(/[\u2018\u2019]/g, "'");
    const first = text.indexOf("{"), last = text.lastIndexOf("}");
    let data;
    try { data = JSON.parse(text.slice(first, last + 1)); }
    catch (x) { return err(file ? "That file isn't the import file – choose team-hub-import.json." : "That isn't valid import text. Easiest fix: use 'The file' above and choose team-hub-import.json instead of pasting."); }
    const { F, db } = fb;
    const batch = F.writeBatch(db);
    let order = docs.length ? Math.max(...docs.map((x) => x.order || 0)) : 0, n = 0, m = 0;
    (data.documents || []).forEach((d) => {
      if (!d.title || !d.url || docs.some((x) => x.url === d.url)) return;
      batch.set(F.doc(F.collection(db, "teamDocs")), { title: String(d.title), note: String(d.note || ""), url: String(d.url),
        section: String(d.section || "Other"), access: ACCESS[d.access] ? d.access : "sign", order: ++order }); n++;
    });
    (data.meetings || []).forEach((x) => {
      if (!x.start || meetings.some((y) => tsMs(y.start) === new Date(x.start).getTime())) return;
      batch.set(F.doc(F.collection(db, "meetings")), { title: String(x.title || "Organising meeting"), start: F.Timestamp.fromDate(new Date(x.start)),
        end: x.end ? F.Timestamp.fromDate(new Date(x.end)) : null, link: String(x.link || ""), agendaUrl: String(x.agendaUrl || ""), notes: String(x.notes || ""),
        createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() }); m++;
    });
    try { await batch.commit(); $("doc-form").innerHTML = '<p class="map-message">Imported ' + n + ' documents and ' + m + ' meetings. ✓</p>'; }
    catch (x) { err("That didn't save: " + x.message); }
  };
}


/* ---------- Tools ---------- */
function showTools() {
  const t = (href, icon, title, note) => '<li><a href="' + href + '"' + (href.startsWith("http") ? ' target="_blank" rel="noopener"' : '') + '><span><b>' + icon + ' ' + title + '</b><small>' + note + '</small></span><span aria-hidden="true">→</span></a></li>';
  hub.innerHTML = '<h1 class="page-title">Tools</h1>' +
    '<h2 class="admin-h">Visitor app</h2><ul class="doc-list">' +
      t("facts.html", "📌", "Key facts", "Date, times, venue, charities, entry and raffle prices – from the key assumptions register") +
      t("news.html", "📣", "Post news and alerts", "Write, schedule and edit news; urgent alerts on the day") +
      t("raffle.html", "🎁", "Raffle", "Prizes, tickets sold, the draw and the raffle record") +
      t("photos.html", "📷", "Approve photos", "Check visitors' photos before they appear") +
      t("https://vinnie89-wq.github.io/silage-day-visitor/map.html?preview=1", "⏱️", "Preview the show day", "The visitor app with a time slider – try it at 14:40") +
      t("https://vinnie89-wq.github.io/silage-day-visitor/", "📱", "Open the visitor app", "As visitors see it") +
    '</ul><h2 class="admin-h">Behind the scenes</h2><ul class="doc-list">' +
      t("https://console.firebase.google.com/project/silage-day/firestore/databases/-default-/data", "🔥", "Firebase database", "Registrations, payments, news and photos – the raw data") +
      t("https://github.com/vinnie89-wq/silage-day-visitor", "🐙", "Visitor app code (GitHub)", "Where changes to the visitor app are made") +
      t("https://github.com/vinnie89-wq/silage-day-team", "🐙", "Team hub code (GitHub)", "Where changes to this app are made") +
    '</ul><p class="pad-x muted">Signed in as ' + esc(user.email) + '.</p>';
}

start();
