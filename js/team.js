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
let meetings = [], actions = [], docs = [], gantt = [], revisions = [];
let planSel = null, planView = "focus", planStream = "";
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
  stops.push(F.onSnapshot(F.collection(db, "revisions"), (s) => {
    revisions = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.rev || 0) - (a.rev || 0));
    if (tab === "actions" && $("export-panel") && !$("export-panel").hidden) drawExport();
  }, () => {}));
  stops.push(F.onSnapshot(F.collection(db, "gantt"), (s) => {
    gantt = s.docs.map((d) => ({ id: d.id, ...d.data() })); if (tab === "dashboard") drawPlan();
  }, () => {}));
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
    '<section class="card plan-card" id="plan-card"></section>' +
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
      tile(open.filter((a) => ragOf(a) === "amber").length, "due in the next 7 days", "#actions") +
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
  drawPlan();
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


/* ---------- Actions ----------
   Each action: text, owner, due, done, status, comments [{ by, name, at, text }].
   Colour (RAG): red = past its due date · amber = due in the next 7 days ·
   green = on plan · blue = complete · grey = no due date. */
const STATUSES = { todo: "Not started", doing: "In progress", waiting: "Waiting on someone", blocked: "Blocked", done: "Complete" };
const RAG = { red: "Overdue", amber: "Due within 7 days", green: "On plan", grey: "No date", blue: "Complete" };
let actionSort = "due", actionColour = "", exportOpen = false;
const openEdits = new Set();   // actions whose details are open – kept open when the list refreshes
function statusOf(a) { return a.done ? "done" : (STATUSES[a.status] && a.status !== "done" ? a.status : "todo"); }
function ragOf(a) {
  if (a.done) return "blue";
  const due = tsMs(a.due);
  if (!due) return "grey";
  const today = new Date().setHours(0, 0, 0, 0);
  if (due < today) return "red";
  if (due < today + 8 * 864e5) return "amber";
  return "green";
}
function sortActions(list) {
  const byDue = (a, b) => (tsMs(a.due) || 9e15) - (tsMs(b.due) || 9e15);
  const sorts = {
    due: (a, b) => (a.done - b.done) || byDue(a, b),
    code: (a, b) => (a.done - b.done) || (codeOf(a.text) ? 0 : 1) - (codeOf(b.text) ? 0 : 1) || String(codeOf(a.text) || "").localeCompare(String(codeOf(b.text) || "")) || byDue(a, b),
    owner: (a, b) => (a.done - b.done) || (a.owner ? 0 : 1) - (b.owner ? 0 : 1) || String(a.owner || "").localeCompare(String(b.owner || "")) || byDue(a, b),
    status: (a, b) => Object.keys(STATUSES).indexOf(statusOf(a)) - Object.keys(STATUSES).indexOf(statusOf(b)) || byDue(a, b),
    newest: (a, b) => (tsMs(b.createdAt) || 0) - (tsMs(a.createdAt) || 0)
  };
  return list.slice().sort(sorts[actionSort] || sorts.due);
}

