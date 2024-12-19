require('dotenv').config();
// const punycode = require('punycode-es');

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Firestore } = require('@google-cloud/firestore');
const axios = require('axios'); // Import axios
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const serviceAccount = require('./adminConfig.json');
const express = require('express');
const fetch = require('node-fetch');
const { Configuration, OpenAIApi } = require('openai');
const { getSecretValue } = require('./secrets');
const Busboy = require('busboy');
const Joi = require('joi');

const app = express();

const firestore = new Firestore();
const secretClient = new SecretManagerServiceClient();

// Remove any extra initializations
// admin.initializeApp();

let adminInitialized = false;

// Initialize Firebase Admin SDK
async function initializeAdmin() {
  try {
    if (!admin.apps.length) {
      const [version] = await secretClient.accessSecretVersion({
        name: 'projects/taxstats-document-ai/secrets/adminConfig/versions/latest',
      });
      const config = JSON.parse(version.payload.data.toString('utf8'));

      admin.initializeApp({
        credential: admin.credential.cert(config),
        storageBucket: 'taxstats-document-ai.appspot.com',
      });

      console.log('Firebase Admin initialized successfully.');
      adminInitialized = true;
    } else {
      console.log('Firebase Admin already initialized.');
      adminInitialized = true;
    }
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error);
    throw new Error('Failed to initialize Admin SDK');
  }
}

// Call initialization immediately
initializeAdmin().catch((err) => {
  console.error('Initialization error:', err);
});

const storage = () => {
  if (!adminInitialized) {
    throw new Error('Admin not initialized yet');
  }
  return admin.storage();
};

const bucket = () => storage().bucket('taxstats-document-ai-doc-ai-form-input');

app.use(express.json()); // To parse JSON payloads

// Middleware to ensure admin is initialized before requests
app.use((req, res, next) => {
  if (!adminInitialized) {
    return res.status(503).send('Service Unavailable: Admin SDK not initialized yet.');
  }
  next();
});

// Middleware to validate Firebase ID Token
async function validateFirebaseIdToken(req, res, next) {
  if ((!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) &&
      !(req.cookies && req.cookies.__session)) {
    return res.status(403).send('Unauthorized');
  }

  let idToken;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    idToken = req.headers.authorization.split('Bearer ')[1];
  } else {
    idToken = req.cookies.__session;
  }

  try {
    const decodedIdToken = await admin.auth().verifyIdToken(idToken);
    console.log('ID Token verified:', decodedIdToken);
    req.user = decodedIdToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(403).send('Unauthorized');
  }
}

// Apply the middleware to all routes that require authentication
app.use(validateFirebaseIdToken);

// Initialize Document AI client
const { DocumentProcessorServiceClient } = require("@google-cloud/documentai");
const documentaiClient = new DocumentProcessorServiceClient();

const PROJECT_ID = "taxstats-document-ai"; // Replace with your project ID
const LOCATION = "us"; // Replace with your processor region
const FORM_PARSER_ID = "form-parser-us"; // Replace with your form-parser ID

// Ensure docAiProcessorName is declared only once
const docAiProcessorName = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${FORM_PARSER_ID}`;

// Firestore reference
const db = admin.firestore();

// Parse Document Function
async function parseDocument(file) {
  const [buffer] = await file.download();

  const request = {
    name: docAiProcessorName,
    rawDocument: {
      content: buffer.toString('base64'),
      mimeType: 'application/pdf',
    },
  };

  const [result] = await documentaiClient.processDocument(request);
  return result.document?.text || 'No text found';
}

// Handle User Query Function
async function handleUserQuery(userId, userInput) {
  const docRef = firestore.collection('parsedDocuments').doc(userId);
  const doc = await docRef.get();

  if (!doc.exists) {
    return "I couldn't find any document data. Please upload your document first.";
  }

  const parsedData = doc.data().parsedData;

  // Use OpenAI API to interact with the user
  const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are an assistant helping with tax filing.' },
      { role: 'user', content: userInput },
      { role: 'assistant', content: `Here is the extracted document data: ${parsedData}` },
    ],
  }, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
  });

  return response.data.choices[0].message.content;
}

// Example endpoint to handle user queries
app.post('/handleUserQuery', async (req, res) => {
  const { userId, userInput } = req.body;

  if (!userId || !userInput) {
    return res.status(400).json({ error: 'Missing userId or userInput' });
  }

  try {
    const reply = await handleUserQuery(userId, userInput);
    res.status(200).json({ reply });
  } catch (error) {
    console.error('Error handling user query:', error);
    res.status(500).json({ error: 'Failed to process user query.' });
  }
});

// Set Custom Claims Endpoint
app.post('/setCustomClaims', async (req, res) => {
  const { uid, claims } = req.body;

  if (!uid || !claims) {
    return res.status(400).json({ error: 'Missing uid or claims' });
  }

  try {
    await admin.auth().setCustomUserClaims(uid, claims);
    res.status(200).send('Custom claims set successfully!');
  } catch (error) {
    console.error('Error setting custom claims:', error);
    res.status(500).json({ error: 'Failed to set custom claims.' });
  }
});

// Test Auth Endpoint
app.post('/test-auth', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Create a test user
    const userRecord = await admin.auth().createUser({
      email,
      password,
    });

    res.status(200).json({ message: 'User created successfully', userRecord });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test Storage Endpoint
app.post('/test-storage', async (req, res) => {
  const bucket = admin.storage().bucket();
  const file = bucket.file('test-file.txt');

  try {
    await file.save('This is a test file for the Storage Emulator.');
    res.status(200).send('File uploaded successfully to Storage Emulator!');
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).send('Error uploading file to Storage Emulator.');
  }
});

// Test Firestore Endpoint
app.post('/test-firestore', async (req, res) => {
  const firestore = admin.firestore();
  const docRef = firestore.collection('testCollection').doc('testDocument');

  try {
    await docRef.set({ message: 'Hello Firestore Emulator!' });
    res.status(200).send('Document written successfully to Firestore Emulator!');
  } catch (error) {
    console.error('Error writing document:', error);
    res.status(500).send('Error writing document to Firestore Emulator.');
  }
});

app.get('/', (req, res) => res.status(200).send('Hello from Firebase Functions!'));

app.get('/hosting-test', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hosting Emulator Test</title>
</head>
<body>
  <h1>Welcome to Firebase Hosting Emulator</h1>
  <p>If you see this, hosting emulator is working!</p>
</body>
</html>`);
});

