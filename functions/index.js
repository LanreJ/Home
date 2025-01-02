const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Rename Configuration imports to avoid naming collisions
const { Configuration: PlaidConfiguration, PlaidApi, PlaidEnvironments } = require('plaid');
const axios = require('axios');
const PDFDocument = require('pdfkit'); // If using pdfkit for PDF generation
const { Configuration, OpenAIApi } = require('openai');
const { PassThrough } = require('stream');
const { calculateTax } = require('./services/TaxCalculator');
const { generateSA100PDF } = require('./services/FormGenerator');

// Initialize Firebase Admin without service-account.json
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

// Initialize Express App
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Initialize OpenAI
const openaiConfig = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(openaiConfig);

// Initialize Plaid
const plaidConfig = new PlaidConfiguration({
  basePath: PlaidEnvironments[process.env.PLAID_ENVIRONMENT],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});
const plaidClient = new PlaidApi(plaidConfig);

// Multer setup for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Example Route Using Plaid
app.get('/plaid/link-token', async (req, res) => {
  try {
    const userId = req.query.userId;
    const request = {
      user: {
        client_user_id: userId,
      },
      client_name: 'TaxStats AI',
      products: ['transactions'],
      country_codes: ['GB'],
      language: 'en',
    };

    const response = await plaidClient.linkTokenCreate(request);
    return res.status(200).json({ linkToken: response.data.link_token });
  } catch (error) {
    console.error('Plaid Link Token Error:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to create Plaid link token.' });
  }
});

// Middleware to Verify Firebase ID Token
const authenticate = async (req, res, next) => {
  const idToken =
    req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.split('Bearer ')[1]
      : null;

  if (!idToken) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.userId = decodedToken.uid;
    next();
  } catch (error) {
    console.error('Authentication Error:', error);
    return res.status(403).json({ error: 'Unauthorized' });
  }
};

// Protect the upload route
app.post('/upload', authenticate, upload.array('documents'), async (req, res) => {
  try {
    const userId = req.userId;
    const files = req.files;

    if (!files) {
      return res.status(400).json({ error: 'No documents uploaded.' });
    }

    const processedDocuments = [];

    for (let file of files) {
      // Upload to Firebase Storage
      const storageRef = storage.bucket().file(`documents/${userId}/${file.originalname}`);
      await storageRef.save(file.buffer, {
        metadata: { contentType: file.mimetype },
      });
      const fileURL = `https://storage.googleapis.com/${storageRef.bucket.name}/${storageRef.name}`;

      // Process with Google Document AI
      const documentProcessorClient = new DocumentProcessorServiceClient();

      const projectId = functions.config().google.project_id;
      const processorId = functions.config().documentai.processor_id;

      const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;

      const [result] = await documentProcessorClient.processDocument({
        name,
        rawDocument: {
          content: file.buffer,
          mimeType: file.mimetype,
        },
      });

      const parsedData = result.document.text; // Extracted text; customize as needed

      // Save parsed data to Firestore
      const docRef = await db
        .collection('users')
        .doc(userId)
        .collection('parsedDocuments')
        .add({
          name: file.originalname,
          url: fileURL,
          parsedData,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

      processedDocuments.push({
        id: docRef.id,
        name: file.originalname,
        url: fileURL,
        parsedData,
      });
    }

    return res
      .status(200)
      .json({ message: 'Documents processed successfully.', documents: processedDocuments });
  } catch (error) {
    console.error('Document Upload Error:', error);
    return res
      .status(500)
      .json({ error: 'Failed to upload and process documents.' });
  }
});

// Route to retrieve Plaid transactions
app.post('/plaid/transactions', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const accessToken = req.body.accessToken; // Obtained after Plaid Link flow

    if (!accessToken) {
      return res.status(400).json({ error: 'Missing accessToken.' });
    }

    // Fetch transactions from Plaid
    const startDate = '2022-01-01'; // Customize as needed
    const endDate = '2022-12-31'; // Customize as needed

    const response = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
    });

    const transactions = response.data.transactions;

    // Save transactions to Firestore
    await db
      .collection('users')
      .doc(userId)
      .collection('bankTransactions')
      .add({
        transactions,
        retrievedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return res.status(200).json({ transactions });
  } catch (error) {
    console.error('Plaid Transactions Error:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to retrieve transactions.' });
  }
});

