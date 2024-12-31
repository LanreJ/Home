import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage, ref } from 'firebase/storage';
import { DocumentManager } from './modules/DocumentManager.js';
import { TaxFormManager } from './modules/TaxFormManager.js';
import { AIAssistant } from './modules/AIAssistant.js';
import { SubscriptionManager } from './modules/SubscriptionManager.js';

const firebaseConfig = {
    apiKey: "AIzaSyAYXDpK8_dNn3f_c-n3q7_FCqoed-wRntk",
    authDomain: "taxstats-document-ai.firebaseapp.com",
    projectId: "taxstats-document-ai",
    storageBucket: "taxstats-document-ai.firebasestorage.app",
    messagingSenderId: "532562763606",
    appId: "1:532562763606:web:3d9b6d04e4ed23700600f7"
};

// Initialize core services
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Initialize service managers
const documentManager = new DocumentManager(storage, db);
const taxFormManager = new TaxFormManager(db);
const aiAssistant = new AIAssistant();
const subscriptionManager = new SubscriptionManager(db);

// Auth state management
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '/login.html';
        return;
    }

    const isSubscribed = await subscriptionManager.checkSubscription(user.uid);
    if (!isSubscribed) {
        window.location.href = '/subscribe.html';
        return;
    }

    // Initialize services with user context
    await initializeServices(user.uid);
    setupEventListeners();
    updateUIState();
});

async function initializeServices(userId) {
    await documentManager.initialize(userId);
    await taxFormManager.initialize(userId);
    await aiAssistant.initialize(userId);
    
    // Load existing documents and tax data
    const documents = await documentManager.loadDocuments();
    const taxData = await taxFormManager.loadCurrentReturn();
    
    updateDocumentList(documents);
    updateTaxForm(taxData);
}

function setupEventListeners() {
    // Document upload handling
    document.getElementById('uploadBtn').addEventListener('click', handleDocumentUpload);
    document.getElementById('generateBtn').addEventListener('click', handleFormGeneration);
    document.getElementById('aiAssistBtn').addEventListener('click', toggleAIAssistant);
    
    // Subscribe to real-time updates
    documentManager.subscribeToUpdates(updateDocumentList);
    taxFormManager.subscribeToUpdates(updateTaxForm);
}

// =============================
// Element References
// =============================

// File Upload and Refresh Elements
const uploadBtn = document.getElementById("uploadBtn");     // Button to trigger file upload
const refreshBtn = document.getElementById("refreshBtn");   // Button to refresh the file list
const fileListEl = document.getElementById("fileList");     // Element to display the list of files

// Chat Elements
const sendChatBtn = document.getElementById("sendBtn");     // Button to send chat message
const userMessageInput = document.getElementById("chatInput"); // Input field for user message
const chatWindow = document.getElementById("chatWindow");   // Display area for chat messages

// Submit Return Elements
const submitReturnBtn = document.getElementById("submitReturn"); // Button to submit tax return

// PDF Viewer Elements
const prevPageBtn = document.getElementById("prevPage");     // Button to go to the previous PDF page
const nextPageBtn = document.getElementById("nextPage");     // Button to go to the next PDF page
const taxViewer = document.getElementById("taxViewer");     // Container to display PDF pages

// Logout Element
const logoutBtn = document.getElementById("logoutBtn");     // Button to log out

// Tax Calculator Element
const refreshTaxBtn = document.getElementById("refreshTaxBtn"); // Button to refresh tax calculations

// =============================
// 1. Consolidated Upload and Refresh Functions
// =============================

/**
 * Uploads a document to Firebase Storage and refreshes the file list upon success.
 */
async function uploadDocument() {
  if (!uploadBtn || !fileListEl) return;

  // Create a hidden file input element
  const fileInput = document.createElement("input");
  fileInput.type = "file";

  // Handle file selection
  fileInput.onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Disable the upload button and indicate upload in progress
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Uploading...";

    try {
      const uploadPath = `uploads/${file.name}`;
      const uploadRef = storageRef.child(uploadPath);
      await uploadRef.put(file);
      alert("File uploaded successfully!");
      await refreshFiles(); // Refresh the file list after successful upload
    } catch (error) {
      console.error("Upload error:", error);
      alert("Upload failed: " + error.message);
    } finally {
      // Re-enable the upload button and reset its text
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Upload Document";
      document.body.removeChild(fileInput); // Clean up by removing the file input
    }
  };

  // Append the file input to the body and trigger a click to open the file dialog
  document.body.appendChild(fileInput);
  fileInput.click();
}