app.get('/api/hello', (req, res) => {
  res.send('Hello from Firebase Functions!');
});

exports.api = functions.https.onRequest(app);

const openaiKey = process.env.OPENAI_KEY;

// Tax Calculation Function
function calculateTax(income, expenses, allowances = 12570) {
  const taxableIncome = Math.max(0, income - allowances - expenses);
  let liability = 0;
  if (taxableIncome > 0) {
    liability = taxableIncome * 0.20;
  }
  return { liability, allowances, taxableIncome };
}

// Extract data from Document AI response
function extractDataFromDocument(doc) {
  let income = 0, taxPaid = 0, expenses = 0;
  if (doc.entities) {
    for (const entity of doc.entities) {
      const val = parseFloat(entity.mentionText.replace(/[^\d.]/g, '')) || 0;
      if (entity.type === 'income') income = val;
      if (entity.type === 'tax_paid') taxPaid = val;
      if (entity.type === 'expenses') expenses = val;
    }
  }
  return {
    income,
    taxPaid,
    expenses,
    uploadedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

// Upload Document Endpoint
exports.uploadDocument = functions.https.onRequest(asyncHandler(async (req, res) => {
  await authenticateRequest(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const busboy = new Busboy({ headers: req.headers });
    let fileBuffer = null;
    let uploadedFileName = null;

    busboy.on('file', (fieldname, file, filename) => {
      uploadedFileName = filename || 'doc.pdf';
      const buffers = [];
      file.on('data', (data) => buffers.push(data));
      file.on('end', () => {
        fileBuffer = Buffer.concat(buffers);
      });
    });

    busboy.on('finish', async () => {
      if (!fileBuffer) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const fileName = `user-uploads/${Date.now()}-${uploadedFileName}`;
      const bucket = storage().bucket();

      try {
        await bucket.file(fileName).save(fileBuffer);

        // Store file metadata in Firestore
        const fileMeta = {
          fileName: uploadedFileName,
          storagePath: fileName,
          userId: req.user.uid,
          uploadedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('userFiles').add(fileMeta);

        res.json({ message: 'Document uploaded. Processing will start soon.', fileMeta });
      } catch (err) {
        console.error('Error saving file to bucket:', err);
        res.status(500).json({ error: 'Failed to upload file' });
      }
    });

    busboy.end(req.rawBody);
  });
}));

// Process Document Trigger
exports.processDocument = functions.storage.object().onFinalize(async (object) => {
  const filePath = object.name;
  if (!filePath.startsWith('user-uploads/')) return;

  const bucket = storage().bucket(object.bucket);
  const [fileData] = await bucket.file(filePath).download();

  const request = {
    name: docAiProcessorName,
    rawDocument: {
      content: fileData.toString('base64'),
      mimeType: 'application/pdf',
    },
  };

  const [result] = await documentaiClient.processDocument(request);
  const doc = result.document;
  const extractedData = extractDataFromDocument(doc);

  await db.collection('documents').doc(filePath).set(extractedData);
});

// Chat Endpoint
exports.chat = functions.https.onRequest(asyncHandler(async (req, res) => {
  await authenticateRequest(req, res, async () => {
    const userMessage = req.body.userMessage || '';
    if (!openaiClient) {
      await initOpenAI();
    }

    const docsSnap = await db.collection('documents').orderBy('uploadedAt', 'desc').limit(1).get();
    let context = 'No documents found.';
    if (!docsSnap.empty) {
      const docData = docsSnap.docs[0].data();
      context = `User income: £${docData.income}, Tax paid: £${docData.taxPaid}, Expenses: £${docData.expenses}. 
The user wants to complete their Self-Assessment quickly. Ask minimal questions to fill any gaps.`;
    }

    const completion = await openaiClient.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        { role: 'system', content: `You are an assistant helping a user complete their UK Self-Assessment. Use the context to minimize questions:\n${context}` },
        { role: 'user', content: userMessage }
      ]
    });

    const reply = completion.data.choices[0].message.content.trim();
    res.json({ reply });
  });
}));