// Route to handle AI Assistant interactions
app.post('/ai/chat', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const userMessage = req.body.message;

    if (!userMessage) {
      return res.status(400).json({ error: 'No message provided.' });
    }

    // Retrieve parsed documents and user data from Firestore
    const documentsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('parsedDocuments')
      .get();
    const parsedDocuments = [];
    documentsSnapshot.forEach((doc) => {
      parsedDocuments.push(doc.data());
    });

    // Construct the prompt for OpenAI
    let prompt =
      'You are an AI assistant helping the user prepare their tax return. ' +
      'Use the following parsed document data to assist the user.\n\n';

    parsedDocuments.forEach((doc, index) => {
      prompt += `Document ${index + 1}: ${doc.parsedData}\n`;
    });

    prompt += `\nUser: ${userMessage}\nAI:`;

    // Call OpenAI API
    const aiResponse = await openai.createCompletion({
      model: 'text-davinci-003',
      prompt: prompt,
      max_tokens: 150,
      temperature: 0.7,
    });

    const aiMessage = aiResponse.data.choices[0].text.trim();

    // Optionally, save the conversation to Firestore
    await db.collection('users').doc(userId).collection('conversations').add({
      user: userMessage,
      ai: aiMessage,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ message: aiMessage });
  } catch (error) {
    console.error('AI Chat Error:', error);
    return res.status(500).json({ error: 'Failed to process AI request.' });
  }
});

// Route to handle AI Assistant follow-up questions
app.post('/ai/follow-up', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const userResponse = req.body.response;

    if (!userResponse) {
      return res.status(400).json({ error: 'No response provided.' });
    }

    // Retrieve necessary data from Firestore
    const parsedDocsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('parsedDocuments')
      .get();
    const parsedData = [];
    parsedDocsSnapshot.forEach((doc) => {
      parsedData.push(doc.data().parsedData);
    });

    const transactionsSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('bankTransactions')
      .get();
    const transactions = [];
    transactionsSnapshot.forEach((doc) => {
      transactions.push(...doc.data().transactions);
    });

    // Construct prompt incorporating all data
    let prompt =
      'You are an AI assistant helping the user prepare their tax return. ' +
      'Use the following data to assist the user.\n\n';

    prompt += 'Parsed Documents:\n';
    parsedData.forEach((data, index) => {
      prompt += `Document ${index + 1}: ${data}\n`;
    });

    prompt += '\nBank Transactions:\n';
    transactions.forEach((txn, index) => {
      prompt += `Transaction ${index + 1}: ${txn.category} - £${txn.amount}\n`;
    });

    prompt += `\nUser Response: ${userResponse}\nAI Assistant:`;

    // Call OpenAI API for follow-up questions or guidance
    const aiResponse = await openai.createCompletion({
      model: 'text-davinci-003',
      prompt: prompt,
      max_tokens: 150,
      temperature: 0.7,
    });

    const aiMessage = aiResponse.data.choices[0].text.trim();

    // Save the conversation to Firestore
    await db.collection('users').doc(userId).collection('conversations').add({
      user: userResponse,
      ai: aiMessage,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ message: aiMessage });
  } catch (error) {
    console.error('AI Follow-Up Error:', error);
    return res.status(500).json({ error: 'Failed to process AI follow-up.' });
  }
});

// Route to create Stripe Checkout Session
app.post('/create-checkout-session', authenticate, async (req, res) => {
  try {
    const { priceId } = req.body;
    const userId = req.userId;

    // Create Stripe Customer if not exists
    let customerId;
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists && userDoc.data().stripeCustomerId) {
      customerId = userDoc.data().stripeCustomerId;
    } else {
      const customer = await stripe.customers.create({
        metadata: { userId },
      });
      customerId = customer.id;
      await db
        .collection('users')
        .doc(userId)
        .set(
          {
            stripeCustomerId: customerId,
          },
          { merge: true }
        );
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customerId,
      success_url: 'https://yourdomain.com/success', // Replace with your success URL
      cancel_url: 'https://yourdomain.com/cancel', // Replace with your cancel URL
    });

    return res.status(200).json({ id: session.id });
  } catch (error) {
    console.error('Stripe Checkout Error:', error);
    return res.status(500).json({ error: 'Failed to create checkout session.' });
  }
});

