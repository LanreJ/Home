const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai');
const { Configuration: OpenAIConfiguration, OpenAIApi } = require('openai'); // Alias OpenAI Configuration
const Stripe = require('stripe');
const bodyParser = require('body-parser');
const { Configuration: PlaidConfiguration, PlaidApi, Environments } = require('plaid'); // Alias Plaid Configuration

// Logging Configuration Objects
console.log('OpenAIApi:', OpenAIApi); // Safe to log non-sensitive parts

// Initialize Firebase Admin without explicit credentials
admin.initializeApp({
  storageBucket: functions.config().app.storage_bucket
});

const db = admin.firestore();
const storage = admin.storage();

// Initialize Document AI
const documentClient = new DocumentProcessorServiceClient();

// Initialize OpenAI
const openaiConfig = new OpenAIConfiguration({
  apiKey: functions.config().openai.api_key,
});
const openai = new OpenAIApi(openaiConfig);

// Initialize Stripe
let stripe;
try {
  stripe = Stripe(functions.config().stripe.secret_key);
  console.log('Stripe initialized successfully');
} catch (error) {
  console.error('Error initializing Stripe:', error);
}

// Initialize Plaid
let plaidClient;
try {
  const plaidEnv = functions.config().plaid.env.toLowerCase();

  if (!Environments[plaidEnv]) {
    throw new Error(`Invalid Plaid environment: ${plaidEnv}`);
  }

  const configuration = new PlaidConfiguration({
    basePath: Environments[plaidEnv],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': functions.config().plaid.client_id,
        'PLAID-SECRET': functions.config().plaid.secret,
      },
    },
  });

  plaidClient = new PlaidApi(configuration);
  console.log('Plaid initialized successfully');
} catch (error) {
  console.error('Error initializing Plaid:', error);
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
app.use('/webhook', bodyParser.raw({ type: 'application/json' }));

// AI Assistant Endpoint
app.post('/ai-assistant', async (req, res) => {
  const { query, userId } = req.body;
  try {
    const parsedDocsSnapshot = await db
      .collection('parsedDocuments')
      .where('userId', '==', userId)
      .get();

    let context = '';
    parsedDocsSnapshot.forEach((doc) => {
      const { fileName, parsedData = '' } = doc.data();
      context += `\nFilename: ${fileName}, Content: ${parsedData}`;
    });

    const completion = await openai.createCompletion({
      model: 'text-davinci-003',
      prompt: `Context: ${context}\nUser: ${query}\nAI:`,
      max_tokens: 150,
      temperature: 0.7
    });

    res.json({ answer: completion.data.choices[0].text.trim() });
  } catch (error) {
    console.error('AI error:', error);
    res.status(500).json({ error: 'AI assistant error.' });
  }
});

// Check Subscription Endpoint
app.post('/check-subscription', async (req, res) => {
  const { userId } = req.body;
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.json({ isSubscribed: false });
    }
    const { isSubscribed = false } = userDoc.data();
    res.json({ isSubscribed });
  } catch (error) {
    console.error('Subscription error:', error);
    res.status(500).json({ error: 'Subscription check failed.' });
  }
});

// Create Checkout Session (Stripe)
app.post('/create-checkout-session', async (req, res) => {
  const { email } = req.body;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [
        {
          price: functions.config().stripe.price_id, // Use config variable
          quantity: 1
        }
      ],
      success_url: 'https://yourdomain.com/success', // Replace with your actual success URL
      cancel_url: 'https://yourdomain.com/cancel' // Replace with your actual cancel URL
    });
    res.json({ id: session.id });
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: 'Stripe session creation failed.' });
  }
});

// Plaid Endpoints (example: getTransactions)
app.post('/plaid/transactions', async (req, res) => {
  const { userId, startDate, endDate } = req.body;
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const { plaidAccessToken } = userDoc.data();
    const response = await plaidClient.getTransactions(
      plaidAccessToken,
      startDate,
      endDate
    );
    res.json(response.data);
  } catch (error) {
    console.error('Plaid error:', error);
    res.status(500).json({ error: 'Failed to retrieve transactions.' });
  }
});

// HMRC Submission Example
app.post('/hmrc-submit', async (req, res) => {
  try {
    // Implementation for HMRC API call to submit tax form
    // Example placeholder
    res.json({ success: true, message: 'Submitted SA100 to HMRC.' });
  } catch (error) {
    console.error('HMRC error:', error);
    res.status(500).json({ error: 'Failed to submit to HMRC.' });
  }
});

// Export the Express app as a Firebase Function
exports.app = functions.region('europe-west2').https.onRequest(app);


