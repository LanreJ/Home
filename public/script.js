import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { DocumentManager } from './modules/DocumentManager.js';
import { TaxFormManager } from './modules/TaxFormManager.js';
import { AIAssistant } from './modules/AIAssistant.js';
import { SubscriptionManager } from './modules/SubscriptionManager.js';
import { BankManager } from './modules/BankManager.js';

const firebaseConfig = {
    apiKey: "AIzaSyAYXDpK8_dNn3f_c-n3q7_FCqoed-wRntk",
    authDomain: "taxstats-document-ai.firebaseapp.com",
    projectId: "taxstats-document-ai",
    storageBucket: "taxstats-document-ai.firebasestorage.app",
    messagingSenderId: "532562763606",
    appId: "1:532562763606:web:3d9b6d04e4ed23700600f7"
};

// Initialize Firebase and services
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Initialize service managers
const documentManager = new DocumentManager(storage, db);
const taxFormManager = new TaxFormManager(db);
const aiAssistant = new AIAssistant();
const subscriptionManager = new SubscriptionManager(db);
const bankManager = new BankManager();

// UI Elements
const elements = {
    upload: document.getElementById('uploadBtn'),
    bankConnect: document.getElementById('connectBankBtn'),
    aiChat: document.getElementById('aiChatBtn'),
    saveForm: document.getElementById('saveFormBtn'),
    submitForm: document.getElementById('submitFormBtn'),
    downloadPdf: document.getElementById('downloadPdfBtn'),
    progress: document.getElementById('progressIndicator')
};

// Auth state management
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '/login.html';
        return;
    }

    try {
        // Check subscription
        const isSubscribed = await subscriptionManager.checkSubscription(user.uid);
        if (!isSubscribed) {
            window.location.href = '/subscribe.html';
            return;
        }

        // Initialize components
        await initializeComponents(user.uid);
        setupEventListeners();
        updateProgress();
    } catch (error) {
        console.error('Dashboard initialization failed:', error);
    }
});

async function initializeComponents(userId) {
    await Promise.all([
        documentManager.initialize(userId),
        taxFormManager.initialize(userId),
        aiAssistant.initialize(userId),
        bankManager.initialize(userId)
    ]);
    
    await loadInitialData();
}

async function loadInitialData() {
    const [documents, bankAccounts, taxForm] = await Promise.all([
        documentManager.getDocuments(),
        bankManager.getAccounts(),
        taxFormManager.getCurrentForm()
    ]);

    updateDocumentList(documents);
    updateBankAccounts(bankAccounts);
    updateTaxForm(taxForm);
}

function setupEventListeners() {
    elements.upload.addEventListener('click', handleDocumentUpload);
    elements.bankConnect.addEventListener('click', handleBankConnection);
    elements.aiChat.addEventListener('click', toggleAIChat);
    elements.saveForm.addEventListener('click', handleFormSave);
    elements.submitForm.addEventListener('click', handleFormSubmit);
    elements.downloadPdf.addEventListener('click', handlePdfDownload);
}

// Event Handlers
async function handleDocumentUpload(event) {
    try {
        const files = event.target.files;
        showLoader('Uploading documents...');
        
        for (const file of files) {
            await documentManager.uploadAndProcess(file);
        }
        
        updateProgress();
    } catch (error) {
        showError('Document upload failed');
    } finally {
        hideLoader();
    }
}

async function handleBankConnection() {
    // Implement bank connection logic
}

function toggleAIChat() {
    const aiChatModal = document.getElementById('aiChatModal');
    aiChatModal.style.display = aiChatModal.style.display === 'none' ? 'block' : 'none';
}

async function handleFormSave() {
    const formData = gatherFormData();
    await taxFormManager.saveDraft(formData);
    alert('Draft saved successfully');
}

async function handleFormSubmit(event) {
    event.preventDefault();
    const formData = gatherFormData();
    
    try {
        showLoader('Submitting tax return...');
        
        if (!await validateFormData(formData)) {
            return;
        }

        const aiSuggestions = await aiAssistant.reviewForm(formData);
        if (aiSuggestions.hasWarnings) {
            if (!await confirmSubmission(aiSuggestions.warnings)) {
                return;
            }
        }

        const result = await taxFormManager.submitReturn(formData);
        showSuccess('Tax return submitted successfully');
        updateProgress();
        
        if (result.downloadUrl) {
            offerDownload(result.downloadUrl);
        }

    } catch (error) {
        console.error('Submission failed:', error);
        showError('Failed to submit tax return');
    } finally {
        hideLoader();
    }
}

