# Pembrokeshire Silage Day – Team hub

The organising team's app for Pembrokeshire Silage Day (Saturday 11 September 2027).
**Live at:** https://vinnie89-wq.github.io/silage-day-team/ – install it on your phone
(Share → Add to Home Screen on iPhone; Install on Android).

It's a separate app from the **visitor app** (https://github.com/vinnie89-wq/silage-day-visitor)
so there's no route from the visitor app into anything for organisers. Both use the same Firebase
project, but the Team hub signs in under its own name ("team"), so organiser sign-ins and saved
team data never mix with the visitor app on the same device.

## Who can use it

Only Google accounts on the organisers' list. Anyone else sees the sign-in screen and nothing else:
all the data is loaded from Firebase after signing in, and the Firebase **security rules** refuse
it to anyone not on the list. The list (and all the rules) live in the visitor app's repository:
`silage-day-visitor/firebase/firestore.rules` → `isOrganiser()`. Add someone's Google email there
and paste/publish the rules in Firebase → Firestore → Rules.

This code is public (needed for free GitHub Pages) but contains no private information – no
document links, names or figures. Those are all in Firebase.

## What's in it

| Page | What it does |
|---|---|
| `index.html` | **Dashboard** (registrations, payments, next meeting, actions, photos waiting, news), **Meetings**, **Actions** (shared tracker), **Documents** (plan links; Import), **Tools** |
| `news.html` | Post news and urgent alerts in English and Welsh – now or scheduled – with up to 4 photos and a YouTube video. **Translate into Welsh** fills in the Welsh: with a Google Cloud Translation key (set up at the bottom of the page; kept in `teamSecrets`, organisers only) it's automatic, otherwise it opens Google Translate. Machine Welsh should be checked by a Welsh speaker. |
| `photos.html` | Approve or reject visitors' photos before they appear in the visitor app. |
| `facts.html` | **Key facts** – the date, hours, venue, charities, entry prices and raffle details the visitor app shows. Each box carries its ID from the *Key assumptions and details* register (the master copy): change the register first, then here, and every page of the visitor app updates. Saved as `config/facts`. |
| `sponsors.html` | **Sponsors** – tracker (package, field, price, contact, status, notes) and what shows in the visitor app: logo, website, a line, an offer. Each sponsor is Off, Preview only (shown with ?preview=1 – for trying the look with last year's sponsors) or Live. Organisers-only data in `sponsors`; the public part copied to `sponsorsPublic`. |
| `raffle.html` | **Raffle** – show it to visitors, prizes, tickets sold and costs, the draw, and the printable raffle record. Paper tickets on the day only. |

Code: `js/team.js` (the hub), `js/firebase.js` (the shared Firebase connection), `js/firebase-config.js`
(project settings – not secret), `css/style.css` (copied from the visitor app so both look alike) and
`css/team.css`.

Firebase collections used: `meetings`, `actions`, `teamDocs` (hub), `news` (news page),
`pending`, `full`, `gallery` (photos page), `config/facts` (key facts), `config/raffle`, `rafflePrizes`,
`raffleSales`, `raffleCosts`, `raffleDraws` (raffle page), and it reads `registrations` and `checkins` for the dashboard.

## Making changes

Same as the visitor app: when you change a CSS or JS file, bump the `?v=` number on every link to it
(e.g. `?v=1` → `?v=2`) so phones load the new version.