function showActions() {
  // Keep anything half-typed when the list updates
  const keep = ["a-text", "a-owner", "a-due"].map((id) => $(id) ? $(id).value : "");
  const drafts = {};
  hub.querySelectorAll("[data-comment-input]").forEach((el) => { if (el.value) drafts[el.dataset.commentInput] = el.value; });
  const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches("[data-comment-input], [data-owner], [data-due]");
  if (typing && hub.querySelector(".action-list")) return; // don't redraw under someone typing a comment
  const base = actions.filter((a) => actionFilter === "all" || (actionFilter === "open" ? !a.done : actionFilter === "mine" ? !a.done && mine(a) : a.done));
  const counts = {}; base.forEach((a) => { const r = ragOf(a); counts[r] = (counts[r] || 0) + 1; });
  const list = sortActions(base.filter((a) => !actionColour || ragOf(a) === actionColour));
  const f = (k, label) => '<button type="button" class="chip' + (actionFilter === k ? " on" : "") + '" data-filter="' + k + '">' + label + '</button>';
  hub.innerHTML = '<h1 class="page-title">Actions</h1>' +
    '<form class="card form-card add-action" id="af"><label class="field" for="a-text">New action</label>' +
      '<input class="input" id="a-text" maxlength="300" placeholder="What needs doing? Start with a plan code to link it, e.g. G1 · …" required>' +
      '<div class="action-row"><div><label class="field" for="a-owner">Owner</label><input class="input" id="a-owner" maxlength="60" list="owners"></div>' +
      '<div><label class="field" for="a-due">Due</label><input class="input" id="a-due" type="date"></div></div>' +
      '<datalist id="owners">' + [...new Set(actions.map((a) => a.owner).filter(Boolean))].map((o) => '<option value="' + esc(o) + '">').join("") + '</datalist>' +
      '<button type="submit" class="btn">Add action</button></form>' +
    '<div class="chips" role="group" aria-label="Show">' + f("open", "Open") + f("mine", "Mine") + f("done", "Done") + f("all", "All") + '</div>' +
    '<div class="rag-key" role="group" aria-label="Filter by colour">' + Object.entries(RAG).map(([k, l]) =>
      '<button type="button" class="rag-chip rag-' + k + (actionColour === k ? " on" : "") + '" data-colour="' + k + '"><span class="rag-dot"></span>' + l + ' <b>' + (counts[k] || 0) + '</b></button>').join("") + '</div>' +
    '<div class="export-bar"><button type="button" class="btn alt small" id="export-btn">⤓ Export / new revision</button>' +
      (revisions.length ? '<span class="muted">Last: Rev ' + revisions[0].rev + ', ' + fmtDate(tsMs(revisions[0].at) || Date.now(), { day: "numeric", month: "short", year: "numeric" }) + '</span>' : '<span class="muted">No revisions yet</span>') + '</div>' +
    '<section class="card export-panel" id="export-panel"' + (exportOpen ? '' : ' hidden') + '></section>' +
    '<div class="sort-row"><label for="a-sort">Sort by</label><select class="input" id="a-sort">' +
      [["due", "Due date"], ["code", "Plan code"], ["owner", "Owner"], ["status", "Status"], ["newest", "Newest first"]].map(([k, l]) => '<option value="' + k + '"' + (actionSort === k ? " selected" : "") + '>' + l + '</option>').join("") +
    '</select><span class="muted">' + list.length + ' shown' + (actionColour ? ' · <button type="button" class="link-btn" id="clear-colour">show all colours</button>' : '') + '</span></div>' +
    (list.length ? '<ul class="action-list">' + list.map(actionItem).join("") + '</ul>' : '<p class="pad-x muted">Nothing here.</p>');
  ["a-text", "a-owner", "a-due"].forEach((id, i) => { $(id).value = keep[i]; });
  Object.entries(drafts).forEach(([id, v]) => { const el = hub.querySelector('[data-comment-input="' + id + '"]'); if (el) el.value = v; });
  hub.querySelectorAll("[data-filter]").forEach((b) => b.onclick = () => { actionFilter = b.dataset.filter; showActions(); });
  hub.querySelectorAll("[data-colour]").forEach((b) => b.onclick = () => { actionColour = actionColour === b.dataset.colour ? "" : b.dataset.colour; showActions(); });
  if ($("clear-colour")) $("clear-colour").onclick = () => { actionColour = ""; showActions(); };
  $("a-sort").onchange = (e) => { actionSort = e.target.value; showActions(); };
  $("export-btn").onclick = () => { exportOpen = !exportOpen; $("export-panel").hidden = !exportOpen; if (exportOpen) drawExport(); };
  if (exportOpen) drawExport();
  wireActions(hub);
  $("af").onsubmit = async (e) => {
    e.preventDefault();
    const { F, db } = fb;
    const due = $("a-due").value;
    await F.addDoc(F.collection(db, "actions"), {
      text: $("a-text").value.trim(), owner: $("a-owner").value.trim(),
      due: due ? F.Timestamp.fromDate(new Date(due + "T12:00")) : null, done: false, status: "todo", comments: [],
      createdBy: user.email, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp()
    });
    ["a-text", "a-owner", "a-due"].forEach((id) => { if ($(id)) $(id).value = ""; });
    if ($("a-text")) $("a-text").focus();
  };
}

function actionItem(a) {
  const due = tsMs(a.due), rag = ragOf(a), st = statusOf(a), comments = Array.isArray(a.comments) ? a.comments : [];
  const last = comments[comments.length - 1], open = openEdits.has(a.id);
  const dueIso = due ? new Date(due - new Date(due).getTimezoneOffset() * 6e4).toISOString().slice(0, 10) : "";
  return '<li class="action rag-' + rag + (a.done ? " done" : "") + (open ? " open" : "") + '">' +
    '<div class="action-body">' +
      // Tap the title to open or close the details – it never changes the status
      '<button type="button" class="action-toggle" data-toggle="' + a.id + '" aria-expanded="' + open + '" aria-controls="ae-' + a.id + '">' +
        '<span class="action-text">' + esc(a.text) + '</span>' +
        '<span class="action-meta"><span class="rag-pill rag-' + rag + '">' + RAG[rag] + '</span> · ' +
          (a.owner ? esc(a.owner) : "No owner") + (due ? ' · due ' + fmtDay(due) : '') + (comments.length ? ' · 💬 ' + comments.length : '') + '</span>' +
        (last && !open ? '<span class="action-last">“' + esc(last.text.length > 110 ? last.text.slice(0, 109) + "…" : last.text) + '” – ' + esc(last.name || last.by || "") + '</span>' : '') +
        '<span class="action-chevron" aria-hidden="true">' + (open ? "▴" : "▾") + '</span>' +
      '</button>' +
      '<div class="action-status"><label for="as-' + a.id + '">Status</label><select class="input st-' + st + '" id="as-' + a.id + '" data-status="' + a.id + '">' +
        Object.entries(STATUSES).map(([k, l]) => '<option value="' + k + '"' + (k === st ? " selected" : "") + '>' + l + '</option>').join("") + '</select></div>' +
      '<div class="action-edit" id="ae-' + a.id + '"' + (open ? '' : ' hidden') + '>' +
        '<div class="action-row"><div><label class="field" for="ao-' + a.id + '">Owner</label><input class="input" id="ao-' + a.id + '" data-owner="' + a.id + '" maxlength="60" list="owners" value="' + esc(a.owner || "") + '"></div>' +
        '<div><label class="field" for="ad-' + a.id + '">Due</label><input class="input" id="ad-' + a.id + '" type="date" data-due="' + a.id + '" value="' + dueIso + '"></div></div>' +
        '<p class="field-hint">A new date is saved when you tap away from the box (or press Enter).</p>' +
        '<h4 class="comments-h">Comments</h4>' +
        (comments.length ? '<ul class="comment-list">' + comments.map((c) => '<li><span>' + esc(c.text) + '</span><small>' + esc(c.name || c.by || "") + (c.at ? ' · ' + fmtDate(c.at) : '') + '</small></li>').join("") + '</ul>' : '<p class="muted">No comments yet.</p>') +
        '<form class="comment-add" data-comment-form="' + a.id + '"><input class="input" data-comment-input="' + a.id + '" maxlength="500" placeholder="Add a comment or update…" aria-label="Comment"><button type="submit" class="btn alt small">Add</button></form>' +
        '<div class="ask-row"><a class="btn alt small ask-claude" data-ask="' + a.id + '" href="https://claude.ai/new" target="_blank" rel="noopener">🤖 Ask Claude what this is</a>' +
        '<button type="button" class="link-btn del-link" data-del-action="' + a.id + '">Delete this action</button></div>' +
      '</div></div></li>';
}