async function handlePdfDownload() {
    const pdfUrl = await taxFormManager.generatePDF();
    window.open(pdfUrl, '_blank');
}

function gatherFormData() {
    const formData = {};
    const form = document.querySelector('#taxForm');
    const inputs = form.querySelectorAll('input, select, textarea');
    
    inputs.forEach(input => {
        if (input.type === 'checkbox') {
            formData[input.name] = input.checked;
        } else if (input.type === 'file') {
            formData[input.name] = input.files;
        } else {
            formData[input.name] = input.value;
        }
    });

    return formData;
}

async function validateFormData(formData) {
    try {
        const validation = await taxFormManager.validateForm(formData);
        if (!validation.isValid) {
            showValidationErrors(validation.errors);
            return false;
        }
        return true;
    } catch (error) {
        console.error('Validation failed:', error);
        showError('Form validation failed');
        return false;
    }
}

function updateDocumentList(documents) {
    const documentList = document.getElementById('documentList');
    documentList.innerHTML = '';
    documents.forEach(doc => {
        const docItem = document.createElement('div');
        docItem.className = 'document-item';
        docItem.textContent = doc.fileName;
        documentList.appendChild(docItem);
    });
}

function updateTaxForm(taxData) {
    const formContent = document.getElementById('formContent');
    formContent.innerHTML = '';
    Object.entries(taxData.fields).forEach(([field, value]) => {
        const input = document.createElement('input');
        input.name = field;
        input.value = value;
        formContent.appendChild(input);
    });
}

function updateProgress() {
    const progress = calculateProgress();
    const progressBar = document.getElementById('progressIndicator');
    progressBar.style.width = `${progress}%`;
    
    document.querySelectorAll('.step').forEach(step => {
        const stepValue = step.dataset.step;
        step.classList.toggle('active', progress >= getStepThreshold(stepValue));
    });
}

function calculateProgress() {
    const steps = {
        documents: () => documentManager.hasRequiredDocuments(),
        bank: () => bankManager.isConnected(),
        review: () => taxFormManager.isFormComplete(),
        submit: () => taxFormManager.isSubmitted()
    };

    const completedSteps = Object.values(steps)
        .filter(check => check())
        .length;

    return (completedSteps / Object.keys(steps).length) * 100;
}

// =============================
// Element References
// =============================

// File Upload and Refresh Elements
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

class TaxCalculator {
    constructor() {
        this.taxBands = {
            '2023-24': [
                { threshold: 12570, rate: 0 },
                { threshold: 50270, rate: 0.20 },
                { threshold: 125140, rate: 0.40 },
                { threshold: Infinity, rate: 0.45 }
            ]
        };
    }

    calculateTax(income, allowances = 0, expenses = 0) {
        const taxableIncome = Math.max(0, income - allowances - expenses);
        let remainingIncome = taxableIncome;
        let totalTax = 0;
        let previousThreshold = 0;

        this.taxBands['2023-24'].forEach(band => {
            const taxableInBand = Math.min(
                remainingIncome,
                band.threshold - previousThreshold
            );
            totalTax += taxableInBand * band.rate;
            remainingIncome -= taxableInBand;
            previousThreshold = band.threshold;
        });

        return {
            taxableIncome,
            totalTax: Math.round(totalTax * 100) / 100
        };
    }
}

