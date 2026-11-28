import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import {
  getDatabase, ref, update, set, get, remove, onDisconnect,
  onValue, onChildAdded, onChildChanged, onChildRemoved, off, goOnline
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

const app = initializeApp({
  apiKey: "AIzaSyAYrGkjxkR8nOZeoLy-MeHgjeB6_mKOmRE",
  authDomain: "resqtrack-10d06.firebaseapp.com",
  projectId: "resqtrack-10d06",
  storageBucket: "resqtrack-10d06.firebasestorage.app",
  messagingSenderId: "645292625821",
  appId: "1:645292625821:web:74153b12e2cda4a1106974"
});

const db = getFirestore(app);
const auth = getAuth(app);
const rtdb = getDatabase(app, "https://resqtrack-10d06-default-rtdb.asia-southeast1.firebasedatabase.app");

/* ---- Static catalog: Firestore (1 doc), re-read only when catalogVersion changes ---- */

const CACHE_KEY = "resqtrack-catalog";
const CATALOG_TIMEOUT_MS = 15000; // increased from 4000 — slow networks get more room

function readCatalogCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (c && c.data) return c;
  } catch (e) {}
  return null;
}

// Only valid when we already know the current version from Firebase
function cachedCatalog(version) {
  const c = readCatalogCache();
  if (c && version && c.v === version) return c.data;
  return null;
}

// Any cached data, regardless of version — used as the offline fallback
function anyCachedCatalog() {
  const c = readCatalogCache();
  return c ? c.data : null;
}

async function fetchCatalog(version) {
  const snap = await getDoc(doc(db, "catalog", "ambulances"));
  if (!snap.exists()) throw new Error("catalog/ambulances missing");

  const data = snap.data();
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ v: version, data, savedAt: Date.now() })
    );
  } catch (e) {}
  return data;
}

let catalogShown = false;

function showCatalog(data) {
  if (!data) return;
  catalogShown = true;
  if (typeof applyCatalog === "function") applyCatalog(data);
}

function fallbackToLocal(reason) {
  console.error("Using local data:", reason);
  if (!catalogShown && typeof loadLocalData === "function") loadLocalData();
}

setTimeout(
  () => { if (!catalogShown) fallbackToLocal("Firebase timeout"); },
  CATALOG_TIMEOUT_MS
);

onValue(ref(rtdb, "catalogVersion"), async (snap) => {
  const version = snap.val();

  try {
    const cached = cachedCatalog(version);
    if (cached) {
      if (!catalogShown) showCatalog(cached);
      return;
    }

    const data = await fetchCatalog(version);
    liveProvince = null;
    showCatalog(data);
  } catch (e) {
    fallbackToLocal(e);
  }
}, (err) => fallbackToLocal(err));

// Show last session's data instantly while Firebase responds. Runs as a
// macro-task so all module-level `let`s (liveProvince, onProvinceLoaded, …)
// are initialized before `applyCatalog` → `loadProvinceData` runs.
setTimeout(() => {
  if (catalogShown) return;
  const data = anyCachedCatalog();
  if (data) {
    console.log("[catalog] Showing last-session cache (awaiting Firebase)");
    showCatalog(data);
  }
}, 0);

onValue(ref(rtdb, "catalogVersion"), async (snap) => {
  const version = snap.val();

  try {
    const data = cachedCatalog(version) || await fetchCatalog(version);
    liveProvince = null;
    catalogShown = true;
    if (typeof applyCatalog === "function") applyCatalog(data);
  } catch (e) {
    fallbackToLocal(e);
  }
}, (err) => fallbackToLocal(err));

/* ---- Live positions & driver info: RTDB, only the province on screen ---- */

let liveProvince = null;
let liveRef = null;

function syncRemoteDriverNode(province, id, payload) {
  if (!payload || typeof payload.lat !== "number" || typeof payload.lng !== "number") return;
  if (typeof globalTransportData === "undefined" || !globalTransportData) return;

  if (!globalTransportData[province]) {
    globalTransportData[province] = [];
  }

  const list = globalTransportData[province];
  const status = payload.status || "available";
  const idx = list.findIndex((a) => a.id === id);

  if (status !== "available") {
    if (idx >= 0) {
      list.splice(idx, 1);
      if (province === currentProvince && typeof loadProvinceData === "function") {
        loadProvinceData(province);
      }
    }
    return;
  }

  if (idx >= 0) {
    list[idx].pos = [payload.lat, payload.lng];
    if (payload.name) list[idx].name = payload.name;
    if (payload.phonenumber) list[idx].phonenumber = payload.phonenumber;
    list[idx].status = status;
    list[idx].care = payload.care || null;

    if (province === currentProvince && typeof applyLivePosition === "function") {
      applyLivePosition(province, id, payload.lat, payload.lng);
      if (selectedAmbulance && selectedAmbulance.id === id && typeof renderInfoBox === "function") {
        renderInfoBox();
      }
      if (typeof addAmblist === "function") {
        addAmblist(list);
      }
    }
  } else {
    list.push({
      id,
      name: payload.name || `Xe trực tuyến (${id.slice(-4)})`,
      phonenumber: payload.phonenumber || "",
      status: "available",
      care: payload.care || null,
      pos: [payload.lat, payload.lng]
    });

    if (province === currentProvince && typeof loadProvinceData === "function") {
      loadProvinceData(province);
    }
  }
}

