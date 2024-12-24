// Import the already-initialized Firebase services from firebaseConfig.js
import { auth, db, storage } from "./firebaseConfig.js";

// Import the specific Firebase methods you need from the CDN
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.17.2/firebase-auth.js";
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/9.17.2/firebase-firestore.js";
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/9.17.2/firebase-storage.js";

// Wrap your code inside DOMContentLoaded to ensure the DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  
  // DOM Elements
  const fileInput = document.getElementById("fileInput");
  const uploadBtn = document.getElementById("uploadBtn");
  const refreshFilesBtn = document.getElementById("refreshFilesBtn");
  const documentsList = document.getElementById("documentsList");
  const userMessageInput = document.getElementById("userMessage");
  const sendBtn = document.getElementById("sendBtn");
  const submitReturnBtn = document.getElementById("submitReturnBtn");
  const taxReturn = document.getElementById("returnEditor");
  const refreshTaxBtn = document.getElementById("refreshTaxBtn");
  const taxLiability = document.getElementById("taxLiability");
  const income = document.getElementById("income");
  const allowances = document.getElementById("allowances");
  const expenses = document.getElementById("expenses");

  // Example auth state observer
  onAuthStateChanged(auth, (user) => {
    if (user) {
      console.log("User signed in:", user.email);
      updateUI(true);
    } else {
      console.log("User signed out.");
      updateUI(false);
    }
  });

  // Function to update UI based on auth state
  function updateUI(isLoggedIn) {
    const elementsToShow = isLoggedIn ? ['uploadBtn', 'refreshFilesBtn', 'sendBtn', 'submitReturnBtn', 'refreshTaxBtn'] : [];
    const elementsToHide = isLoggedIn ? [] : ['uploadBtn', 'refreshFilesBtn', 'sendBtn', 'submitReturnBtn', 'refreshTaxBtn'];
    
    elementsToShow.forEach(id => {
      const elem = document.getElementById(id);
      if (elem) elem.style.display = 'block';
    });
    
    elementsToHide.forEach(id => {
      const elem = document.getElementById(id);
      if (elem) elem.style.display = 'none';
    });
  }

  // Event: Upload Document
  uploadBtn.addEventListener("click", () => {
    const file = fileInput.files[0];
    if (!file) {
      alert("Please select a file to upload.");
      return;
    }

    const storageRef = ref(storage, `uploads/${file.name}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on("state_changed",
      (snapshot) => {
        // Optional: Track upload progress here
      },
      (error) => {
        console.error("Upload failed:", error);
        alert("Upload failed: " + error.message);
      },
      () => {
        getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
          console.log("File available at:", downloadURL);
          alert("Upload successful!");

          // Optionally, add file info to Firestore
          addDoc(collection(db, "uploads"), {
            fileName: file.name,
            downloadURL: downloadURL,
            timestamp: serverTimestamp(),
          });
        });
      }
    );
  });

  // Event: Refresh Files
  refreshFilesBtn.addEventListener("click", async () => {
    try {
      const q = query(collection(db, "uploads"), orderBy("timestamp", "desc"));
      const querySnapshot = await getDocs(q);
      documentsList.innerHTML = ""; // Clear existing list

      querySnapshot.forEach((doc) => {
        const file = doc.data();
        const listItem = document.createElement("li");
        const link = document.createElement("a");
        link.href = file.downloadURL;
        link.textContent = file.fileName;
        link.target = "_blank";
        listItem.appendChild(link);
        documentsList.appendChild(listItem);
      });
    } catch (error) {
      console.error("Error fetching files:", error.message);
      alert("Error fetching files: " + error.message);
    }
  });

  // Event: Send Chat Message
  sendBtn.addEventListener("click", () => {
    const message = userMessageInput.value.trim();
    if (message === "") {
      alert("Please enter a message.");
      return;
    }
    
    // Handle sending message to AI Assistant (implement as needed)
    console.log("User message:", message);
    userMessageInput.value = "";
  });

  // Event: Submit Tax Return
  submitReturnBtn.addEventListener("click", async () => {
    const returnData = taxReturn.value.trim();
    if (!returnData) {
      alert("Please fill in the return details.");
      return;
    }

    try {
      // Replace with your API endpoint and handling logic
      const response = await fetch("/api/submitReturn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ returnData })
      });

      if (!response.ok) {
        throw new Error("Failed to submit return.");
      }

      const result = await response.json();
      console.log("Return submitted successfully:", result);
      alert("Return submitted successfully!");
    } catch (error) {
      console.error("Error submitting return:", error.message);
      alert("Error submitting return: " + error.message);
    }
  });

  // Event: Refresh Tax Calculation
  refreshTaxBtn.addEventListener("click", () => {
    // Implement tax calculation logic here
    // Example:
    taxLiability.textContent = "500"; // Update with actual calculated value
    income.textContent = "3000";
    allowances.textContent = "500";
    expenses.textContent = "450";
    alert("Tax calculation refreshed!");
  });

  // Event: Sign Out (Assuming you have a sign-out button)
  const signOutBtn = document.getElementById("signOutBtn");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", () => {
      signOut(auth)
        .then(() => {
          console.log("User signed out.");
          alert("Signed out successfully.");
        })
        .catch((error) => {
          console.error("Sign-out error:", error);
          alert("Sign-out failed: " + error.message);
        });
    });
  }

});
