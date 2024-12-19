// Import the necessary Firebase functions
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth"; // For Authentication
import { getFirestore } from "firebase/firestore"; // For Firestore
import { getStorage } from "firebase/storage"; // For Cloud Storage

// Firebase configuration object
const firebaseConfig = {
  apiKey: "AIzaSyAYXDpK8_dNn3f_c-n3q7_FCqoed-wRntk",
  authDomain: "taxstats-document-ai.firebaseapp.com",
  projectId: "taxstats-document-ai",
  storageBucket: "taxstats-document-ai.appspot.com",
  messagingSenderId: "532562763606",
  appId: "1:532562763606:web:3d9b6d04e4ed23700600f7",
};

// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app); // Firebase Authentication
export const db = getFirestore(app); // Firestore Database
export const storage = getStorage(app); // Firebase Storage
