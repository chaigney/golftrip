// src/firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";

// OPTION A: hardcode (fastest). Paste your values here:
const directConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "PASTE_API_KEY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "PASTE_AUTH_DOMAIN",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "PASTE_PROJECT_ID",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "PASTE_STORAGE_BUCKET",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "PASTE_MSG_SENDER_ID",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "PASTE_APP_ID",
};

if (!directConfig.projectId) {
  console.error("Missing Firebase config. Set VITE_FIREBASE_* env vars or paste config into src/firebase.js");
}

const app = getApps().length ? getApp() : initializeApp(directConfig);
export const db = getFirestore(app);

// Offline cache (safe to ignore errors)
enableIndexedDbPersistence(db).catch(() => {});

console.log("Firebase OK:", app.options.projectId);