window.onProvinceLoaded = (province) => {
  if (province === liveProvince) return;

  if (liveRef) off(liveRef);
  liveProvince = province;
  liveRef = ref(rtdb, "live/" + province);

  const handleSnapshot = (snap) => {
    const v = snap.val();
    if (!v) return;

    if (typeof v.name === "string" || typeof v.phonenumber === "string" || typeof v.status === "string") {
      syncRemoteDriverNode(province, snap.key, v);
    } else if (typeof v.lat === "number" && typeof v.lng === "number") {
      if (typeof applyLivePosition === "function") {
        applyLivePosition(province, snap.key, v.lat, v.lng);
      }
    }
  };

  const handleRemoved = (snap) => {
    const id = snap.key;
    if (!id || typeof globalTransportData === "undefined" || !globalTransportData[province]) return;
    const list = globalTransportData[province];
    const idx = list.findIndex((a) => a.id === id);
    if (idx >= 0) {
      list.splice(idx, 1);
      if (province === currentProvince && typeof loadProvinceData === "function") {
        loadProvinceData(province);
      }
    }
  };

  onChildAdded(liveRef, handleSnapshot);
  onChildChanged(liveRef, handleSnapshot);
  onChildRemoved(liveRef, handleRemoved);
};

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    goOnline(rtdb);
  }
});

/* ---- Driver accounts: only drivers sign in; normal users never need an account ---- */

window.driverAuth = {
  signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),

  async signUp(email, password, profile) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await set(ref(rtdb, `drivers/${cred.user.uid}`), profile);
    return cred;
  },

  signOut: () => signOut(auth),

  async loadProfile(uid) {
    return (await get(ref(rtdb, `drivers/${uid}`))).val();
  },

  saveProfile: (uid, profile) => set(ref(rtdb, `drivers/${uid}`), profile)
};

onAuthStateChanged(auth, (user) => {
  if (typeof window.onDriverAuthChanged === "function") window.onDriverAuthChanged(user);
});

window.removeDriverLive = async (province, carId) => {
  try {
    await remove(ref(rtdb, `live/${province}/${carId}`));
  } catch (err) {
    console.error("Lỗi xoá vị trí khỏi RTDB:", err);
  }
};

// A driver whose tab closes or loses connection disappears from the map by itself
let disconnectPath = null;

window.pushDriverLivePos = async (province, carId, lat, lng, meta = null) => {
  try {
    const targetRef = ref(rtdb, `live/${province}/${carId}`);
    if (disconnectPath !== targetRef.toString()) {
      await onDisconnect(targetRef).remove();
      disconnectPath = targetRef.toString();
    }
    if (meta && typeof meta === "object") {
      await update(targetRef, {
        lat,
        lng,
        name: meta.name || "",
        phonenumber: meta.phonenumber || "",
        status: meta.status || "available",
        care: meta.care || null,
        updatedAt: Date.now()
      });
    } else {
      await update(targetRef, {
        lat,
        lng,
        updatedAt: Date.now()
      });
    }
  } catch (err) {
    console.error("Lỗi ghi vị trí lên RTDB:", err);
  }
};

/* ---- Pothole reports: RTDB, per province (drivers only) ---- */

let potholesRef = null;
let potholesProvince = null;

window.potholeApi = {
  async report(province, lat, lng, note = "") {
    const user = auth.currentUser;
    if (!user) throw new Error("not signed in");
    const id = `p_${Date.now()}_${user.uid.slice(-6)}`;
    await set(ref(rtdb, `potholes/${province}/${id}`), {
      lat,
      lng,
      reportedBy: user.uid,
      reportedAt: Date.now(),
      note: note || "",
      verifiedAt: 0,
      verifiedBy: ""
    });
    return id;
  },

  async verifyStillThere(province, id) {
    const user = auth.currentUser;
    if (!user) return;
    await update(ref(rtdb, `potholes/${province}/${id}`), {
      verifiedAt: Date.now(),
      verifiedBy: user.uid
    });
  },

  async remove(province, id) {
    await remove(ref(rtdb, `potholes/${province}/${id}`));
  }
};

window.watchPotholesForProvince = (province) => {
  if (province === potholesProvince) return;

  if (potholesRef) {
    off(potholesRef);
    potholesRef = null;
  }
  potholesProvince = province || null;

  if (!province) {
    if (typeof window.onPotholesUpdate === "function") {
      window.onPotholesUpdate(null, []);
    }
    return;
  }

  potholesRef = ref(rtdb, `potholes/${province}`);
  onValue(
    potholesRef,
    (snap) => {
      const data = snap.val() || {};
      const list = Object.entries(data).map(([id, p]) => ({ id, ...p }));
      if (typeof window.onPotholesUpdate === "function") {
        window.onPotholesUpdate(province, list);
      }
    },
    (err) => console.warn("Pothole watch error:", err)
  );
};