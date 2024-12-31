// Import the necessary Firebase functions from the CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-storage.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-analytics.js";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAYXDpK8_dNn3f_c-n3q7_FCqoed-wRntk",
  authDomain: "taxstats-document-ai.firebaseapp.com",
  projectId: "taxstats-document-ai",
  storageBucket: "taxstats-document-ai.firebasestorage.app",
  messagingSenderId: "532562763606",
  appId: "1:532562763606:web:3d9b6d04e4ed23700600f7",
  measurementId: "G-MEASUREMENT_ID"
};

// Initialize the Firebase app
const app = initializeApp(firebaseConfig);

// Initialize the services
const auth = getAuth(app);
await setPersistence(auth, browserLocalPersistence);

const db = getFirestore(app);
await enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
        console.warn('Multiple tabs open, persistence disabled');
    } else if (err.code === 'unimplemented') {
        console.warn('Browser doesn\'t support persistence');
    }
});

const storage = getStorage(app);
const analytics = getAnalytics(app);

// Log initialization
logEvent(analytics, 'app_initialized');

// Export them for use in other modules
export { app, auth, db, storage, analytics };