/**
 * Refreshes the list of uploaded files from Firebase Storage.
 */
async function refreshFiles() {
  if (!fileListEl) return;

  fileListEl.innerHTML = "Loading files...";

  try {
    const uploadsList = await storageRef.child("uploads").listAll();
    fileListEl.innerHTML = ""; // Clear the current list

    // Iterate through each file reference and create list items with download links
    uploadsList.items.forEach(async (itemRef) => {
      const url = await itemRef.getDownloadURL();
      const listItem = document.createElement("li");
      listItem.textContent = itemRef.name + " ";

      const downloadLink = document.createElement("a");
      downloadLink.href = url;
      downloadLink.textContent = "Download";
      downloadLink.target = "_blank";
      downloadLink.rel = "noopener noreferrer";

      listItem.appendChild(downloadLink);
      fileListEl.appendChild(listItem);
    });
  } catch (error) {
    console.error("Refresh error:", error);
    fileListEl.innerHTML = "Failed to load files.";
  }
}

// Attach event listeners to upload and refresh buttons
if (uploadBtn) {
  uploadBtn.addEventListener("click", uploadDocument);
}

if (refreshBtn) {
  refreshBtn.addEventListener("click", refreshFiles);
}

// =============================
// 2. Chat with AI Assistant
// =============================

/**
 * Sends a message to the AI assistant and displays the response.
 */
if (sendChatBtn && userMessageInput && chatWindow) {
  sendChatBtn.addEventListener("click", async () => {
    const message = userMessageInput.value.trim();
    if (!message) return;

    // Check if the user is authenticated
    const user = auth.currentUser;
    if (!user) {
      window.location.href = "login.html"; // Redirect to login if not authenticated
      return;
    }

    try {
      const idToken = await user.getIdToken(); // Get the user's ID token for authentication

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}` // Include the ID token in the Authorization header
        },
        body: JSON.stringify({ message }) // Ensure the backend expects 'message'
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Chat request failed.");
      }

      const { reply } = await response.json(); // Destructure the reply from the response

      // Append the user message and AI reply to the chat window
      chatWindow.innerHTML += `<p><strong>You:</strong> ${message}</p>`;
      chatWindow.innerHTML += `<p><strong>AI:</strong> ${reply}</p>`;
    } catch (error) {
      console.error("Chat error:", error);
      alert(`Chat failed: ${error.message}`);
    } finally {
      userMessageInput.value = ""; // Clear the input field
    }
  });
}

// AI Chat functionality
async function sendMessage(message) {
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');

    const idToken = await user.getIdToken(true);
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ message })
    });

    if (!response.ok) throw new Error('Chat request failed');
    return await response.json();
  } catch (error) {
    console.error('Chat error:', error);
    throw error;
  }
}

// Export functions
window.sendMessage = sendMessage;

// =============================
// 3. Submit Return
// =============================

/**
 * Submits the tax return data to the backend.
 */
if (submitReturnBtn) {
  submitReturnBtn.addEventListener("click", async () => {
    // Gather return data from form inputs (ensure these elements exist in your HTML)
    const income = parseFloat(document.getElementById("incomeInput").value) || 0;
    const allowances = parseFloat(document.getElementById("allowancesInput").value) || 0;
    const expenses = parseFloat(document.getElementById("expensesInput").value) || 0;
    const liability = income - allowances - expenses;

    const returnData = {
      income,
      allowances,
      expenses,
      liability
    };

    // Check if the user is authenticated
    const user = auth.currentUser;
    if (!user) {
      window.location.href = "login.html"; // Redirect to login if not authenticated
      return;
    }

    try {
      const idToken = await user.getIdToken(); // Get the user's ID token

      const response = await fetch("/api/submitReturn", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}` // Include the ID token for authentication
        },
        body: JSON.stringify(returnData) // Send the return data
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Submit request failed.");
      }

      alert("Your return was submitted successfully.");
      // Optionally, redirect to a confirmation page or reset the form
    } catch (error) {
      console.error("Submit Return error:", error);
      alert(`Submission failed: ${error.message}`);
    }
  });
}

// =============================
// 4. PDF Viewer & Pagination
// =============================

class TaxReturnViewer {
    constructor(container, options = {}) {
        this.container = container;
        this.currentPage = 1;
        this.zoom = 1.0;
        this.pdfDoc = null;
        this.assistantEnabled = options.assistantEnabled || false;
        
        this.initializeControls();
    }

