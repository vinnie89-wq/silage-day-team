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
| `news.html` | Post news and urgent alerts in English and Welsh – now or scheduled. They appear in the visitor app. |
| `photos.html` | Approve or reject visitors' photos before they appear in the visitor app. |

Code: `js/team.js` (the hub), `js/firebase.js` (the shared Firebase connection), `js/firebase-config.js`
(project settings – not secret), `css/style.css` (copied from the visitor app so both look alike) and
`css/team.css`.

Firebase collections used: `meetings`, `actions`, `teamDocs` (hub), `news` (news page),
`pending`, `full`, `gallery` (photos page), and it reads `registrations` and `checkins` for the dashboard.

## Making changes

Same as the visitor app: when you change a CSS or JS file, bump the `?v=` number on every link to it
(e.g. `?v=1` → `?v=2`) so phones load the new version.
