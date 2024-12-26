document.addEventListener("DOMContentLoaded", () => {
  // =====================================================
  // Firebase Setup
  // =====================================================
  const auth = firebase.auth();
  const storage = firebase.storage(); // Existing storage initialization
  const provider = new firebase.auth.GoogleAuthProvider();

  // =====================================================
  // Initialize Firebase Storage with Custom Bucket
  // =====================================================
  const storageRef = firebase.storage("gs://taxstats-document-ai.firebasestorage.app").ref();

  // =====================================================
  // DOM Elements
  // =====================================================
  const logoutBtn = document.getElementById("logoutBtn");

  // Left Panel
  const uploadDocBtn = document.getElementById("uploadDocBtn");
  const refreshFilesBtn = document.getElementById("refreshFilesBtn");
  const filesUl = document.getElementById("filesUl");

  // Center Panel (AI)
  const chatWindow = document.getElementById("chatWindow");
  const userMessageInput = document.getElementById("userMessage");
  const sendBtn = document.getElementById("sendBtn");

  // Right Panel (Tax Calculator)
  const taxLiabilityEl = document.getElementById("taxLiability");
  const incomeEl = document.getElementById("income");
  const allowancesEl = document.getElementById("allowances");
  const expensesEl = document.getElementById("expenses");
  const refreshTaxBtn = document.getElementById("refreshTaxBtn");
  const returnEditor = document.getElementById("returnEditor");
  const submitReturnBtn = document.getElementById("submitReturnBtn");

  // ========== DOM Elements for Toggling ========== 
  const signupForm = document.getElementById("signup-form");
  const loginForm = document.getElementById("login-form");
  const toggleSignupBtn = document.getElementById("toggle-signup");
  const toggleLoginBtn = document.getElementById("toggle-login");

  // ========== Show / Hide Forms ==========
  window.showSignup = function() {
    signupForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
    toggleSignupBtn.classList.add("active");
    toggleLoginBtn.classList.remove("active");
  };

  window.showLogin = function() {
    signupForm.classList.add("hidden");
    loginForm.classList.remove("hidden");
    toggleSignupBtn.classList.remove("active");
    toggleLoginBtn.classList.add("active");
  };

  // ========== Google Sign-In ==========
  window.googleSignIn = function() {
    auth.signInWithPopup(provider)
      .then((result) => {
        console.log("Google sign-in success:", result.user.email);
        alert("Google Sign-In successful! Redirecting to dashboard...");
        window.location.href = "dashboard.html";
      })
      .catch((error) => {
        console.error("Google sign-in error:", error.message);
        alert("Google sign-in failed: " + error.message);
      });
  };

  // ========== Sign Up Form Submission ==========
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("signup-username").value.trim();
    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value.trim();

    if (!email || !password) {
      alert("Please fill out all required fields.");
      return;
    }

    try {
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      console.log("User signed up:", userCredential.user.email, "Username:", username);
      // Optionally store username in Firestore or do other tasks
      alert("Sign-up successful! Redirecting to dashboard...");
      window.location.href = "dashboard.html";
    } catch (error) {
      console.error("Sign-up error:", error.message);
      alert("Sign-up failed: " + error.message);
    }
  });

  // ========== Login Form Submission ==========
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value.trim();

    if (!email || !password) {
      alert("Please fill out all required fields.");
      return;
    }

    try {
      const userCredential = await auth.signInWithEmailAndPassword(email, password);
      console.log("User logged in:", userCredential.user.email);
      alert("Login successful! Redirecting to dashboard...");
      window.location.href = "dashboard.html";
    } catch (error) {
      console.error("Login error:", error.message);
      alert("Login failed: " + error.message);
    }
  });

  // =====================================================
  // Logout
  // =====================================================
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      auth
        .signOut()
        .then(() => {
          console.log("User signed out.");
          window.location.href = "login.html";
        })
        .catch((error) => {
          console.error("Logout error:", error.message);
          alert("Logout failed: " + error.message);
        });
    });
  }

  // =====================================================
  // Upload Document
  // =====================================================
  if (uploadDocBtn) {
    uploadDocBtn.addEventListener("click", () => {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".pdf,.doc,.docx,.txt"; // Adjust as needed
      fileInput.style.display = "none";

      document.body.appendChild(fileInput);
      fileInput.click();

      fileInput.addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        try {
          uploadDocBtn.textContent = "Uploading...";
          uploadDocBtn.disabled = true;

          // Unique file name
          const uploadTask = storageRef.child(`uploads/${file.name}_${Date.now()}`).put(file);
          const snapshot = await uploadTask;
          const downloadURL = await snapshot.ref.getDownloadURL();

          console.log("File available at:", downloadURL);
          alert("Document uploaded successfully!");

          // Refresh the file list
          refreshFiles();
        } catch (error) {
          console.error("Upload error:", error.message);
          alert("Upload failed: " + error.message);
        } finally {
          uploadDocBtn.textContent = "Upload Document";
          uploadDocBtn.disabled = false;
          document.body.removeChild(fileInput);
        }
      });
    });
  }

  // =====================================================
  // Refresh Files
  // =====================================================
  async function refreshFiles() {
    if (!filesUl) return;
    filesUl.innerHTML = "<li>Loading files...</li>";

    try {
      // Reference to the 'uploads' folder in the custom bucket
      const listRef = storageRef.child("uploads");
      const res = await listRef.listAll();
      const files = await Promise.all(
        res.items.map(async (itemRef) => {
          const url = await itemRef.getDownloadURL();
          return { name: itemRef.name, url };
        })
      );

      displayFiles(files);
    } catch (error) {
      console.error("Error fetching files:", error.message);
      filesUl.innerHTML = "<li>Error loading files.</li>";
      alert("Failed to refresh files: " + error.message);
    }
  }

  function displayFiles(files) {
    filesUl.innerHTML = "";
    if (!files || files.length === 0) {
      filesUl.innerHTML = "<li>No documents uploaded.</li>";
      return;
    }

    files.forEach((file) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = file.url;
      a.textContent = file.name;
      a.target = "_blank";
      li.appendChild(a);
      filesUl.appendChild(li);
    });
  }

  if (refreshFilesBtn) {
    refreshFilesBtn.addEventListener("click", () => {
      refreshFiles();
    });
  }

  // Auto-refresh on load if user is authenticated
  auth.onAuthStateChanged((user) => {
    if (user && window.location.pathname.endsWith("dashboard.html")) {
      refreshFiles();
    }
  });

  // =====================================================
  // Chat with AI
  // =====================================================
  if (sendBtn) {
    sendBtn.addEventListener("click", async () => {
      const message = userMessageInput.value.trim();
      if (!message) {
        alert("Please enter a message.");
        return;
      }

      try {
        // Acquire user token
        const user = auth.currentUser;
        if (!user) {
          alert("Not authenticated, cannot send message.");
          return;
        }
        const idToken = await user.getIdToken();

        // Send to your backend route /api/chat
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ userMessage: message }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to communicate with AI.");
        }

        const data = await response.json();
        const reply = data.reply;

        // Display conversation in the chat window
        chatWindow.innerHTML += `<p><strong>You:</strong> ${message}</p>`;
        chatWindow.innerHTML += `<p><strong>AI:</strong> ${reply}</p>`;
      } catch (error) {
        console.error("Error in chat:", error.message);
        alert("Error: " + error.message);
      } finally {
        userMessageInput.value = "";
      }
    });
  }

  // =====================================================
  // Tax Calculator
  // =====================================================
  if (refreshTaxBtn) {
    refreshTaxBtn.addEventListener("click", () => {
      // Dummy calculation for demonstration
      taxLiabilityEl.textContent = "500";
      incomeEl.textContent = "3000";
      allowancesEl.textContent = "500";
      expensesEl.textContent = "450";
      alert("Tax calculation refreshed!");
    });
  }

  // =====================================================
  // Submit Return
  // =====================================================
  if (submitReturnBtn) {
    submitReturnBtn.addEventListener("click", async () => {
      const returnData = returnEditor.value.trim();
      if (!returnData) {
        alert("Please fill in the return details.");
        return;
      }

      try {
        const user = auth.currentUser;
        if (!user) {
          alert("User not authenticated.");
          return;
        }
        const idToken = await user.getIdToken();

        const response = await fetch("/api/submitReturn", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ returnData }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to submit return.");
        }

        const result = await response.json();
        console.log("Return submitted successfully:", result);
        alert("Return submitted successfully!");
      } catch (error) {
        console.error("Error submitting return:", error.message);
        alert("Error submitting return: " + error.message);
      }
    });
  }

  // Upload File:
  const storage = firebase.storage();

  document.getElementById("uploadButton").addEventListener("click", () => {
    const fileInput = document.getElementById("fileInput");
    const file = fileInput.files[0];

    if (file) {
      const storageRef = storage.ref(`uploads/${file.name}`);
      storageRef.put(file).then(() => {
        alert("File uploaded successfully!");
        refreshFiles();
      }).catch((error) => {
        console.error("Upload failed:", error);
        alert("Failed to upload file. Check the console for details.");
      });
    } else {
      alert("No file selected.");
    }
  });

  function refreshFiles() {
    const storageRef = storage.ref("uploads");
    const fileListElement = document.getElementById("fileList");

    fileListElement.innerHTML = "Loading files...";
    storageRef.listAll().then((result) => {
      fileListElement.innerHTML = ""; // Clear previous list
      result.items.forEach((fileRef) => {
        fileRef.getDownloadURL().then((url) => {
          const listItem = document.createElement("li");
          listItem.textContent = fileRef.name;
          const link = document.createElement("a");
          link.href = url;
          link.textContent = " [Download]";
          link.target = "_blank";
          listItem.appendChild(link);
          fileListElement.appendChild(listItem);
        });
      });
    }).catch((error) => {
      console.error("Failed to load files:", error);
      fileListElement.innerHTML = "Failed to load files. Check the console for details.";
    });
  }

  // Attach to refresh button
  document.getElementById("refreshButton").addEventListener("click", refreshFiles);

  // Additional Code Block:

  const storageRefList = firebase.storage().ref("uploads/");
  storageRefList.listAll().then((res) => {
    console.log(res.items); // Log the files
  }).catch((err) => {
    console.error("Error listing files:", err);
  });
});