    initializeControls() {
        this.pageControls = document.createElement('div');
        this.pageControls.className = 'pdf-controls';
        this.pageControls.innerHTML = `
            <button id="prevPage" disabled>Previous</button>
            <span id="pageNum"></span>
            <button id="nextPage" disabled>Next</button>
            <button id="zoomIn">+</button>
            <button id="zoomOut">-</button>
            <button id="download">Download PDF</button>
        `;
        this.container.appendChild(this.pageControls);

        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('prevPage').addEventListener('click', () => this.prevPage());
        document.getElementById('nextPage').addEventListener('click', () => this.nextPage());
        document.getElementById('zoomIn').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoomOut').addEventListener('click', () => this.zoomOut());
        document.getElementById('download').addEventListener('click', () => this.downloadPDF());
    }

    async loadDocument(url) {
        try {
            this.pdfDoc = await pdfjsLib.getDocument(url).promise;
            this.currentPage = 1;
            await this.renderPage();
            this.updateControls();
        } catch (error) {
            console.error("Error loading document:", error);
            this.container.innerHTML = "Failed to load document.";
        }
    }

    async renderPage() {
        try {
            const page = await this.pdfDoc.getPage(this.currentPage);
            const viewport = page.getViewport({ scale: this.zoom });
            
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            this.container.querySelector('.pdf-content')?.remove();
            canvas.className = 'pdf-content';
            this.container.appendChild(canvas);
            
            this.updatePageNumber();
        } catch (error) {
            console.error("Error rendering page:", error);
            this.container.innerHTML = "Failed to render page.";
        }
    }

    updateControls() {
        const prevBtn = document.getElementById('prevPage');
        const nextBtn = document.getElementById('nextPage');
        
        prevBtn.disabled = this.currentPage <= 1;
        nextBtn.disabled = this.currentPage >= this.pdfDoc.numPages;
    }

    updatePageNumber() {
        document.getElementById('pageNum').textContent = 
            `Page ${this.currentPage} of ${this.pdfDoc.numPages}`;
    }

    async downloadPDF() {
        // Implementation for PDF download
    }
}

// Initialize viewer
const taxViewer = new TaxReturnViewer(document.getElementById('taxViewer'), {
    assistantEnabled: true
});

// =============================
// 5. Logout with Enhanced Error Handling
// =============================

/**
 * Logs out the current user and handles any errors.
 */
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    auth.signOut()
      .then(() => {
        alert("You have been logged out.");
        window.location.href = "login.html"; // Redirect to login page after logout
      })
      .catch((error) => {
        console.error("Logout error:", error);
        alert("Logout failed: " + error.message);
      });
  });
}

// =============================
// 6. Tax Calculator (Optional Enhancement)
// =============================

if (refreshTaxBtn) {
  refreshTaxBtn.addEventListener("click", () => {
    // Retrieve values from input fields (ensure these exist in your HTML)
    const incomeInput = document.getElementById("incomeInput");
    const allowancesInput = document.getElementById("allowancesInput");
    const expensesInput = document.getElementById("expensesInput");

    // Elements to display the calculated values
    const taxLiabilityEl = document.getElementById("taxLiability");
    const incomeEl = document.getElementById("income");
    const allowancesEl = document.getElementById("allowances");
    const expensesEl = document.getElementById("expenses");
    const liabilityEl = document.getElementById("liability");

    if (incomeInput && allowancesInput && expensesInput && taxLiabilityEl && incomeEl && allowancesEl && expensesEl && liabilityEl) {
      const income = parseFloat(incomeInput.value) || 0;
      const allowances = parseFloat(allowancesInput.value) || 0;
      const expenses = parseFloat(expensesInput.value) || 0;
      const liability = income - allowances - expenses;

      taxLiabilityEl.textContent = `£${liability > 0 ? liability : 0}`;
      incomeEl.textContent = `£${income}`;
      allowancesEl.textContent = `£${allowances}`;
      expensesEl.textContent = `£${expenses}`;
      liabilityEl.textContent = `£${liability > 0 ? liability : 0}`;

      alert("Tax calculation refreshed!");
    } else {
      console.error("Tax calculator elements not found.");
      alert("Failed to refresh tax calculations. Please check the form.");
    }
  });
}

// =============================
// 7. Additional Enhancements and Best Practices
// =============================

// Ensure all async functions have proper error handling.
// Use event delegation if dynamically adding elements (e.g., clickable file list items).
// Keep UI responsive by providing feedback during long operations (e.g., loading indicators).

document.querySelector('#submitFormButton').addEventListener('click', () => {
  const formData = gatherFormData();
  // Make call to updateSA100 with formData
  // Real-time update of values
});