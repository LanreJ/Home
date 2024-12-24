import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { auth, db, storage } from "../firebaseConfig.js"; // Adjust the path as necessary
import { onAuthStateChanged, signOut } from "firebase/auth"; // Import signOut
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

// DOM Elements
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const documentsList = document.getElementById("documentsList");
const userMessageInput = document.getElementById("userMessage");
const sendBtn = document.getElementById("sendBtn");
const chatWindow = document.getElementById("chatWindow");
const taxLiabilityEl = document.getElementById("taxLiability");
const incomeEl = document.getElementById("income");
const allowancesEl = document.getElementById("allowances");
const expensesEl = document.getElementById("expenses");
const refreshCalcBtn = document.getElementById("refreshCalcBtn");
const refreshFilesBtn = document.getElementById("refreshFilesBtn");
const submitReturnBtn = document.getElementById("submitReturnBtn");
const signOutBtn = document.getElementById("signOutBtn"); // Sign out button

// Authentication state observer
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("User signed in:", user.email);
    // No need to store the token manually, Firebase handles this
  } else {
    console.log("User signed out");
    // Redirect to login page or take other action
  }
  updateUI(user); // Update UI based on authentication state
});

// Update UI based on user authentication status
function updateUI(user) {
  const loginSection = document.getElementById("loginSection");
  const userSection = document.getElementById("userSection");
  const userProfileEmail = document.getElementById("userProfileEmail");

  if (user) {
    // Show elements for signed-in users
    loginSection.style.display = "none";
    userSection.style.display = "block";
    userProfileEmail.textContent = user.email;
  } else {
    // Show elements for signed-out users
    loginSection.style.display = "block";
    userSection.style.display = "none";
  }
}

// Function to call API endpoints with authentication
async function callApi(endpoint, options = {}) {
  try {
    const token = await auth.currentUser.getIdToken();
    options.headers = options.headers || {};
    options.headers.Authorization = `Bearer ${token}`;
    const response = await fetch(endpoint, options);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "API call failed");
    }
    return response.json();
  } catch (error) {
    console.error("API call error:", error);
    throw error; // Re-throw to handle at call site
  }
}

// Function to add a message to the chat window
function addToChat(role, message) {
  const line = document.createElement("div");
  line.classList.add("message");
  line.innerHTML = `<strong>${role}:</strong> ${message}`;
  chatWindow.appendChild(line);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Event: Upload document
uploadBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) return alert("Please select a file first.");

  // Get a reference to the storage location
  const storageRef = ref(
    storage,
    `user-uploads/${auth.currentUser.uid}/${file.name}`
  );
  const uploadTask = uploadBytesResumable(storageRef, file);

  try {
    const snapshot = await uploadTask;
    // Get the download URL of the uploaded file
    const downloadURL = await getDownloadURL(snapshot.ref);
    console.log("File uploaded and available at", downloadURL);

    await addDoc(collection(db, "userFiles"), {
      fileName: file.name,
      storagePath: downloadURL, // Or the storage path if needed
      userId: auth.currentUser.uid,
      uploadedAt: serverTimestamp(),
    });

    alert("File uploaded successfully!");
    fileInput.value = ""; // Clear the file input
    refreshFiles(); // Refresh the files list
  } catch (error) {
    console.error("Error uploading file:", error.message);
    alert("Error uploading file: " + error.message);
  }
});

// Event: Send message to AI Assistant
sendBtn.addEventListener("click", async () => {
  const userMessage = userMessageInput.value.trim();
  if (!userMessage) return alert("Please enter a message.");

  addToChat("You", userMessage);
  userMessageInput.value = "";

  try {
    const response = await callApi("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userMessage }),
    });
    addToChat("AI Assistant", response.reply);
  } catch (error) {
    console.error("Error sending message:", error.message);
    alert("Error sending message: " + error.message);
  }
});

// Event: Refresh tax calculation
refreshCalcBtn.addEventListener("click", async () => {
  try {
    const response = await callApi("/api/getTaxLiability");
    taxLiabilityEl.textContent = `Tax Liability: £${response.liability}`;
    incomeEl.textContent = `Income: £${response.income}`;
    allowancesEl.textContent = `Allowances: £${response.allowances}`;
    expensesEl.textContent = `Expenses: £${response.expenses}`;
  } catch (error) {
    console.error("Error refreshing tax calculation:", error.message);
    alert("Error refreshing tax calculation: " + error.message);
  }
});

// Event: Refresh files list
refreshFilesBtn.addEventListener("click", refreshFiles);

// Function to refresh uploaded files
async function refreshFiles() {
  try {
    const response = await callApi("/api/listDocuments");
    const files = response.files;
    documentsList.innerHTML = ""; // Clear existing list

    if (files.length === 0) {
      documentsList.innerHTML = "<p>No documents uploaded.</p>";
      return;
    }

    files.forEach((file) => {
      const listItem = document.createElement("li");
      const link = document.createElement("a");
      link.href = file.storagePath;
      link.textContent = file.fileName;
      link.target = "_blank";
      listItem.appendChild(link);
      documentsList.appendChild(listItem);
    });
  } catch (error) {
    console.error("Error fetching files:", error.message);
    alert("Error fetching files: " + error.message);
  }
}

// Event: Submit tax return
submitReturnBtn.addEventListener("click", async () => {
  const returnData = taxReturn.value.trim();
  if (!returnData) return alert("Please fill in the return details.");

  try {
    const response = await callApi("/api/submitReturn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnData }),
    });
    alert(response.message);
  } catch (error) {
    console.error("Error submitting return:", error.message);
    alert("Error submitting return: " + error.message);
  }
});

// Sign out button event listener
signOutBtn.addEventListener("click", () => {
  signOut(auth)
    .then(() => {
      alert("Signed out successfully.");
    })
    .catch((error) => {
      console.error("Sign out error:", error);
      alert("Error signing out: " + error.message);
    });
});

// Initialize file list on page load
refreshFiles();

// Function to refresh tax calculation
function refreshTaxCalculation() {
  // Implement your tax calculation logic here
  console.log("Refreshing tax calculation...");
  // Example: Fetch updated tax data from Firestore and update the UI
}

// Function to refresh file list
function refreshFileList() {
  // Implement your file listing logic here
  console.log("Refreshing file list...");
  // Example: Fetch user files from Firestore and display them
}

// Function to submit tax return
function submitTaxReturn() {
  // Implement your submit tax return logic here
  console.log("Submitting tax return...");
  // Example: Send edited tax return data to Firestore or your backend
}
