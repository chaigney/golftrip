// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";

const firebaseConfig = {
  // ...your config...
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Optional: offline cache
enableIndexedDbPersistence(db).catch(() => {
  // ignore if already enabled in another tab or unsupported
});

