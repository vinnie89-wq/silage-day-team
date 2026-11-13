/* =========================================================
   Firebase settings – the online database for visitor photos
   ---------------------------------------------------------
   Until this is filled in, the Photos page says photo sharing
   "isn't switched on yet" and everything else works as normal.

   HOW TO FILL IT IN (see README.md, "Photos – setting up Firebase"):
   Firebase console → ⚙ Project settings → Your apps → the web
   app (</>) → "SDK setup and configuration" → Config.
   Copy the values from there into the matching lines below.

   These values are NOT secret – every website that uses Firebase
   shows them to its visitors. What keeps the photos safe is the
   security rules in firebase/firestore.rules.
   ========================================================= */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCiXqzYexlc87Uj-Gd7BM3iUP44Tg6crQw",
  authDomain: "silage-day.firebaseapp.com",
  projectId: "silage-day",
  storageBucket: "silage-day.firebasestorage.app",
  messagingSenderId: "247558714606",
  appId: "1:247558714606:web:15e7a9e54adf0a08ba2fff"
};
