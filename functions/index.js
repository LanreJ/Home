const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai');
const { Configuration, OpenAIApi } = require('openai');
const Stripe = require('stripe');
const bodyParser = require('body-parser');
const Plaid = require('plaid');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  storageBucket: functions.config().app.storage_bucket // changed here
});

const db = admin.firestore();
const storage = admin.storage();

// Initialize Document AI Client
const documentClient = new DocumentProcessorServiceClient();

// Initialize OpenAI Client
const openaiConfig = new Configuration({
  apiKey: functions.config().openai.api_key,
});
const openai = new OpenAIApi(openaiConfig);

// Initialize Stripe
const stripe = Stripe(functions.config().stripe.secret_key);

// Initialize Plaid Client
const plaidClient = new Plaid.Client({
  clientID: functions.config().plaid.client_id,
  secret: functions.config().plaid.secret,
  env: plaid.Client.environments[functions.config().plaid.env],
});

// Initialize Express App
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Use body-parser for webhook endpoint
app.use('/webhook', bodyParser.raw({ type: 'application/json' }));

// AI Assistant Endpoint
app.post('/ai-assistant', async (req, res) => {
  const { query, userId } = req.body;

  try {
    const parsedDocsSnapshot = await db.collection('parsedDocuments')
      .where('userId', '==', userId)
      .get();

    let context = '';
    parsedDocsSnapshot.forEach(doc => {
      context += `${doc.data().fileName}: ${doc.data().parsedData}\n`;
    });

    const aiResponse = await openai.createCompletion({
      model: "text-davinci-003",
      prompt: `${context}\nUser: ${query}\nAI:`,
      max_tokens: 150,
      temperature: 0.7,
    });

    res.json({ answer: aiResponse.data.choices[0].text.trim() });
  } catch (error) {
    console.error('Error in AI Assistant:', error);
    res.status(500).json({ error: 'AI Assistant encountered an error.' });
  }
});

// Endpoint to Create Stripe Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  const { email } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{
        price: 'price_1QbjcxEmAeUZ2IYPYdX07A5K', // Replace with your Stripe Price ID
        quantity: 1,
      }],
      success_url: `https://yourdomain.com/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://yourdomain.com/cancel.html`,
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session.' });
  }
});

// Endpoint to Check Subscription Status
app.post('/check-subscription', async (req, res) => {
  const { userId } = req.body;

  try {
    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const userData = userDoc.data();
    res.json({ isSubscribed: userData.isSubscribed || false });
  } catch (error) {
    console.error('Error checking subscription status:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Stripe Webhook to Handle Subscription Events
app.post('/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = functions.config().stripe.webhook_secret;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      // Fulfill the purchase, update Firestore
      fulfillSubscription(session);
      break;
    // ... handle other event types
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// Function to Fulfill Subscription
const fulfillSubscription = async (session) => {
  const customerEmail = session.customer_email;
  
  // Find user by email and update their subscription status in Firestore
  const usersSnapshot = await db.collection('users').where('email', '==', customerEmail).get();
  
  if (usersSnapshot.empty) {
    console.error('No matching user found for email:', customerEmail);
    return;
  }

  usersSnapshot.forEach(doc => {
    doc.ref.update({ isSubscribed: true, stripeCustomerId: session.customer });
  });

  console.log('Subscription fulfilled for:', customerEmail);
};

// Create Plaid Link Token
app.post('/create-plaid-link-token', async (req, res) => {
  const { userId } = req.body;

  try {
    const tokenResponse = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: userId,
      },
      client_name: 'TaxStats AI',
      products: ['auth', 'transactions'],
      country_codes: ['US', 'GB'],
      language: 'en',
    });

    res.json({ link_token: tokenResponse.data.link_token });
  } catch (error) {
    console.error('Error creating Plaid link token:', error);
    res.status(500).json({ error: 'Failed to create link token.' });
  }
});

// Exchange Public Token for Access Token
app.post('/exchange-public-token', async (req, res) => {
  const { public_token, userId } = req.body;

  try {
    const tokenResponse = await plaidClient.itemPublicTokenExchange({
      public_token: public_token,
    });

    const accessToken = tokenResponse.data.access_token;
    const itemId = tokenResponse.data.item_id;

    // Store accessToken in Firestore
    await db.collection('users').doc(userId).update({
      plaidAccessToken: accessToken,
      plaidItemId: itemId,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error exchanging public token:', error);
    res.status(500).json({ error: 'Failed to exchange public token.' });
  }
});

// Export Express App as Cloud Function
exports.app = functions.region('europe-west2').https.onRequest(app);


