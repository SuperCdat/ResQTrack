// One-off upload of transportationdata.json to Firebase.
// Setup: npm i firebase-admin, then save a service account key from
// Firebase console > Project settings > Service accounts as serviceAccount.json
// Run: node seed.js   (re-running resets live positions to the base positions)
const admin = require("firebase-admin");
const data = require("./transportationdata.json");

admin.initializeApp({
  credential: admin.credential.cert(require("./serviceAccount.json")),
  databaseURL: "https://resqtrack-10d06-default-rtdb.firebaseio.com"
});

(async () => {
  const live = {};

  for (const [province, list] of Object.entries(data)) {
    live[province] = {};
    list.forEach((a, i) => {
      a.id = "a" + (i + 1);
      live[province][a.id] = { lat: a.pos[0], lng: a.pos[1] };
    });
  }

  await admin.firestore().doc("catalog/ambulances").set(data);
  await admin.database().ref("live").set(live);
  await admin.database().ref("catalogVersion").set(Date.now());

  console.log("Seeded.");
  process.exit(0);
})();
