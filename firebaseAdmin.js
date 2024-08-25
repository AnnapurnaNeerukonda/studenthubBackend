// backend/firebaseAdmin.js
const admin = require("firebase-admin");
const serviceAccount = require("./newkey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://studenthub-27857.firebaseio.com"
});

const db = admin.firestore();

module.exports = { admin, db };