// Route to exchange publicToken for accessToken
app.post('/plaid/exchange-token', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const { publicToken } = req.body;

    if (!publicToken) {
      return res.status(400).json({ error: 'Missing publicToken.' });
    }

    const response = await plaidClient.itemPublicTokenExchange({ public_token: publicToken });
    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    // Save accessToken to Firestore
    await db.collection('users').doc(userId).set(
      {
        plaidAccessToken: accessToken,
        plaidItemId: itemId,
      },
      { merge: true }
    );

    return res.status(200).json({ accessToken });
  } catch (error) {
    console.error('Plaid Exchange Token Error:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to exchange public token.' });
  }
});

// Route to generate SA100 Form
app.post('/generate-tax-form', authenticate, async (req, res) => {
  try {
    const userId = req.userId;

    // Retrieve all necessary data from Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User data not found.' });
    }

    const userData = userDoc.data();

    // Example: Determine which sections to include based on data
    const hasDividends =
      userData.income && userData.income.dividends && userData.income.dividends > 0;

    // Construct tax form JSON (Customize fields as needed)
    const taxForm = {
      personalDetails: {
        name: userData.name,
        address: userData.address,
        utr: userData.utr,
      },
      income: {
        employment: userData.income.employment,
        selfEmployment: userData.income.selfEmployment,
        interest: userData.income.interest,
        dividends: hasDividends ? userData.income.dividends : null,
      },
      deductions: {
        expenses: userData.deductions.expenses,
        allowances: userData.deductions.allowances,
      },
      // Add more sections as needed
    };

    // Save tax form to Firestore
    const taxFormRef = await db
      .collection('users')
      .doc(userId)
      .collection('taxForms')
      .add({
        taxForm,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return res.status(200).json({ taxFormId: taxFormRef.id, taxForm });
  } catch (error) {
    console.error('Tax Form Generation Error:', error);
    return res.status(500).json({ error: 'Failed to generate tax form.' });
  }
});

const axiosInstance = axios.create({
  baseURL: process.env.HMRC_API_URL,
  headers: {
    'Content-Type': 'application/json',
    // Add any necessary authentication headers here
  },
});

// Route to submit tax form to HMRC
app.post('/hmrc/submit-tax-form', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const { taxForm } = req.body;

    if (!taxForm) {
      return res.status(400).json({ error: 'No tax form provided.' });
    }

    // Example: Submit SA100 form to HMRC
    const response = await axiosInstance.post('/submit-sa100', taxForm);

    // Store submission status in Firestore
    await db
      .collection('users')
      .doc(userId)
      .collection('taxFormSubmissions')
      .add({
        status: response.data.status,
        submissionId: response.data.submissionId,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return res
      .status(200)
      .json({ status: response.data.status, submissionId: response.data.submissionId });
  } catch (error) {
    console.error('HMRC Submission Error:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to submit tax form to HMRC.' });
  }
});

