// filepath: /workspaces/Home/public/script.js

// Initialize Firebase (Client-Side)
const firebaseConfig = {
  apiKey: "AIzaSyAYXDpK8_dNn3f_c-n3q7_FCqoed-wRntk",
  authDomain: "taxstats-document-ai.firebaseapp.com",
  projectId: "taxstats-document-ai",
  storageBucket: "taxstats-document-ai.firebasestorage.app",
  messagingSenderId: "532562763606",
  appId: "1:532562763606:web:3d9b6d04e4ed23700600f7"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const storage = firebase.storage();
const db = firebase.firestore();

// Authentication and Routing
document.addEventListener('DOMContentLoaded', () => {
  const logoutButton = document.getElementById('logout');

  logoutButton?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await auth.signOut();
      window.location.href = '/login.html';
    } catch (error) {
      console.error('Logout Error:', error);
    }
  });

  auth.onAuthStateChanged((user) => {
    if (user) {
      // User is signed in
      // Optionally, you can fetch user data here
    } else {
      // No user is signed in
      window.location.href = '/login.html';
    }
  });
});

// Authentication State Listener
auth.onAuthStateChanged(user => {
  if (user) {
    // User is signed in, redirect to dashboard.html
    if (window.location.pathname !== '/dashboard') {
      window.location.href = '/dashboard.html';
    }
  } else {
    // No user is signed in, redirect to login.html
    if (window.location.pathname !== '/login') {
      window.location.href = '/login.html';
    }
  }
});

// Logout Function
logoutBtn.addEventListener('click', (e) => {
  e.preventDefault();
  auth.signOut().then(() => {
    window.location.href = '/login.html';
  }).catch((error) => {
    console.error('Error signing out:', error);
    alert('Failed to log out. Please try again.');
  });
});

// File Upload Functionality
async function uploadDocument(file) {
  try {
    const storageRef = storage.ref();
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

// Example: Upload File Functionality
const uploadFile = (file) => {
  const user = auth.currentUser;
  if (!user) {
    alert('You must be logged in to upload files.');
    return;
  }

  const storageRef = storage.ref(`documents/${user.uid}/${file.name}`);
  const uploadTask = storageRef.put(file);

  uploadTask.on('state_changed', 
    (snapshot) => {
      // Progress function
      const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
      console.log(`Upload is ${progress}% done`);
    }, 
    (error) => {
      // Error function
      console.error('Upload failed:', error);
      alert('Failed to upload file.');
    }, 
    () => {
      // Complete function
      uploadTask.snapshot.ref.getDownloadURL().then((downloadURL) => {
        console.log('File available at', downloadURL);
        // TODO: Save the downloadURL to Firestore or process as needed
      });
    }
  );
};

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

// Example: AI Assistant Query Functionality
const queryAI = async (question) => {
  try {
    const response = await fetch('/api/ai-query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ question })
    });

    if (!response.ok) {
      throw new Error('AI query failed');
    }

    const data = await response.json();
    return data.answer;
  } catch (error) {
    console.error('Error querying AI:', error);
    alert('Failed to get response from AI assistant.');
    return null;
  }
};

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

// Example: Connect Bank Account via Plaid
const connectBank = async () => {
  try {
    const response = await fetch('/api/plaid/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ /* Plaid connection data */ })
    });

    if (!response.ok) {
      throw new Error('Plaid connection failed');
    }

    const data = await response.json();
    // Handle Plaid Token or other data
  } catch (error) {
    console.error('Error connecting bank account:', error);
    alert('Failed to connect bank account.');
  }
};

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

// Example: Generate and Download SA100 Tax Form
const generateTaxForm = async (userData) => {
  try {
    const response = await fetch('/api/generate-tax-form', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(userData)
    });

    if (!response.ok) {
      throw new Error('Tax form generation failed');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SA100_tax_form.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (error) {
    console.error('Error generating tax form:', error);
    alert('Failed to generate tax form.');
  }
};