/* "Ask Claude what this is": opens a new Claude chat with the question already
   written – the action, its plan task, owner, dates, status, comments and links
   to the team's planning documents – so Claude can explain it. Nothing is sent
   until you press send in Claude. */
function askClaudeUrl(a) {
  const code = codeOf(a.text), g = code && gantt.find((x) => (x.code || x.id) === code);
  let task = "";
  if (g) {
    try {
      const plan = planNow(), t = plan.by[code];
      const next = plan.tasks.filter((x) => x.after.includes(code)).map((x) => x.code + " " + x.name);
      task = "It belongs to plan task " + code + " – " + t.name + " (workstream: " + t.stream + "; " +
        (t.fixed ? "fixed date " + Gantt.fmt(t.es) : "latest finish " + Gantt.fmt(t.lf) + ", " + Math.floor(t.slack / 7) + " weeks' slack") +
        (t.after.length ? "; waits for " + t.after.map((c) => c + " " + (plan.by[c] ? plan.by[c].name : "")).join(", ") : "") +
        (next.length ? "; then " + next.join(", ") : "") + (t.note ? "; note: " + t.note : "") + ").";
    } catch (e) { task = "It belongs to plan task " + code + " – " + (g.name || "") + "."; }
  }
  const comments = (Array.isArray(a.comments) ? a.comments : []).slice(-5).map((c) => "- " + (c.name || c.by || "") + ": " + c.text).join("\n");
  // The core plan documents first, then the one(s) for this task's workstream
  const words = { "Emergency and medical": /emergency|marshalling/i, "Safety and licensing": /event management|risk assessment|method statement|licen/i,
    "Traffic": /traffic|sign/i, "Exhibitors and traders": /exhibitor|trader|scrutineer/i, "Sponsorship and charity": /sponsor|charity|raffle|CLAAS|GRASSMEN/i,
    "Volunteers": /marshal|role|briefing/i, "Site and suppliers": /fencing|site|sign/i, "Fields and build": /site preparation|method statement|fencing/i,
    "Event app": /app|privacy/i, "Governance": /role|finance|event management/i };
  const stream = g && g.stream, core = /action tracker|gantt|critical path|key assumptions/i;
  const related = docs.filter((d) => core.test(d.title || "")).concat(docs.filter((d) => stream && words[stream] && words[stream].test(d.title || "") && !core.test(d.title || "")))
    .slice(0, 8).map((d) => "- " + d.title + ": " + d.url).join("\n");
  const due = tsMs(a.due);
  const q = "I'm one of the organisers of Pembrokeshire Silage Day – a charity working silage demonstration day at Slade Hall Farm near Haverfordwest on " + showDay().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + ". " +
    "This action is on our Team hub action list and I'm not sure what it means or why we need it. Please explain in plain English: what it is, why it matters for the event, what \"done\" looks like, and the first practical step. If it depends on another task, a decision or a document, say which.\n\n" +
    "Action: " + a.text + "\n" + (task ? task + "\n" : "") +
    "Owner: " + (a.owner || "none yet") + " · Due: " + (due ? new Date(due).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "no date") + " · Status: " + STATUSES[statusOf(a)] + "\n" +
    (comments ? "Comments so far:\n" + comments + "\n" : "") +
    (related ? "\nOur planning documents (open them if you can):\n" + related : "");
  return "https://claude.ai/new?q=" + encodeURIComponent(q.slice(0, 6000));
}