// Route to handle Stripe Webhook Events
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      // Fulfill the purchase, activate subscription
      await fulfillSubscription(session);
      break;
    // ... handle other event types as needed ...
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// Function to fulfill subscription
const fulfillSubscription = async (session) => {
  try {
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    // Retrieve user by Stripe Customer ID
    const usersSnapshot = await db
      .collection('users')
      .where('stripeCustomerId', '==', customerId)
      .get();
    if (usersSnapshot.empty) {
      console.error('No user found for Stripe Customer ID:', customerId);
      return;
    }

    const userDoc = usersSnapshot.docs[0];
    const userId = userDoc.id;

    // Update user subscription status in Firestore
    await db.collection('users').doc(userId).update({
      subscription: {
        id: subscriptionId,
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });

    console.log(`Subscription fulfilled for user: ${userId}`);
  } catch (error) {
    console.error('Fulfill Subscription Error:', error);
  }
};

// Route to Check Subscription Status
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

// Route to Generate PDF of Tax Form
app.post('/generate-pdf', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const { taxFormId } = req.body;

    if (!taxFormId) {
      return res.status(400).json({ error: 'Missing taxFormId.' });
    }

    // Retrieve tax form data from Firestore
    const taxFormDoc = await db
      .collection('users')
      .doc(userId)
      .collection('taxForms')
      .doc(taxFormId)
      .get();

    if (!taxFormDoc.exists) {
      return res.status(404).json({ error: 'Tax form not found.' });
    }

    const taxForm = taxFormDoc.data().taxForm;

    // Generate PDF using the single pdfkit import
    const doc = new PDFDocument(); // <-- changed: use the single `PDFDocument` import

    // Set headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=SA100_TaxForm_${taxFormId}.pdf`);

    // Pipe PDF to response
    doc.pipe(res);

    // Add content to PDF
    doc.fontSize(20).text('SA100 Tax Return Form', { align: 'center' });
    doc.moveDown();

    // Personal Details
    doc.fontSize(14).text('Personal Details', { underline: true });
    doc.fontSize(12).text(`Name: ${taxForm.personalDetails.name}`);
    doc.text(`Address: ${taxForm.personalDetails.address}`);
    doc.text(`UTR: ${taxForm.personalDetails.utr}`);
    doc.moveDown();

    // Income
    doc.fontSize(14).text('Income', { underline: true });
    doc.fontSize(12).text(`Employment: £${taxForm.income.employment}`);
    doc.text(`Self-Employment: £${taxForm.income.selfEmployment}`);
    doc.text(`Interest: £${taxForm.income.interest}`);
    if (taxForm.income.dividends) {
      doc.text(`Dividends: £${taxForm.income.dividends}`);
    }
    doc.moveDown();

    // Deductions
    doc.fontSize(14).text('Deductions', { underline: true });
    doc.fontSize(12).text(`Expenses: £${taxForm.deductions.expenses}`);
    doc.text(`Allowances: £${taxForm.deductions.allowances}`);
    doc.moveDown();

    // Add more sections as needed

    // Finalize PDF
    doc.end();
  } catch (error) {
    console.error('PDF Generation Error:', error);
    return res.status(500).json({ error: 'Failed to generate PDF.' });
  }
});

