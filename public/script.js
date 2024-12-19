import { auth, db, storage } from './firebaseConfig.js';

document.getElementById('clickButton').addEventListener('click', function() {
    alert('Button clicked!');
});

// Login function
document.getElementById('loginButton').addEventListener('click', function() {
    // Replace with your Auth provider (e.g., GoogleAuthProvider)
    var provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then((result) => {
            console.log('User signed in:', result.user.email);
        })
        .catch((error) => {
            console.error('Error signing in:', error);
        });
});

// Logout function
document.getElementById('logoutButton').addEventListener('click', function() {
    auth.signOut()
        .then(() => {
            console.log('User signed out');
        })
        .catch((error) => {
            console.error('Error signing out:', error);
        });
});

// Authentication state observer
firebase.auth().onAuthStateChanged(function(user) {
    if (user) {
        // User is signed in
        document.getElementById('loginButton').style.display = 'none';
        document.getElementById('logoutButton').style.display = 'block';
    } else {
        // No user is signed in
        document.getElementById('loginButton').style.display = 'block';
        document.getElementById('logoutButton').style.display = 'none';
    }
});

// Initialize Firebase Authentication and get a reference to the service
firebase.auth().onAuthStateChanged((user) => {
  if (user) {
    // User is signed in
    user.getIdToken().then((idToken) => {
      localStorage.setItem('idToken', idToken);
    });
  } else {
    // User is signed out
    localStorage.removeItem('idToken');
  }
});

// Function to get the auth token
async function getAuthToken() {
  const idToken = localStorage.getItem('idToken');
  if (idToken) {
    return idToken;
  } else {
    throw new Error('User not signed in');
  }
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

// Event Listeners
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
    alert('Error uploading document: ' + error.message);
  }
});

sendBtn.addEventListener('click', async () => {
  const userMessage = userMessageInput.value.trim();
  if (!userMessage) return;

  // Add user message to chat window
  addToChat('User', userMessage);

  try {
    const data = await callApi('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessage })
    });
    addToChat('Assistant', data.reply);
    userMessageInput.value = '';
  } catch (error) {
    addToChat('Assistant', 'Error: ' + error.message);
  }
});

refreshCalcBtn.addEventListener('click', async () => {
  try {
    const data = await callApi('/api/getTaxLiability');
    taxLiabilityEl.textContent = data.liability;
    incomeEl.textContent = data.income;
    allowancesEl.textContent = data.allowances;
    expensesEl.textContent = data.expenses;
  } catch (error) {
    alert('Error fetching tax liability: ' + error.message);
  }
});

refreshFilesBtn.addEventListener('click', refreshFiles);

// Functions
function addToChat(role, message) {
  const line = document.createElement('div');
  line.classList.add('message');
  line.innerHTML = `<strong>${role}:</strong> ${message}`;
  chatWindow.appendChild(line);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function refreshFiles() {
  try {
    const data = await callApi('/api/listDocuments');
    fileList.innerHTML = '';
    data.files.forEach(file => {
      const li = document.createElement('li');
      li.textContent = `${file.fileName} (Uploaded at: ${new Date(file.uploadedAt._seconds * 1000).toLocaleString()})`;
      fileList.appendChild(li);
    });
  } catch (error) {
    alert('Error fetching files: ' + error.message);
  }
}

// Form validation example (if you have a form)
const form = document.getElementById('myForm');
form.addEventListener('submit', (event) => {
  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;

  if (name.length < 3) {
    alert('Name must be at least 3 characters long.');
    event.preventDefault();
  }

  if (!isValidEmail(email)) {
    alert('Please enter a valid email address.');
    event.preventDefault();
  }
});

function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}