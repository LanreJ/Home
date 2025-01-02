import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';
import { DocumentManager } from './modules/DocumentManager.js';
import { TaxCalculator } from './modules/TaxCalculator.js';
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Initialize Managers
const documentManager = new DocumentManager();
const taxCalculator = new TaxCalculator();
const aiAssistant = new AIAssistant();
const subscriptionManager = new SubscriptionManager();

// Initialize Dashboard
function initializeDashboard() {
    setupEventListeners();
    loadInitialData();
}

function setupEventListeners() {
    // Document Upload
    const documentForm = document.getElementById('documentForm');
    documentForm.addEventListener('submit', handleDocumentUpload);

    // AI Assistant Chat
    const chatForm = document.getElementById('chatForm');
    chatForm.addEventListener('submit', handleAIChat);

    // Tax Calculator
    // Add event listeners if needed

    // SA100 Forms
    const openSA100FormBtn = document.getElementById('openSA100FormBtn');
    openSA100FormBtn.addEventListener('click', openSA100Form);

    // Subscriptions
    const subscribeNowBtn = document.getElementById('subscribeNowBtn');
    subscribeNowBtn.addEventListener('click', subscribeNow);

    // Downloads
    const downloadSA100Btn = document.getElementById('downloadSA100Btn');
    const downloadSummaryBtn = document.getElementById('downloadSummaryBtn');
    downloadSA100Btn.addEventListener('click', downloadSA100);
    downloadSummaryBtn.addEventListener('click', downloadSummary);

    // Logout
    const logoutLink = document.querySelector('a[href="#logout"]');
    logoutLink.addEventListener('click', logout);
}

function loadInitialData() {
    // Load initial data like tax calculations, documents, etc.
}

// Handle Document Upload
async function handleDocumentUpload(event) {
    event.preventDefault();
    const fileInput = document.getElementById('documentUpload');
    const files = fileInput.files;
    if (files.length === 0) {
        showStatus('Please select at least one document to upload.', 'warning');
        return;
    }

    showLoading(true, 'Uploading documents...');
    try {
        await documentManager.uploadDocuments(files);
        loadTaxDocuments();
        showStatus('Documents uploaded successfully.', 'success');
    } catch (error) {
        console.error('Document Upload Error:', error);
        showStatus('Failed to upload documents.', 'danger');
    } finally {
        showLoading(false);
    }
}

// Handle AI Chat
async function handleAIChat(event) {
    event.preventDefault();
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    if (!message) return;

    appendChatMessage('You', message);
    chatInput.value = '';

    showLoading(true, 'Processing your question...');
    try {
        const response = await aiAssistant.sendMessage(message);
        appendChatMessage('AI Assistant', response);
    } catch (error) {
        console.error('AI Assistant Error:', error);
        appendChatMessage('AI Assistant', 'Sorry, I encountered an error processing your request.');
    } finally {
        showLoading(false);
    }
}

// Open SA100 Form
function openSA100Form() {
    // Implement logic to open and edit SA100 form
    showStatus('Opening SA100 Form...', 'info');
}

// Subscribe Now
function subscribeNow() {
    // Implement subscription logic
    showStatus('Subscription feature is coming soon!', 'info');
}

// Download SA100
function downloadSA100() {
    // Implement download logic for SA100 form
    showStatus('Downloading SA100 Form...', 'info');
}

// Download Summary
function downloadSummary() {
    // Implement download logic for tax summary
    showStatus('Downloading Tax Summary...', 'info');
}

// Logout Functionality
function logout(event) {
    event.preventDefault();
    // Implement logout logic
    showStatus('Logging out...', 'info');
    // Redirect to login page after logout
    window.location.href = '/login.html';
}

// Append Chat Message
function appendChatMessage(sender, message) {
    const chatMessages = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('mb-2');
    msgDiv.innerHTML = `<strong>${sender}:</strong> ${message}`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Show Loading Overlay
function showLoading(show, text = 'Processing...') {
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    if (show) {
        loadingText.textContent = text;
        loadingOverlay.hidden = false;
    } else {
        loadingOverlay.hidden = true;
    }
}

// Show Status Messages
function showStatus(message, type = 'info') {
    const statusMessages = document.getElementById('statusMessages');
    const alertDiv = document.createElement('div');
    alertDiv.classList.add('alert', `alert-${type}`, 'alert-dismissible', 'fade', 'show');
    alertDiv.setAttribute('role', 'alert');
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    statusMessages.appendChild(alertDiv);
    setTimeout(() => {
        alertDiv.classList.remove('show');
        alertDiv.classList.add('hide');
        alertDiv.remove();
    }, 5000);
}

// Initialize Dashboard on Load
document.addEventListener('DOMContentLoaded', initializeDashboard);