// Document Upload Endpoint (updated)
app.post('/upload', upload.single('document'), async (req, res) => {
  try {
    const file = req.file;
    const userId = req.body.userId; // Assuming userId is sent in the form data

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    // Upload file to Firebase Storage
    const bucket = admin.storage().bucket();
    const blob = bucket.file(`documents/${userId}/${Date.now()}_${file.originalname}`);
    const blobStream = blob.createWriteStream({
      resumable: false,
      contentType: file.mimetype,
    });

    blobStream.on('error', (err) => {
      console.error('Upload Error:', err);
      res.status(500).json({ error: 'Failed to upload file.' });
    });

    blobStream.on('finish', async () => {
      // File uploaded successfully
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;

      // Process the document with Google Document AI
      const documentProcessor = new DocumentProcessorServiceClient();
      const [result] = await documentProcessor.processDocument({
        name: `projects/${functions.config().google.project_id}/locations/us/processors/${functions.config().documentai.processor_id}`,
        rawDocument: {
          content: file.buffer,
          mimeType: file.mimetype,
        },
      });

      // Extract parsed data (adjust based on Document AI response structure)
      const parsedData = result.document;

      // Store parsed data in Firestore
      const docRef = admin.firestore().collection('parsedDocuments').doc();
      await docRef.set({
        userId,
        fileName: file.originalname,
        storagePath: blob.name,
        publicUrl,
        parsedData: parsedData, // Adjust as needed
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.status(200).json({ message: 'File uploaded and processed successfully.', publicUrl });
    });

    blobStream.end(file.buffer);
  } catch (error) {
    console.error('Upload Endpoint Error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// AI Assistant Endpoint
app.post('/ai-assistant', async (req, res) => {
  try {
    const { userId, message } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ error: 'Missing userId or message.' });
    }

    // Retrieve parsed data from Firestore
    const parsedDocSnapshot = await admin.firestore()
      .collection('parsedDocuments')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    let parsedData = {};
    if (!parsedDocSnapshot.empty) {
      parsedData = parsedDocSnapshot.docs[0].data().parsedData;
    }

    // Retrieve bank feeds from Plaid or Firestore
    const bankFeedsSnapshot = await admin.firestore()
      .collection('bankFeeds')
      .where('userId', '==', userId)
      .get();

    let bankFeeds = [];
    bankFeedsSnapshot.forEach(doc => {
      bankFeeds.push(doc.data());
    });

    // Construct OpenAI prompt with parsedData and bankFeeds
    const prompt = `
      User ID: ${userId}
      Parsed Tax Documents: ${JSON.stringify(parsedData)}
      Bank Feeds: ${JSON.stringify(bankFeeds)}
      
      User Message: ${message}
      
      Provide assistance based on the above information.
    `;

    // Call OpenAI API
    const aiResponse = await openai.createCompletion({
      model: 'text-davinci-003',
      prompt: prompt,
      max_tokens: 150,
      temperature: 0.7,
    });

    res.status(200).json({ reply: aiResponse.data.choices[0].text.trim() });
  } catch (error) {
    console.error('AI Assistant Error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Plaid Link Token Generation Endpoint
app.post('/create-link-token', async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: req.body.userId },
      client_name: 'TaxStats AI',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });

    res.json({ link_token: response.data.link_token });
  } catch (error) {
    console.error('Create Link Token Error:', error);
    res.status(500).json({ error: 'Failed to create link token.' });
  }
});

// Plaid Exchange Public Token for Access Token
app.post('/exchange-public-token', async (req, res) => {
  try {
    const { public_token, userId } = req.body;
    const response = await plaidClient.itemPublicTokenExchange({ public_token });

    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    // Store access token securely in Firestore
    await admin.firestore().collection('users').doc(userId).set({
      plaid: {
        access_token: accessToken,
        item_id: itemId,
      },
    }, { merge: true });

    res.json({ access_token: accessToken });
  } catch (error) {
    console.error('Exchange Public Token Error:', error);
    res.status(500).json({ error: 'Failed to exchange public token.' });
  }
});

// Tax Calculation Endpoint
app.post('/calculate-tax', async (req, res) => {
  try {
    const { userId, income, deductions } = req.body;

    if (!userId || income == null || deductions == null) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const taxLiability = calculateTax(income, deductions);

    // Store calculation result in Firestore
    const calcRef = admin.firestore().collection('taxCalculations').doc();
    await calcRef.set({
      userId,
      income,
      deductions,
      taxLiability,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ taxLiability });
  } catch (error) {
    console.error('Tax Calculation Error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// SA100 Form Generation Endpoint
app.post('/generate-form', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId.' });
    }

    // Retrieve user tax calculation
    const calcSnapshot = await admin.firestore()
      .collection('taxCalculations')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    if (calcSnapshot.empty) {
      return res.status(404).json({ error: 'No tax calculations found for user.' });
    }

    const taxData = calcSnapshot.docs[0].data();

    // Retrieve parsed documents if needed
    const parsedDocSnapshot = await admin.firestore()
      .collection('parsedDocuments')
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    let parsedData = {};
    if (!parsedDocSnapshot.empty) {
      parsedData = parsedDocSnapshot.docs[0].data().parsedData;
    }

    // Generate PDF
    const pdfBuffer = generateSA100PDF(taxData, parsedData);

    // Upload PDF to Firebase Storage
    const bucket = admin.storage().bucket();
    const blob = bucket.file(`taxForms/${userId}/SA100_${Date.now()}.pdf`);
    const blobStream = blob.createWriteStream({
      resumable: false,
      contentType: 'application/pdf',
    });

    blobStream.on('error', (err) => {
      console.error('PDF Upload Error:', err);
      res.status(500).json({ error: 'Failed to upload PDF.' });
    });

    blobStream.on('finish', () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
      res.status(200).json({ formUrl: publicUrl });
    });

    blobStream.end(pdfBuffer);
  } catch (error) {
    console.error('Form Generation Error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Export the Express app as a Firebase Function in europe-west2
exports.app = functions.region('europe-west2').https.onRequest(app);