if (refreshTaxBtn) {
    const calculator = new TaxCalculator();
    
    refreshTaxBtn.addEventListener("click", () => {
        const income = parseFloat(incomeInput.value) || 0;
        const allowances = parseFloat(allowancesInput.value) || 0;
        const expenses = parseFloat(expensesInput.value) || 0;

        const results = calculator.calculateTax(income, allowances, expenses);

        // Update display
        taxLiabilityEl.textContent = `£${results.totalTax.toLocaleString()}`;
        incomeEl.textContent = `£${income.toLocaleString()}`;
        allowancesEl.textContent = `£${allowances.toLocaleString()}`;
        expensesEl.textContent = `£${expenses.toLocaleString()}`;
        liabilityEl.textContent = `£${results.taxableIncome.toLocaleString()}`;

        // Save to Firestore
        if (auth.currentUser) {
            db.collection('users')
                .doc(auth.currentUser.uid)
                .collection('calculations')
                .add({
                    income,
                    allowances,
                    expenses,
                    taxLiability: results.totalTax,
                    timestamp: new Date()
                });
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

async function initializeDashboard() {
    const components = {
        form: document.querySelector('#taxForm'),
        submitBtn: document.querySelector('#submitFormButton'),
        progressBar: document.querySelector('#progressBar'),
        uploadArea: document.querySelector('#uploadArea'),
        aiChat: document.querySelector('#aiChat')
    };

    // Initialize form handlers
    components.form.addEventListener('input', async (e) => {
        const field = e.target;
        if (field.dataset.validate) {
            const validation = await aiAssistant.validateField(
                field.name, 
                field.value,
                gatherFormData()
            );
            updateFieldStatus(field, validation);
        }
    });

    // Submit handler
    components.submitBtn.addEventListener('click', async () => {
        try {
            components.submitBtn.disabled = true;
            showLoader('Submitting tax return...');
            
            const formData = gatherFormData();
            const validation = await taxFormManager.validateForm(formData);
            
            if (!validation.isValid) {
                throw new Error(validation.errors.join('\n'));
            }
            
            await taxFormManager.submitReturn(formData);
            showSuccess('Tax return submitted successfully');
            
        } catch (error) {
            showError(`Submission failed: ${error.message}`);
        } finally {
            components.submitBtn.disabled = false;
            hideLoader();
        }
    });

    // Document upload handler
    components.uploadArea.addEventListener('drop', async (e) => {
        e.preventDefault();
        try {
            const files = Array.from(e.dataTransfer.files);
            showLoader('Processing documents...');
            
            for (const file of files) {
                await documentManager.uploadAndProcess(file);
            }
            
            updateProgress();
        } catch (error) {
            showError(`Upload failed: ${error.message}`);
        } finally {
            hideLoader();
        }
    });

    // AI chat handler
    components.aiChat.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = e.target.query.value;
        try {
            const response = await aiAssistant.processQuery(
                query,
                await documentManager.getDocuments(),
                await taxFormManager.getCurrentData()
            );
            appendChatMessage(response);
        } catch (error) {
            showError(`AI response failed: ${error.message}`);
        }
    });
}

function gatherFormData() {
    const form = document.querySelector('#taxForm');
    const formData = new FormData(form);
    return Object.fromEntries(formData.entries());
}

function updateFieldStatus(field, validation) {
    field.classList.toggle('invalid', !validation.isValid);
    field.setCustomValidity(validation.message || '');
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initializeDashboard);

// Document Upload
const documentUpload = document.getElementById('document-upload');
const uploadBtn = document.getElementById('upload-btn');

uploadBtn.addEventListener('click', async () => {
  const files = documentUpload.files;
  if (files.length === 0) {
    alert('Please select at least one document to upload.');
    return;
  }

  const user = auth.currentUser;
  if (!user) {
    alert('User not authenticated.');
    return;
  }

  const userId = user.uid;

  const formData = new FormData();
  formData.append('userId', userId);
  for (let file of files) {
    formData.append('documents', file);
  }

  try {
    const response = await fetch('/upload', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (response.ok) {
      alert('Documents uploaded and processed successfully.');
      console.log(result.documents);
      // Optionally, update UI with parsed data
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error('Upload Error:', error);
    alert('Failed to upload documents.');
  }
});

// Plaid Elements (Using Plaid Link Token)
const subscribeBtn = document.getElementById('subscribe-btn');
const stripePublicKey = 'YOUR_STRIPE_PUBLIC_KEY'; // Replace with your Stripe public key
let stripeInstance;

// Initialize Stripe
const initializeStripe = () => {
  stripeInstance = Stripe(stripePublicKey);
};

// Stripe Subscription
subscribeBtn.addEventListener('click', async () => {
  try {
    const user = auth.currentUser;
    const idToken = await user.getIdToken();

    // Create Stripe Checkout Session
    const response = await fetch('/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ priceId: 'price_1QbjcxEmAeUZ2IYPYdX07A5K' }) // Replace with your actual Price ID
    });

    const session = await response.json();

    if (response.ok) {
      // Redirect to Stripe Checkout
      const result = await stripeInstance.redirectToCheckout({ sessionId: session.id });
      if (result.error) {
        alert(result.error.message);
      }
    } else {
      alert(`Error: ${session.error}`);
    }
  } catch (error) {
    console.error('Stripe Subscription Error:', error);
    alert('Failed to initiate subscription.');
  }
});

// Initialize Stripe on Page Load
window.onload = () => {
  initializeStripe();
};

// Plaid Link Initialization
const initializePlaid = async () => {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const idToken = await user.getIdToken();

    const response = await fetch('/plaid/link-token', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${idToken}`
      },
      params: { userId: user.uid }
    });

    const data = await response.json();

    if (response.ok) {
      const handler = Plaid.create({
        token: data.linkToken,
        onSuccess: async (publicToken, metadata) => {
          // Exchange publicToken for accessToken via backend
          const exchangeResponse = await fetch('/plaid/exchange-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ publicToken })
          });

          const exchangeData = await exchangeResponse.json();

          if (exchangeResponse.ok) {
            const accessToken = exchangeData.accessToken;
            // Save accessToken securely, associate with user
            // Optionally, fetch transactions immediately
          } else {
            alert(`Error: ${exchangeData.error}`);
          }
        },
        onExit: (err, metadata) => {
          if (err) {
            console.error('Plaid Link Error:', err);
            alert('Failed to complete Plaid Link.');
          }
        },
      });

      handler.open();
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (error) {
    console.error('Plaid Initialization Error:', error);
    alert('Failed to initialize Plaid.');
  }
};

// Example Button to Initialize Plaid Link
const plaidLinkBtn = document.createElement('button');
plaidLinkBtn.textContent = 'Link Bank Account';
plaidLinkBtn.addEventListener('click', initializePlaid);
aiSection.appendChild(plaidLinkBtn);

// Tax Form Elements
const taxFormSection = document.getElementById('tax-form-section');
const taxFormDiv = document.getElementById('tax-form');
const submitFormBtn = document.getElementById('submit-form-btn');
const downloadPdfBtn = document.getElementById('download-pdf-btn');

// Function to Generate Tax Form
const generateTaxForm = async () => {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const idToken = await user.getIdToken();

    const response = await fetch('/generate-tax-form', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      }
    });

    const result = await response.json();

    if (response.ok) {
      const taxForm = result.taxForm;
      renderTaxForm(taxForm);
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error('Tax Form Generation Error:', error);
    alert('Failed to generate tax form.');
  }
};

// Function to Render Tax Form
const renderTaxForm = (taxForm) => {
  taxFormDiv.innerHTML = ''; // Clear existing form

  // Personal Details
  const personalDetails = taxForm.personalDetails;
  const personalDiv = document.createElement('div');
  personalDiv.innerHTML = `
    <h3>Personal Details</h3>
    <p><strong>Name:</strong> ${personalDetails.name}</p>
    <p><strong>Address:</strong> ${personalDetails.address}</p>
    <p><strong>UTR:</strong> ${personalDetails.utr}</p>
  `;
  taxFormDiv.appendChild(personalDiv);

  // Income
  const income = taxForm.income;
  const incomeDiv = document.createElement('div');
  incomeDiv.innerHTML = `
    <h3>Income</h3>
    <p><strong>Employment:</strong> £${income.employment}</p>
    <p><strong>Self-Employment:</strong> £${income.selfEmployment}</p>
    <p><strong>Interest:</strong> £${income.interest}</p>
    ${income.dividends ? `<p><strong>Dividends:</strong> £${income.dividends}</p>` : ''}
  `;
  taxFormDiv.appendChild(incomeDiv);

  // Deductions
  const deductions = taxForm.deductions;
  const deductionsDiv = document.createElement('div');
  deductionsDiv.innerHTML = `
    <h3>Deductions</h3>
    <p><strong>Expenses:</strong> £${deductions.expenses}</p>
    <p><strong>Allowances:</strong> £${deductions.allowances}</p>
  `;
  taxFormDiv.appendChild(deductionsDiv);

  // Add more sections as needed
};

// Submit Tax Form to HMRC
submitFormBtn.addEventListener('click', async () => {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const idToken = await user.getIdToken();

    // Fetch the latest tax form
    const taxFormsSnapshot = await db.collection('users').doc(user.uid).collection('taxForms')
      .orderBy('generatedAt', 'desc')
      .limit(1)
      .get();

    if (taxFormsSnapshot.empty) {
      alert('No tax form found.');
      return;
    }

    const taxFormData = taxFormsSnapshot.docs[0].data().taxForm;

    // Submit to HMRC
    const response = await fetch('/hmrc/submit-tax-form', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ taxForm: taxFormData })
    });

    const result = await response.json();

    if (response.ok) {
      alert('Tax form submitted successfully.');
      console.log('Submission Status:', result.status);
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error('Tax Form Submission Error:', error);
    alert('Failed to submit tax form.');
  }
});

// Download Tax Form as PDF
downloadPdfBtn.addEventListener('click', async () => {
  try {
    const user = auth.currentUser;
    if (!user) return;

    // Fetch the latest tax form
    const taxFormsSnapshot = await db.collection('users').doc(user.uid).collection('taxForms')
      .orderBy('generatedAt', 'desc')
      .limit(1)
      .get();

    if (taxFormsSnapshot.empty) {
      alert('No tax form found.');
      return;
    }

    const taxFormData = taxFormsSnapshot.docs[0].data().taxForm;

    // Convert tax form JSON to PDF using PDFKit on the server
    // Alternatively, implement client-side PDF generation using libraries like jsPDF

    alert('Download feature to be implemented.');
  } catch (error) {
    console.error('PDF Download Error:', error);
    alert('Failed to download tax form.');
  }
});

// Call generateTaxForm on page load or when appropriate
// Example: Generate form after document upload
uploadBtn.addEventListener('click', async () => {
  // After successful upload, generate tax form
  // Assuming documents have been processed and necessary data is available
  generateTaxForm();
});

// Function to Check Subscription Status
const checkSubscription = async () => {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const idToken = await user.getIdToken();

    const response = await fetch('/check-subscription', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${idToken}`
      }
    });

    const result = await response.json();

    if (response.ok) {
      if (result.isSubscribed) {
        // Show premium features
        aiSection.style.display = 'block';
        calculatorSection.style.display = 'block';
        taxFormSection.style.display = 'block';
        subscriptionSection.style.display = 'none';
      } else {
        // Hide premium features and show subscription prompt
        aiSection.style.display = 'none';
        calculatorSection.style.display = 'none';
        taxFormSection.style.display = 'none';
        subscriptionSection.style.display = 'block';
      }
    } else {
      console.error('Subscription Check Error:', result.error);
    }
  } catch (error) {
    console.error('Check Subscription Error:', error);
  }
};

