import { auth, db, storage } from './firebaseConfig.js';

// DOM Elements
const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const documentsList = document.getElementById('documentsList');
const userMessageInput = document.getElementById('userMessage');
const sendBtn = document.getElementById('sendBtn');
const chatWindow = document.getElementById('chatWindow');
const taxLiabilityEl = document.getElementById('taxLiability');
const incomeEl = document.getElementById('income');
const allowancesEl = document.getElementById('allowances');
const expensesEl = document.getElementById('expenses');
const refreshCalcBtn = document.getElementById('refreshCalcBtn');
const fileList = document.getElementById('fileList');
const refreshFilesBtn = document.getElementById('refreshFilesBtn');
const taxReturn = document.getElementById('taxReturn');
const submitReturnBtn = document.getElementById('submitReturnBtn');

// Authentication state observer
auth.onAuthStateChanged((user) => {
  if (user) {
    console.log('User signed in:', user.email);
    localStorage.setItem('idToken', user.accessToken);
  } else {
    console.log('User signed out');
    localStorage.removeItem('idToken');
  }
});

// Function to get auth token
async function getAuthToken() {
  const idToken = localStorage.getItem('idToken');
  if (idToken) return idToken;
  throw new Error('User not signed in');
}

// Function to call API endpoints with authentication
async function callApi(endpoint, options = {}) {
  const token = await getAuthToken();
  options.headers = options.headers || {};
  options.headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(endpoint, options);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'API call failed');
  }
  return response.json();
}

// Function to add a message to the chat window
function addToChat(role, message) {
  const line = document.createElement('div');
  line.classList.add('message');
  line.innerHTML = `<strong>${role}:</strong> ${message}`;
  chatWindow.appendChild(line);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Event: Upload document
uploadBtn.addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) return alert('Please select a file first.');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const data = await callApi('/api/uploadDocument', {
      method: 'POST',
      body: formData,
    });
    alert(data.message);
    refreshFiles(); // Refresh file list
  } catch (error) {
    console.error('Error uploading document:', error.message);
    alert('Error uploading document: ' + error.message);
  }
});

// Event: Send message to AI Assistant
sendBtn.addEventListener('click', async () => {
  const userMessage = userMessageInput.value.trim();
  if (!userMessage) return;

  // Add user message to chat window
  addToChat('User', userMessage);

  try {
    const data = await callApi('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessage }),
    });
    addToChat('Assistant', data.reply);
    userMessageInput.value = '';
  } catch (error) {
    console.error('Error in chat API:', error.message);
    addToChat('Assistant', 'Error: ' + error.message);
  }
});

// Event: Refresh tax calculation
refreshCalcBtn.addEventListener('click', async () => {
  try {
    const data = await callApi('/api/getTaxLiability');
    taxLiabilityEl.textContent = data.liability;
    incomeEl.textContent = data.income;
    allowancesEl.textContent = data.allowances;
    expensesEl.textContent = data.expenses;
  } catch (error) {
    console.error('Error fetching tax liability:', error.message);
    alert('Error fetching tax liability: ' + error.message);
  }
});

// Event: Refresh files list
refreshFilesBtn.addEventListener('click', refreshFiles);

// Function to refresh uploaded files
async function refreshFiles() {
  try {
    const data = await callApi('/api/listDocuments');
    documentsList.innerHTML = '';
    data.files.forEach((file) => {
      const li = document.createElement('li');
      li.textContent = `${file.fileName} (Uploaded: ${new Date(
        file.uploadedAt._seconds * 1000
      ).toLocaleString()})`;
      documentsList.appendChild(li);
    });
  } catch (error) {
    console.error('Error fetching files:', error.message);
    alert('Error fetching files: ' + error.message);
  }
}

// Event: Submit tax return
submitReturnBtn.addEventListener('click', async () => {
  const returnData = taxReturn.value.trim();
  if (!returnData) return alert('Please fill in the return details.');

  try {
    const response = await callApi('/api/submitReturn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnData }),
    });
    alert(response.message);
  } catch (error) {
    console.error('Error submitting return:', error.message);
    alert('Error submitting return: ' + error.message);
  }
});

// Initialize file list on page load
refreshFiles();