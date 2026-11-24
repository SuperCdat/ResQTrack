import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import {
  getDatabase, ref, onValue, onChildAdded, onChildChanged, off, goOffline, goOnline
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";

const app = initializeApp({
  apiKey: "AIzaSyAYrGkjxkR8nOZeoLy-MeHgjeB6_mKOmRE",
  authDomain: "resqtrack-10d06.firebaseapp.com",
  projectId: "resqtrack-10d06",
  storageBucket: "resqtrack-10d06.firebasestorage.app",
  messagingSenderId: "645292625821",
  appId: "1:645292625821:web:74153b12e2cda4a1106974"
});

const db = getFirestore(app);
const rtdb = getDatabase(app); // add { databaseURL } if your RTDB is not in the default region

/* ---- Static catalog: Firestore (1 doc), re-read only when catalogVersion changes ---- */

const CACHE_KEY = "resqtrack-catalog";

function cachedCatalog(version) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (c && version && c.v === version) return c.data;
  } catch (e) {}
  return null;
}

async function fetchCatalog(version) {
  const snap = await getDoc(doc(db, "catalog", "ambulances"));
  if (!snap.exists()) throw new Error("catalog/ambulances missing");

  const data = snap.data();
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ v: version, data }));
  } catch (e) {}
  return data;
}

let catalogShown = false;

function fallbackToLocal(reason) {
  console.error("Using local data:", reason);
  if (!catalogShown) loadLocalData();
}

// If Firebase never answers (wrong region, offline, rules), still show ambulances
setTimeout(() => { if (!catalogShown) fallbackToLocal("Firebase timeout"); }, 4000);

onValue(ref(rtdb, "catalogVersion"), async (snap) => {
  const version = snap.val();

  try {
    const data = cachedCatalog(version) || await fetchCatalog(version);
    liveProvince = null; // force live listeners to re-attach for the new catalog
    catalogShown = true;
    applyCatalog(data);
  } catch (e) {
    fallbackToLocal(e);
  }
}, (err) => fallbackToLocal(err)); // e.g. PERMISSION_DENIED

/* ---- Live positions: RTDB, only the province on screen, only changed children ---- */

let liveProvince = null;
let liveRef = null;

window.onProvinceLoaded = (province) => {
  if (province === liveProvince) return;

  if (liveRef) off(liveRef);
  liveProvince = province;
  liveRef = ref(rtdb, "live/" + province);

  const apply = (snap) => {
    const v = snap.val();
    if (v) applyLivePosition(province, snap.key, v.lat, v.lng);
  };

  onChildAdded(liveRef, apply);   // initial positions, once
  onChildChanged(liveRef, apply); // afterwards only the ambulance that moved
};

// Hidden tab = no connection, no bandwidth
document.addEventListener("visibilitychange", () => {
  if (document.hidden) goOffline(rtdb);
  else goOnline(rtdb);
});