// Make the open/close, status, date, owner, comments and delete work (Actions page and the plan)
function wireActions(root) {
  const { F, db } = fb;
  const upd = (id, data) => F.updateDoc(F.doc(db, "actions", id), { ...data, updatedAt: F.serverTimestamp() });
  root.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = () => {
    const id = b.dataset.toggle, panel = document.getElementById("ae-" + id), li = b.closest(".action");
    const open = panel.hidden;
    panel.hidden = !open; b.setAttribute("aria-expanded", open); li.classList.toggle("open", open);
    b.querySelector(".action-chevron").textContent = open ? "▴" : "▾";
    const lastEl = b.querySelector(".action-last"); if (lastEl) lastEl.hidden = open;
    if (open) openEdits.add(id); else openEdits.delete(id);
  });
  root.querySelectorAll("[data-status]").forEach((s) => s.onchange = () => upd(s.dataset.status, { status: s.value, done: s.value === "done" }));
  // The due date is only saved once you've finished with it (you leave the box, or press Enter) –
  // not while you're still changing the day, month or year – so the action doesn't jump away mid-edit
  root.querySelectorAll("[data-due]").forEach((d) => {
    d.dataset.orig = d.value;
    const save = () => {
      if (d.value === d.dataset.orig) return;
      if (d.value && !/^\d{4}-\d{2}-\d{2}$/.test(d.value)) return;
      d.dataset.orig = d.value;
      upd(d.dataset.due, { due: d.value ? F.Timestamp.fromDate(new Date(d.value + "T12:00")) : null });
    };
    d.onchange = null;
    d.onblur = save;
    d.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); d.blur(); } };
  });
  root.querySelectorAll("[data-owner]").forEach((o) => o.onchange = () => upd(o.dataset.owner, { owner: o.value.trim() }));
  root.querySelectorAll("[data-comment-form]").forEach((f) => f.onsubmit = async (e) => {
    e.preventDefault();
    const id = f.dataset.commentForm, input = f.querySelector("input"), text = input.value.trim();
    if (!text) return;
    const a = actions.find((x) => x.id === id);
    const comments = (a && Array.isArray(a.comments) ? a.comments : []).concat({ by: user.email, name: user.displayName || user.email, at: Date.now(), text });
    input.value = ""; input.blur();
    try { await upd(id, { comments }); } catch (x) { alert("The comment didn't save: " + x.message); input.value = text; }
  });
  root.querySelectorAll("[data-del-action]").forEach((b) => b.onclick = () => { if (confirm("Delete this action?")) F.deleteDoc(F.doc(db, "actions", b.dataset.delAction)); });
  // Build the question at the moment it's tapped, so it has the latest plan, comments and documents
  root.querySelectorAll("[data-ask]").forEach((l) => {
    const fill = () => { const a = actions.find((x) => x.id === l.dataset.ask); if (a) l.href = askClaudeUrl(a); };
    l.addEventListener("pointerdown", fill); l.addEventListener("focus", fill); l.addEventListener("click", fill);
  });
}
function mine(a) {
  const o = (a.owner || "").toLowerCase();
  return o && (o === (user.displayName || "").toLowerCase() || o === user.email.toLowerCase() || (user.displayName || "").toLowerCase().split(" ")[0] === o);
}


/* ---------- Export and revisions ----------
   "Export / new revision" saves a numbered snapshot of every action
   (Firebase "revisions": rev, at, by, note, snapshot) and downloads it
   as a spreadsheet (CSV – opens in Excel or Google Sheets). It lists what
   changed since the last revision, and gives a summary to paste into the
   action tracker document's revision history (or to Claude to update it). */