// Route to Check Subscription Status on Backend
// Add this route to `functions/index.js`

/*
// filepath: /workspaces/Home/functions/index.js

app.get('/check-subscription', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const subscription = userDoc.data().subscription;
    const isSubscribed = subscription && subscription.status === 'active';

    return res.status(200).json({ isSubscribed });
  } catch (error) {
    console.error('Check Subscription Error:', error);
    return res.status(500).json({ error: 'Failed to check subscription status.' });
  }
});
*/

// After deploying, call checkSubscription on auth state change
auth.onAuthStateChanged(user => {
  if (user) {
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'block';
    // Call checkSubscription to toggle feature access
    checkSubscription();
  } else {
    loginBtn.style.display = 'block';
    logoutBtn.style.display = 'none';
    uploadSection.style.display = 'none';
    aiSection.style.display = 'none';
    calculatorSection.style.display = 'none';
    taxFormSection.style.display = 'none';
    subscriptionSection.style.display = 'none';
  }
});

// PDF Download Elements
const downloadPdfBtn = document.getElementById('download-pdf-btn');

// Function to Download PDF of Tax Form
const downloadPDF = async () => {
  try {
    const user = auth.currentUser;
    if (!user) return;

    // Fetch the latest tax form
    const taxFormsSnapshot = await db.collection('users').doc(user.uid).collection('taxForms')
      .orderBy('generatedAt', 'desc')
      .limit(1)
      .get();

    if (taxFormsSnapshot.empty) {
      alert('No tax form found.');
      return;
    }

    const taxFormData = taxFormsSnapshot.docs[0].data();
    const taxFormId = taxFormsSnapshot.docs[0].id;

    const idToken = await user.getIdToken();

    const response = await fetch('/generate-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ taxFormId })
    });

    if (response.ok) {
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SA100_TaxForm_${taxFormId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } else {
      const result = await response.json();
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error('Download PDF Error:', error);
    alert('Failed to download PDF.');
  }
};

// Event Listener for Download Button
downloadPdfBtn.addEventListener('click', downloadPDF);

// ... existing code above ...

// Function to Handle AI Assistant Follow-Up
const handleAIFollowUp = async (message) => {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const idToken = await user.getIdToken();

    const response = await fetch('/ai/follow-up', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ response: message })
    });

    const result = await response.json();

    if (response.ok) {
      appendMessage('AI', result.message);
    } else {
      appendMessage('AI', `Error: ${result.error}`);
    }
  } catch (error) {
    console.error('AI Follow-Up Error:', error);
    appendMessage('AI', 'Failed to get follow-up from AI assistant.');
  }
};