// Tax Liability Endpoint
exports.getTaxLiability = functions.https.onRequest(asyncHandler(async (req, res) => {
  await authenticateRequest(req, res, async () => {
    const docsSnap = await db.collection('documents').orderBy('uploadedAt', 'desc').limit(1).get();
    let liability = 0, income = 0, allowances = 12570, expenses = 0;
    if (!docsSnap.empty) {
      const docData = docsSnap.docs[0].data();
      income = docData.income || 0;
      expenses = docData.expenses || 0;
      const { liability: calcLiability } = calculateTax(income, expenses, allowances);
      liability = calcLiability;
    }

    res.json({ liability, income, allowances, expenses });
  });
}));

// HMRC Submission Endpoint (Stub)
exports.submitReturn = functions.https.onRequest(asyncHandler(async (req, res) => {
  await authenticateRequest(req, res, async () => {
    const docsSnap = await db.collection('documents').orderBy('uploadedAt', 'desc').limit(1).get();
    if (docsSnap.empty) {
      return res.status(400).json({ error: 'No documents found to submit.' });
    }
    const docData = docsSnap.docs[0].data();

    const hmrcPayload = {
      taxYear: "2023/2024",
      income: docData.income || 0,
      expenses: docData.expenses || 0,
      taxPaid: docData.taxPaid || 0
    };

    // Future implementation for HMRC API submission

    res.json({ message: 'Submission successful (stub)' });
  });
}));

// List Documents Endpoint
exports.listDocuments = functions.https.onRequest(asyncHandler(async (req, res) => {
  await authenticateRequest(req, res, async () => {
    const userId = req.user.uid;
    try {
      const filesSnap = await db.collection('userFiles')
        .where('userId', '==', userId)
        .orderBy('uploadedAt', 'desc')
        .get();

      const files = filesSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      res.json({ files });
    } catch (err) {
      console.error('Error listing documents:', err);
      res.status(500).json({ error: 'Failed to list documents' });
    }
  });
}));

// User Input Validation Example
const userSchema = Joi.object({
  name: Joi.string().min(3).required(),
  email: Joi.string().email().required(),
});

exports.createUser = functions.https.onRequest(asyncHandler(async (req, res) => {
  const { name, email } = req.body;

  const { error } = userSchema.validate({ name, email });
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  // Proceed with creating the user
  res.json({ message: 'User validated and can be created.' });
}));

// Load OpenAI API Key from Secret Manager
let openai;
async function initializeOpenAI() {
  const openaiApiKey = await getSecretValue('openai_api_key');
  const configuration = new Configuration({
    apiKey: openaiApiKey,
  });
  openai = new OpenAIApi(configuration);
}

initializeOpenAI().catch(console.error);

// Initialize OpenAI client
let openaiClient;
async function initOpenAI() {
  if (!openaiApiKey) {
    await loadSecrets();
  }
  if (!openaiApiKey) {
    await loadSecrets();
  }
  openaiClient = new OpenAIApi(new Configuration({ apiKey: openaiApiKey }));
}
initOpenAI().catch(console.error);

let openaiApiKey;
async function loadSecrets() {
  openaiApiKey = await getSecretValue('openai_api_key');
}
loadSecrets().catch(console.error);

// Async error handler
function asyncHandler(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error('Function error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  };
}

// Authentication Middleware
async function authenticateRequest(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer (.*)$/);
  if (!match) {
    return res.status(401).json({ error: 'No token provided.' });
  }

  const idToken = match[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Tax Calculation Function
function calculateTax(income, expenses, allowances = 12570) {
  const taxableIncome = Math.max(0, income - allowances - expenses);
  let liability = 0;
  if (taxableIncome > 0) {
    liability = taxableIncome * 0.20;
  }
  return { liability, allowances, taxableIncome };
}

// Extract data from Document AI response
function extractDataFromDocument(doc) {
  let income = 0, taxPaid = 0, expenses = 0;
  if (doc.entities) {
    for (const entity of doc.entities) {
      const val = parseFloat(entity.mentionText.replace(/[^\d.]/g, '')) || 0;
      if (entity.type === 'income') income = val;
      if (entity.type === 'tax_paid') taxPaid = val;
      if (entity.type === 'expenses') expenses = val;
    }
  }
  return {
    income,
    taxPaid,
    expenses,
    uploadedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

// Document AI Setup
const docAiClient = new DocumentProcessorServiceClient();
const docAiProcessorId = functions.config().docai.processor_id;
const docAiProcessorLocation = functions.config().docai.location || 'us';
const docAiProjectId = functions.config().docai.project_id;

// Declare once
const docAiProcessorName = `projects/${docAiProjectId}/locations/${docAiProcessorLocation}/processors/${docAiProcessorId}`;

// Correct usage of storage
exports.onFileUpload = functions.storage.object().onFinalize(async (object) => {
  // Your code here
});