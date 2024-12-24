// Import the necessary Firebase functions from the CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-storage.js";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "YAIzaSyAYXDpK8_dNn3f_c-n3q7_FCqoed-wRntk",
  authDomain: "taxstats-document-ai.firebaseapp.com",
  projectId: "taxstats-document-ai",
  storageBucket: "taxstats-document-ai.appspot.com",
  messagingSenderId: "532562763606",
  appId: "1:532562763606:web:3d9b6d04e4ed23700600f7",
};

// Initialize the Firebase app
const app = initializeApp(firebaseConfig);

// Initialize the services
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Export them for use in other modules
export { app, auth, db, storage };