// Modify AI Assistant Send Button to Handle Follow-Up
sendBtn.addEventListener('click', async () => {
  const message = chatInput.value.trim();
  if (message === '') return;

  appendMessage('User', message);
  chatInput.value = '';

  try {
    const user = auth.currentUser;
    const idToken = await user.getIdToken();

    const response = await fetch('/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ message })
    });

    const result = await response.json();

    if (response.ok) {
      appendMessage('AI', result.message);
      // Optionally, initiate follow-up based on AI response
    } else {
      appendMessage('AI', `Error: ${result.error}`);
    }
  } catch (error) {
    console.error('AI Chat Error:', error);
    appendMessage('AI', 'Failed to get response from AI assistant.');
  }
});

const functions = require('firebase-functions');

const GOOGLE_PROJECT_ID = functions.config().google.project_id;
const DOCUMENTAI_PROCESSOR_ID = functions.config().documentai.processor_id;
const PLAID_CLIENT_ID = functions.config().plaid.client_id;
const PLAID_SECRET = functions.config().plaid.secret;
const OPENAI_API_KEY = functions.config().openai.key;
const STRIPE_SECRET_KEY = functions.config().stripe.key;
const FIREBASE_STORAGE_BUCKET = functions.config().firebase.storage_bucket;

// Use these variables in your configurations

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const fileInput = document.getElementById('document');
  const userId = document.getElementById('userId').value;
  const file = fileInput.files[0];

  if (!file) {
    alert('Please select a file to upload.');
    return;
  }

  const formData = new FormData();
  formData.append('document', file);
  formData.append('userId', userId);

  try {
    const response = await fetch('/upload', {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();
    if (response.ok) {
      alert('File uploaded and processed successfully.');
      console.log('Public URL:', result.publicUrl);
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error('Upload Error:', error);
    alert('An error occurred during upload.');
  }
});

// Handle Document Upload
const uploadForm = document.getElementById('upload-form');
const uploadStatus = document.getElementById('upload-status');

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('document-file');
  const userId = document.getElementById('user-id').value;

  if (fileInput.files.length === 0) {
    alert('Please select a file to upload.');
    return;
  }

  const file = fileInput.files[0];
  const storageRef = storage.ref().child(`documents/${userId}/${file.name}`);
  
  uploadStatus.innerText = 'Uploading...';

  try {
    const snapshot = await storageRef.put(file);
    const downloadURL = await snapshot.ref.getDownloadURL();

    // Save file info to Firestore
    await db.collection('parsedDocuments').add({
      userId: userId,
      fileName: file.name,
      fileUrl: downloadURL,
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    uploadStatus.innerText = 'File uploaded and processing initiated.';
    uploadForm.reset();

    // Check subscription status
    await checkSubscriptionStatus(userId);
  } catch (error) {
    console.error('Error uploading file:', error);
    uploadStatus.innerText = 'Error uploading file.';
  }
});

// Handle AI Assistance
const askAiButton = document.getElementById('ask-ai');
const aiResponse = document.getElementById('ai-response');
const userQuery = document.getElementById('user-query');

askAiButton.addEventListener('click', async () => {
  const query = userQuery.value.trim();
  if (query === '') {
    alert('Please enter a question for the AI.');
    return;
  }

  aiResponse.innerText = 'AI is thinking...';

  try {
    const response = await fetch('/ai-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, userId: 'testUserId' }) // Replace with actual userId
    });

    const data = await response.json();
    aiResponse.innerText = data.answer;
  } catch (error) {
    console.error('Error communicating with AI Assistant:', error);
    aiResponse.innerText = 'Error fetching AI response.';
  }
});