const isoDay = (ms) => ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 6e4).toISOString().slice(0, 10) : "";
function snapshotOf(a) {
  const comments = Array.isArray(a.comments) ? a.comments : [], last = comments[comments.length - 1];
  return { id: a.id, code: codeOf(a.text) || "", text: a.text || "", owner: a.owner || "", due: isoDay(tsMs(a.due)), status: statusOf(a), rag: ragOf(a),
           comments: comments.length, lastComment: last ? last.text : "", lastBy: last ? (last.name || last.by || "") : "", lastAt: last && last.at ? isoDay(last.at) : "" };
}
function diffSince(prev) {
  const now = actions.map(snapshotOf), before = Object.fromEntries((prev ? prev.snapshot || [] : []).map((x) => [x.id, x]));
  const out = { added: [], completed: [], status: [], dates: [], owners: [], comments: [], removed: [] };
  if (!prev) return out;
  now.forEach((a) => {
    const b = before[a.id];
    if (!b) { out.added.push(a); return; }
    if (a.status !== b.status) (a.status === "done" ? out.completed : out.status).push({ a, from: b.status });
    if (a.due !== b.due) out.dates.push({ a, from: b.due });
    if (a.owner !== b.owner) out.owners.push({ a, from: b.owner });
    if (a.comments > b.comments) out.comments.push({ a, n: a.comments - b.comments });
    delete before[a.id];
  });
  out.removed = Object.values(before);
  return out;
}
const shortText = (t) => t.length > 90 ? t.slice(0, 89) + "…" : t;
const ukDate = (iso) => iso ? new Date(iso + "T12:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "no date";
function diffLines(d) {
  const L = [];
  d.added.forEach((a) => L.push("Added: " + shortText(a.text) + (a.due ? " (due " + ukDate(a.due) + ")" : "")));
  d.completed.forEach(({ a }) => L.push("Completed: " + shortText(a.text)));
  d.status.forEach(({ a, from }) => L.push("Status " + STATUSES[from] + " → " + STATUSES[a.status] + ": " + shortText(a.text)));
  d.dates.forEach(({ a, from }) => L.push("Due date " + ukDate(from) + " → " + ukDate(a.due) + ": " + shortText(a.text)));
  d.owners.forEach(({ a, from }) => L.push("Owner " + (from || "none") + " → " + (a.owner || "none") + ": " + shortText(a.text)));
  d.comments.forEach(({ a, n }) => L.push(n + " new comment" + (n > 1 ? "s" : "") + " on " + shortText(a.text) + (a.lastComment ? " – latest: “" + shortText(a.lastComment) + "”" : "")));
  d.removed.forEach((a) => L.push("Deleted: " + shortText(a.text)));
  return L;
}
function drawExport() {
  const panel = $("export-panel"); if (!panel) return;
  const last = revisions[0], next = (last ? last.rev || 0 : 0) + 1;
  const lines = diffLines(diffSince(last));
  const keepNote = $("rev-note") ? $("rev-note").value : "";
  panel.innerHTML = '<h2>Export and revisions</h2>' +
    '<p class="muted">Saving a revision keeps a numbered snapshot of every action, downloads it as a spreadsheet (opens in Excel or Google Sheets), and gives you the summary for the action tracker document\'s revision history.</p>' +
    '<h3 class="rev-h">' + (last ? 'Changes since Rev ' + last.rev + ' (' + fmtDate(tsMs(last.at) || Date.now(), { day: "numeric", month: "short", year: "numeric" }) + ')' : 'First revision – no earlier one to compare with') + '</h3>' +
    (last ? (lines.length ? '<ul class="rev-changes">' + lines.map((l) => '<li>' + esc(l) + '</li>').join("") + '</ul>' : '<p class="muted">No changes since then.</p>') : '') +
    '<label class="field" for="rev-note">Note for Rev ' + next + ' (optional)</label><input class="input" id="rev-note" maxlength="200" placeholder="e.g. After the 15 Nov organising meeting" value="' + esc(keepNote) + '">' +
    '<div class="meet-card-btns"><button type="button" class="btn" id="rev-save">Save as Rev ' + next + ' and download</button>' +
      '<button type="button" class="btn alt" id="rev-csv">Download current list only</button></div>' +
    '<p class="map-message" id="rev-msg" hidden></p>' +
    (revisions.length ? '<h3 class="rev-h">Revision history</h3><ul class="rev-list">' + revisions.map((r) =>
      '<li><b>Rev ' + r.rev + '</b> · ' + fmtDate(tsMs(r.at) || Date.now(), { day: "numeric", month: "short", year: "numeric" }) + ' · ' + esc(r.byName || r.by || "") +
      (r.note ? ' · ' + esc(r.note) : '') + ' · ' + (r.summary ? esc(r.summary) : '') +
      ' <button type="button" class="link-btn" data-rev-csv="' + r.id + '">download</button> <button type="button" class="link-btn" data-rev-copy="' + r.id + '">copy summary</button></li>').join("") + '</ul>' : '');
  $("rev-csv").onclick = () => downloadCsv(actions.map(snapshotOf), "Silage Day actions – " + isoDay(Date.now()) + ".csv", null);
  $("rev-save").onclick = saveRevision;
  panel.querySelectorAll("[data-rev-csv]").forEach((b) => b.onclick = () => { const r = revisions.find((x) => x.id === b.dataset.revCsv); downloadCsv(r.snapshot || [], "Silage Day actions – Rev " + r.rev + ".csv", r.rev); });
  panel.querySelectorAll("[data-rev-copy]").forEach((b) => b.onclick = () => copyText(revisionText(revisions.find((x) => x.id === b.dataset.revCopy)), b));
}
function revisionText(r) {
  const counts = {}; (r.snapshot || []).forEach((a) => counts[a.rag] = (counts[a.rag] || 0) + 1);
  return "Action tracker – Rev " + r.rev + " – " + fmtDate(tsMs(r.at) || Date.now(), { day: "numeric", month: "long", year: "numeric" }) + " – " + (r.byName || r.by || "") + "\n" +
    (r.note ? "Note: " + r.note + "\n" : "") +
    "Totals: " + (r.snapshot || []).length + " actions – " + Object.entries(RAG).map(([k, l]) => (counts[k] || 0) + " " + l.toLowerCase()).join(", ") + "\n" +
    ((r.changes || []).length ? "Changes since Rev " + (r.rev - 1) + ":\n" + r.changes.map((l) => "- " + l).join("\n") : "First revision.");
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); const t = btn.textContent; btn.textContent = "copied ✓"; setTimeout(() => btn.textContent = t, 1500); }
  catch (e) { prompt("Copy this:", text); }
}
function downloadCsv(rows, name, rev) {
  const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const head = ["Revision", "Plan code", "Action", "Owner", "Due", "Status", "Colour", "Comments", "Latest comment", "Comment by", "Comment date"];
  const body = rows.slice().sort((a, b) => (a.status === "done") - (b.status === "done") || (a.due || "9999").localeCompare(b.due || "9999"))
    .map((a) => [rev ? "Rev " + rev : "Current", a.code, a.text, a.owner, a.due, STATUSES[a.status] || a.status, RAG[a.rag] || a.rag, a.comments, a.lastComment, a.lastBy, a.lastAt]);
  const csv = "\uFEFF" + [head].concat(body).map((r) => r.map(q).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function saveRevision() {
  const { F, db } = fb;
  const last = revisions[0], rev = (last ? last.rev || 0 : 0) + 1;
  const snapshot = actions.map(snapshotOf), changes = diffLines(diffSince(last));
  const counts = {}; snapshot.forEach((a) => counts[a.rag] = (counts[a.rag] || 0) + 1);
  const summary = snapshot.length + " actions: " + (counts.red || 0) + " overdue, " + (counts.amber || 0) + " due this week, " + (counts.blue || 0) + " complete" + (last ? "; " + changes.length + " changes" : "");
  const data = { kind: "actions", rev, note: $("rev-note").value.trim(), by: user.email, byName: user.displayName || user.email, at: F.serverTimestamp(), snapshot, changes, summary };
  $("rev-save").disabled = true;
  try {
    await F.setDoc(F.doc(db, "revisions", "actions-rev-" + String(rev).padStart(3, "0")), data);
    downloadCsv(snapshot, "Silage Day actions – Rev " + rev + ".csv", rev);
    const text = revisionText({ ...data, at: null });
    $("rev-note").value = "";
    $("rev-msg").hidden = false;
    $("rev-msg").innerHTML = 'Saved as <b>Rev ' + rev + '</b> and downloaded. ✓ <button type="button" class="link-btn" id="rev-copy-now">Copy the summary</button> for the action tracker\'s revision history.';
    $("rev-copy-now").onclick = (e) => copyText(text, e.target);
  } catch (x) {
    $("rev-msg").hidden = false;
    $("rev-msg").textContent = x.code === "permission-denied" ? "Not allowed – publish the latest rules (visitor app: firebase/firestore.rules)." : "That didn't save: " + x.message;
  }
  $("rev-save").disabled = false;
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
    '<p>Choose the <b>team-hub-import.json</b> file – or paste its contents in the box. It adds the documents, meetings, actions and plan tasks in it to the hub (anything already there is kept, and nothing is added twice).</p>' +
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
    let order = docs.length ? Math.max(...docs.map((x) => x.order || 0)) : 0, n = 0, m = 0, k = 0;
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
    // Actions: { text, owner, due: "YYYY-MM-DD", done } – one with the same text is not added again,
    // but if it's still open and its due date has changed (the plan moved), the date is updated
    const have = new Set(actions.map((a) => (a.text || "").trim().toLowerCase()));
    let moved = 0;
    (data.actions || []).forEach((a) => {
      const text = String(a.text || "").trim().slice(0, 300);
      if (!text) return;
      // "was": the action's old wording – rename it rather than add a second copy
      const wasOld = a.was && !have.has(text.toLowerCase()) && actions.find((x) => (x.text || "").trim().toLowerCase() === String(a.was).trim().toLowerCase());
      if (wasOld) {
        batch.update(F.doc(db, "actions", wasOld.id), { text, ...(/^\d{4}-\d{2}-\d{2}$/.test(a.due || "") ? { due: F.Timestamp.fromDate(new Date(a.due + "T12:00")) } : {}), updatedAt: F.serverTimestamp() });
        have.add(text.toLowerCase()); moved++; return;
      }
      if (have.has(text.toLowerCase())) {
        const old = actions.find((x) => (x.text || "").trim().toLowerCase() === text.toLowerCase());
        if (old && !old.done && /^\d{4}-\d{2}-\d{2}$/.test(a.due || "") && (!old.due || new Date(tsMs(old.due)).toISOString().slice(0, 10) !== a.due)) {
          batch.update(F.doc(db, "actions", old.id), { due: F.Timestamp.fromDate(new Date(a.due + "T12:00")), updatedAt: F.serverTimestamp() }); moved++;
        }
        return;
      }
      have.add(text.toLowerCase());
      batch.set(F.doc(F.collection(db, "actions")), { text, owner: String(a.owner || ""),
        due: /^\d{4}-\d{2}-\d{2}$/.test(a.due || "") ? F.Timestamp.fromDate(new Date(a.due + "T12:00")) : null, done: !!a.done,
        createdBy: user.email, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() }); k++;
    });
    // The plan (Gantt tasks): { code, name, stream, days, after, fixed, note, order } – kept by code; existing tasks are left as they are
    let g = 0;
    (data.gantt || []).forEach((t) => {
      const code = String(t.code || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{1,4}$/.test(code) || gantt.some((x) => x.id === code)) return;
      batch.set(F.doc(db, "gantt", code), { code, name: String(t.name || code), stream: String(t.stream || "Other"), days: Number(t.days) || 0,
        after: Array.isArray(t.after) ? t.after.map(String) : [], fixed: t.fixed || null, note: String(t.note || ""), done: !!t.done, order: Number(t.order) || 0,
        updatedBy: user.email, updatedAt: F.serverTimestamp() }); g++;
    });
    try {
      await batch.commit();
      $("doc-form").innerHTML = '<p class="map-message">Imported ' + n + ' documents, ' + m + ' meetings, ' + k + ' actions' + (moved ? ' (' + moved + ' due dates updated)' : '') + (g ? ' and ' + g + ' plan tasks' : '') + '. ✓</p>';
    }
    catch (x) { err("That didn't save: " + x.message); }
  };
}


/* ---------- The plan (critical path and Gantt chart) ----------
   Tasks live in Firebase "gantt" (one per code: G1, R2 …), imported once
   from the plan file and then kept up to date here. js/gantt.js works out
   the dates and draws the chart. Actions are linked to a task by starting
   with its code ("G1 · …"), so each task shows its open actions. */
const codeOf = (text) => { const m = /^([A-Z][A-Z0-9]{0,3}) [◆·]/.exec(text || ""); return m ? m[1] : null; };
function planNow() { return Gantt.compute(gantt.map((t) => ({ ...t, code: t.code || t.id })), { start: "2026-11-09", show: showDayIso }); }

function drawPlan() {
  const card = $("plan-card");
  if (!card) return;
  if (!gantt.length) {
    card.innerHTML = '<h2>📈 Plan</h2><p class="muted">The critical path and Gantt chart show here once the plan is imported: Documents → ⤓ Import → choose <b>team-hub-plan.json</b>.</p>';
    return;
  }
  const plan = planNow(), G = Gantt;
  const counts = {};
  actions.filter((a) => !a.done).forEach((a) => { const c = codeOf(a.text); if (c) counts[c] = (counts[c] || 0) + 1; });
  const weeks = (d) => Math.floor(d / 7);
  const views = { focus: "Critical & near", soon: "Next 3 months", all: "All" };
  const filter = (t) => (!planStream || t.stream === planStream) &&
    (planView === "all" || (planView === "focus" ? ["crit", "near"].includes(t.kind) || (!t.done && t.lf < plan.today) || t.code === planSel
      : (!t.done && t.ls <= plan.today + 92) || t.code === planSel));
  card.innerHTML = '<h2>📈 Plan</h2>' +
    '<div class="dash-grid">' +
      '<div class="dash-tile' + (plan.minSlack < 28 ? " warn" : "") + '"><b>' + weeks(plan.minSlack) + ' wk</b><span>in hand on the critical path</span></div>' +
      '<div class="dash-tile' + (plan.overdue.length ? " warn" : "") + '"><b>' + plan.overdue.length + '</b><span>past their latest finish</span></div>' +
      '<div class="dash-tile"><b>' + plan.tasks.filter((t) => t.done).length + '/' + plan.tasks.length + '</b><span>tasks done</span></div>' +
    '</div>' +
    '<p class="plan-crit"><b>Critical path:</b> ' + plan.critical.map((t) => '<button type="button" class="link-btn" data-plan="' + t.code + '">' + t.code + '</button>').join(" → ") +
      ' <span class="muted">(' + G.esc([...new Set(plan.critical.map((t) => t.stream))].join(", ")) + ')</span></p>' +
    (plan.problems.length ? '<p class="form-error">⚠ ' + G.esc(plan.problems.join(" · ")) + '</p>' : '') +
    '<p class="plan-next"><b>Next latest starts:</b> ' + plan.upcoming.slice(0, 4).map((t) => '<button type="button" class="link-btn" data-plan="' + t.code + '">' + t.code + '</button> ' + G.fmt(t.ls)).join(" · ") + '</p>' +
    '<div class="chips plan-chips">' + Object.entries(views).map(([k, l]) => '<button type="button" class="chip' + (planView === k ? " on" : "") + '" data-view="' + k + '">' + l + '</button>').join("") +
      '<select class="input plan-stream" id="plan-stream" aria-label="Workstream"><option value="">All workstreams</option>' + plan.streams.map((s) => '<option' + (s === planStream ? " selected" : "") + '>' + G.esc(s) + '</option>').join("") + '</select></div>' +
    '<div class="gantt-wrap" id="gantt-chart"></div>' +
    '<p class="g-legend"><span class="sw k-crit"></span>Critical path <span class="sw k-near"></span>Within 4 weeks of it <span class="sw k-norm"></span>Has slack <span class="sw k-fixed"></span>Fixed date · ┄┤ slack to latest finish · ⚠ late · ✓ done · “· 3” = open actions. Tap a task to see it.</p>' +
    '<div id="plan-detail"></div>';
  G.render($("gantt-chart"), plan, { filter, selected: planSel, counts, onSelect: (c) => { planSel = planSel === c ? null : c; drawPlan(); if (planSel) $("plan-detail").scrollIntoView({ behavior: "smooth", block: "nearest" }); } });
  card.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => { planView = b.dataset.view; drawPlan(); });
  $("plan-stream").onchange = (e) => { planStream = e.target.value; drawPlan(); };
  card.querySelectorAll("[data-plan]").forEach((b) => b.onclick = () => { planSel = b.dataset.plan; drawPlan(); $("plan-detail").scrollIntoView({ behavior: "smooth", block: "nearest" }); });
  if (planSel && plan.by[planSel]) planDetail(plan, plan.by[planSel]);
}