// Existing Firebase Initialization...

// Function to Authenticate User (Example using Firebase Auth)
const authenticateUser = async () => {
  // Implement your authentication logic here
  // For example, using Firebase Authentication
  // Replace with actual authentication method
  const user = { uid: 'testUserId', email: 'user@example.com' };
  return user;
};

// After Document Upload Success
const uploadSuccessHandler = async (userId) => {
  // Check subscription status
  await checkSubscriptionStatus(userId);
};

// Modify existing uploadForm event listener
uploadForm.addEventListener('submit', async (e) => {
  // Existing upload logic...
  
  try {
    // After successful upload
    await db.collection('parsedDocuments').add({
      // ...existing fields
    });

    uploadStatus.innerText = 'File uploaded and processing initiated.';
    uploadForm.reset();

    // Check subscription status
    await checkSubscriptionStatus(userId);
  } catch (error) {
    // Error handling...
  }
});

const downloadPdfButton = document.getElementById('download-pdf');

downloadPdfButton.addEventListener('click', async () => {
  try {
    // Fetch the generated tax form data from Firestore
    const userId = 'testUserId'; // Replace with actual userId
    const taxFormSnapshot = await db.collection('taxForms').where('userId', '==', userId).get();

    if (taxFormSnapshot.empty) {
      alert('No tax form found to download.');
      return;
    }

    const taxFormData = taxFormSnapshot.docs[0].data();

    // Generate PDF using jsPDF
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.text('SA100 Tax Form', 10, 10);
    // Add more content based on taxFormData
    doc.text(`User ID: ${taxFormData.userId}`, 10, 20);
    doc.text(`Income: ${taxFormData.income}`, 10, 30);
    doc.text(`Tax Liability: ${taxFormData.taxLiability}`, 10, 40);
    // ... add other fields as needed

    doc.save('SA100_Tax_Form.pdf');
  } catch (error) {
    console.error('Error generating PDF:', error);
    alert('Failed to generate PDF.');
  }
});

// ... existing code

const connectBankButton = document.getElementById('connect-bank');
const bankStatus = document.getElementById('bank-status');

connectBankButton.addEventListener('click', async () => {
  try {
    const response = await fetch('/create-plaid-link-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'testUserId' }) // Replace with actual userId
    });

    const data = await response.json();
    const linkToken = data.link_token;

    const handler = Plaid.create({
      token: linkToken,
      onSuccess: async (public_token, metadata) => {
        // Send public_token to backend to exchange for access_token
        const res = await fetch('/exchange-public-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token: public_token, userId: 'testUserId' })
        });

        const result = await res.json();
        if (result.success) {
          bankStatus.innerText = 'Bank account connected successfully.';
        } else {
          bankStatus.innerText = 'Failed to connect bank account.';
        }
      },
      onExit: (err, metadata) => {
        if (err) {
          console.error('Plaid Link Error:', err);
          bankStatus.innerText = 'Error connecting bank account.';
        }
      }
    });

    handler.open();
  } catch (error) {
    console.error('Error initiating Plaid Link:', error);
    bankStatus.innerText = 'Failed to initiate bank connection.';
  }
});

// ...existing code...

// Track Current User
const currentUserIdSpan = document.getElementById('current-user-id');
const logoutBtn = document.getElementById('logout-btn');

// Document Upload
const uploadForm = document.getElementById('upload-form');
const uploadStatus = document.getElementById('upload-status');

// AI Assistance
const askAiBtn = document.getElementById('ask-ai-btn');
const aiQuery = document.getElementById('ai-query');
const aiResponseDiv = document.getElementById('ai-response');

// Tax Form
const downloadFormBtn = document.getElementById('download-form-btn');
const taxFormContainer = document.getElementById('tax-form-container');

// Paywall
const paywallSection = document.getElementById('paywall-section');
const subscribeBtn = document.getElementById('subscribe-btn');

// On auth state changed
auth.onAuthStateChanged((user) => {
  if (user) {
    currentUserIdSpan.innerText = user.uid;
    checkSubscriptionStatus(user.uid);
  } else {
    currentUserIdSpan.innerText = 'Not logged in';
    paywallSection.style.display = 'none';
  }
});

// Basic logout
logoutBtn.addEventListener('click', () => {
  auth.signOut();
});