function planDetail(plan, t) {
  const G = Gantt, el = $("plan-detail");
  const linked = actions.filter((a) => codeOf(a.text) === t.code).sort((a, b) => (a.done - b.done) || ((tsMs(a.due) || 9e15) - (tsMs(b.due) || 9e15)));
  const next = plan.tasks.filter((x) => x.after.includes(t.code));
  const codeBtn = (c) => '<button type="button" class="link-btn" data-plan="' + c + '">' + c + '</button>';
  el.innerHTML = '<section class="plan-detail k-' + t.kind + '">' +
    '<h3>' + G.esc(t.code) + ' – ' + G.esc(t.name) + '</h3>' +
    '<p class="muted">' + G.esc(t.stream) + ' · ' + G.KIND[t.kind] + (t.done ? ' · <b>done</b>' : '') + '</p>' +
    '<dl class="facts">' +
      (t.days ? '<dt>Earliest</dt><dd>' + G.fmt(t.es) + ' → ' + G.fmt(t.ef) + ' (' + t.days + ' days)</dd>' : '<dt>Date</dt><dd>' + G.fmt(t.es) + ' (milestone)</dd>') +
      (t.fixed ? '' : '<dt>Latest</dt><dd>start ' + G.fmt(t.ls) + ' · finish <b>' + G.fmt(t.lf) + '</b></dd><dt>Slack</dt><dd>' + Math.floor(t.slack / 7) + ' weeks</dd>') +
      '<dt>After</dt><dd>' + (t.after.length ? t.after.map(codeBtn).join(", ") : '–') + '</dd>' +
      '<dt>Then</dt><dd>' + (next.length ? next.map((x) => codeBtn(x.code)).join(", ") : '–') + '</dd>' +
      (t.note ? '<dt>Note</dt><dd>' + G.esc(t.note) + '</dd>' : '') +
    '</dl>' +
    '<h4>Actions (' + linked.filter((a) => !a.done).length + ' open)</h4>' +
    (linked.length ? '<ul class="action-list plan-actions">' + linked.map(actionItem).join("") + '</ul>' : '<p class="muted">None yet.</p>') +
    '<form class="plan-add" id="pa"><input class="input" id="pa-text" maxlength="270" placeholder="Add an action for ' + G.esc(t.code) + '…"><button type="submit" class="btn alt small">Add</button></form>' +
    '<div class="meet-card-btns"><button type="button" class="btn alt small" id="pt-done">' + (t.done ? "Mark not done" : "✓ Mark task done") + '</button>' +
      '<button type="button" class="btn alt small" id="pt-edit">Edit task</button>' +
      '<a class="btn alt small" href="' + G.esc(askClaudeUrl({ text: t.code + " ◆ " + t.name, owner: "", due: null, comments: [] })) + '" target="_blank" rel="noopener">🤖 Ask Claude</a>' +
      '<button type="button" class="btn alt small" id="pt-close">Close</button></div>' +
    '<div id="pt-form"></div></section>';
  const { F, db } = fb;
  el.querySelectorAll("[data-plan]").forEach((b) => b.onclick = () => { planSel = b.dataset.plan; drawPlan(); });
  wireActions(el);
  $("pa").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("pa-text").value.trim(); if (!text) return;
    await F.addDoc(F.collection(db, "actions"), { text: t.code + " · " + text, owner: "", status: "todo", comments: [], due: t.fixed ? null : F.Timestamp.fromDate(new Date(t.lf * 864e5 + 12 * 3600e3)), done: false,
      createdBy: user.email, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
  };
  $("pt-done").onclick = () => F.updateDoc(F.doc(db, "gantt", t.id || t.code), { done: !t.done, updatedBy: user.email, updatedAt: F.serverTimestamp() });
  $("pt-close").onclick = () => { planSel = null; drawPlan(); };
  $("pt-edit").onclick = () => {
    $("pt-form").innerHTML = '<form class="form-card" id="pe">' +
      '<label class="field" for="pe-name">Task</label><input class="input" id="pe-name" maxlength="200" value="' + G.esc(t.name) + '">' +
      '<div class="action-row"><div><label class="field" for="pe-days">Days</label><input class="input" id="pe-days" type="number" min="0" step="1" value="' + t.days + '"></div>' +
      '<div><label class="field" for="pe-fixed">Fixed start (optional)</label><input class="input" id="pe-fixed" type="date" value="' + (t.fixed || "") + '"></div></div>' +
      '<label class="field" for="pe-after">After (codes, comma-separated)</label><input class="input" id="pe-after" value="' + G.esc(t.after.join(", ")) + '">' +
      '<label class="field" for="pe-note">Note</label><input class="input" id="pe-note" maxlength="300" value="' + G.esc(t.note || "") + '">' +
      '<p class="form-error" id="pe-err" hidden></p><button type="submit" class="btn">Save – recalculate the plan</button></form>';
    $("pe").onsubmit = async (e) => {
      e.preventDefault();
      const after = $("pe-after").value.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
      const upd = { name: $("pe-name").value.trim() || t.name, days: Math.max(0, Math.round(Number($("pe-days").value) || 0)), fixed: $("pe-fixed").value || null,
                    after, note: $("pe-note").value.trim(), updatedBy: user.email, updatedAt: F.serverTimestamp() };
      // Check the change makes sense before saving
      const test = Gantt.compute(gantt.map((x) => (x.id === t.id ? { ...x, ...upd, code: x.code || x.id } : { ...x, code: x.code || x.id })), { start: "2026-11-09", show: showDayIso });
      const bad = test.problems.filter((p) => p.includes(t.code));
      if (bad.length) { $("pe-err").textContent = bad.join(" · "); $("pe-err").hidden = false; return; }
      await F.updateDoc(F.doc(db, "gantt", t.id || t.code), upd);
    };
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
      t("sponsors.html", "🤝", "Sponsors", "Track sponsors from first contact to paid; logos, fields and offers in the app") +
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