// Check subscription status
async function checkSubscriptionStatus(userId) {
  try {
    const response = await fetch('/check-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    const data = await response.json();
    if (!data.isSubscribed) {
      paywallSection.style.display = 'block';
    } else {
      paywallSection.style.display = 'none';
    }
  } catch (error) {
    console.error('Error checking subscription status:', error);
  }
}

// Handle Upload
uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('document-file');
  if (!fileInput.files.length) {
    alert('No file selected.');
    return;
  }
  if (!auth.currentUser) {
    alert('Please log in first.');
    return;
  }
  uploadStatus.textContent = 'Uploading...';

  const file = fileInput.files[0];
  const userId = auth.currentUser.uid;
  const storageRef = storage.ref(`documents/${userId}/${file.name}`);

  try {
    const snapshot = await storageRef.put(file);
    const downloadURL = await snapshot.ref.getDownloadURL();
    await db.collection('parsedDocuments').add({
      userId,
      fileName: file.name,
      fileUrl: downloadURL,
      uploadedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    uploadStatus.textContent = 'File uploaded and processed.';
    uploadForm.reset();
  } catch (error) {
    console.error('Error uploading file:', error);
    uploadStatus.textContent = 'Error uploading file.';
  }
});

// Ask AI
askAiBtn.addEventListener('click', async () => {
  if (!auth.currentUser) {
    alert('Please log in.');
    return;
  }
  const query = aiQuery.value.trim();
  if (!query) {
    alert('Empty query!');
    return;
  }
  aiResponseDiv.textContent = 'Thinking...';

  try {
    const response = await fetch('/ai-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, userId: auth.currentUser.uid })
    });
    const data = await response.json();
    aiResponseDiv.textContent = data.answer || 'No response.';
  } catch (error) {
    console.error('Error:', error);
    aiResponseDiv.textContent = 'An error occurred.';
  }
});

// Download SA100 Form
downloadFormBtn.addEventListener('click', async () => {
  if (!auth.currentUser) {
    alert('Please log in.');
    return;
  }
  // Fetch user’s completed tax form from Firestore
  const forms = await db.collection('taxForms')
    .where('userId', '==', auth.currentUser.uid)
    .get();

  if (forms.empty) {
    alert('No SA100 form found.');
    return;
  }

  const formData = forms.docs[0].data();

  // Generate PDF with jsPDF or PDFKit client-side
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text('SA100 Tax Return', 10, 10);
  doc.text(`User ID: ${formData.userId}`, 10, 20);
  doc.text(`Income: ${formData.income}`, 10, 30);
  doc.save('SA100_Tax_Return.pdf');
});

// Subscribe
subscribeBtn.addEventListener('click', async () => {
  if (!auth.currentUser) {
    alert('Please log in.');
    return;
  }
  const userEmail = auth.currentUser.email;
  try {
    const response = await fetch('/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail })
    });
    const session = await response.json();
    const stripe = Stripe('YOUR_STRIPE_PUBLISHABLE_KEY');
    await stripe.redirectToCheckout({ sessionId: session.id });
  } catch (error) {
    console.error('Error subscribing:', error);
  }
}

// ...existing code...

fetch('https://<REGION>-<PROJECT_ID>.cloudfunctions.net/checkSubscriptionStatus', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ userId: 'hello' })
})
.then(response => {
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  return response.json();
})
.then(data => {
  console.log(data);
})
.catch(error => {
  console.error('Error:', error);
});

// Authentication and Routing
document.addEventListener('DOMContentLoaded', () => {
  const logoutButton = document.getElementById('logout');

  logoutButton.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await firebase.auth().signOut();
      window.location.href = '/login.html';
    } catch (error) {
      console.error('Logout Error:', error);
    }
  });

  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      // User is signed in
      window.location.href = '/dashboard.html';
    } else {
      // No user is signed in
      window.location.href = '/login.html';
    }
  });
});

// File Upload Functionality
async function uploadDocument(file) {
  try {
    const storageRef = firebase.storage().ref();
    const fileRef = storageRef.child(`documents/${file.name}`);
    await fileRef.put(file);
    const fileURL = await fileRef.getDownloadURL();
    console.log('File Uploaded Successfully:', fileURL);
    return fileURL;
  } catch (error) {
    console.error('File Upload Error:', error);
    throw error;
  }
}

// AI Assistant Query
async function askAI(question) {
  try {
    const response = await fetch('/api/ai-assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ question })
    });

    if (!response.ok) {
      throw new Error('Network response was not ok');
    }

    const data = await response.json();
    console.log('AI Response:', data.answer);
    return data.answer;
  } catch (error) {
    console.error('AI Assistant Error:', error);
    throw error;
  }
}

// Plaid Integration
async function connectBankAccount() {
  try {
    const response = await fetch('/api/plaid/connect', {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error('Failed to initiate Plaid connection');
    }

    const data = await response.json();
    window.location.href = data.link_url;
  } catch (error) {
    console.error('Plaid Integration Error:', error);
    throw error;
  }
}

// Generate and Download SA100 Tax Form as PDF
async function generateTaxForm(data) {
  try {
    const response = await fetch('/api/generate-tax-form', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error('Failed to generate tax form');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SA100_Tax_Form.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    console.log('Tax form downloaded successfully');
  } catch (error) {
    console.error('Tax Form Generation Error:', error);
    throw error;
  }
}