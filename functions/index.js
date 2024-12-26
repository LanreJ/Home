/**
 * Import function triggers from their respective submodules:
 *
 * const { onCall } = require("firebase-functions/v2/https");
 * const { onDocumentWritten } = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

// Import required modules
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { getSecretValue } = require("./secrets");
const OpenAI = require("openai");
const express = require("express");
const cors = require("cors");
const Busboy = require("busboy");
const Joi = require("joi");

// Initialize Firebase Admin SDK with Default Credentials
admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

// =====================================================
// Add Custom Storage Bucket
// =====================================================

// Initialize a reference to the custom storage bucket
const customBucket = admin.storage().bucket("gs://taxstats-document-ai.firebasestorage.app");
const storageRef = customBucket;

// =====================================================
// Initialize Express app
// =====================================================
const app = express();

const corsOptions = {
  origin: 'https://taxstats-document-ai.web.app',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
app.use(cors({ origin: true })); // Allow all origins for the emulator

// Middleware to parse JSON bodies
app.use(express.json());

// =====================================================
// Initialize OpenAI Client
// =====================================================
let openai;

/**
 * Initializes the OpenAI client using the API key from Secret Manager or Firebase Config.
 */
const initializeOpenAI = async () => {
  try {
    const apiKey = await getSecretValue("openai_api_key");
    openai = new OpenAI({ apiKey });
    console.log("OpenAI client initialized successfully");
  } catch (error) {
    console.error("Error initializing OpenAI client:", error);
    throw error;
  }
};

// =====================================================
// Middleware to Authenticate Requests
// =====================================================
async function authenticateRequest(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer (.*)$/);
  if (!match) {
    console.error("Authentication failed: No token provided");
    return res.status(401).json({ error: "No token provided." });
  }

  const idToken = match[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Authentication failed:", error);
    return res.status(401).json({ error: "Invalid token." });
  }
}

// Apply authentication middleware to all routes below
app.use(authenticateRequest);

// =====================================================
// Define API Routes
// =====================================================

/**
 * Route: POST /chat
 * Description: Handles chat requests to communicate with the OpenAI API.
 */
app.post("/chat", async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: message }]
    });
    res.json({ reply: response.choices[0].message.content });
  } catch (error) {
    logger.error("OpenAI API error:", error);
    res.status(500).json({ error: "Failed to process request" });
  }
});

/**
 * Route: POST /submitReturn
 * Description: Handles tax return submissions and saves them to Firestore.
 */
app.post("/submitReturn", async (req, res) => {
  const { returnData } = req.body;

  if (!returnData) {
    return res.status(400).json({ error: "Return data is required." });
  }

  try {
    // Validate returnData using Joi or any other validation library if needed
    const schema = Joi.object({
      returnData: Joi.string().required(),
    });

    const { error } = schema.validate({ returnData });
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    // Process the returnData as needed
    // For example, save to Firestore
    const docRef = await db.collection("taxReturns").add({
      returnData,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userId: req.user.uid, // Assuming you pass user ID in headers via authentication
    });
    res.json({ message: "Return submitted successfully!", id: docRef.id });
  } catch (error) {
    console.error("Error submitting return:", error);
    res.status(500).json({ error: "Failed to submit return." });
  }
});

// =====================================================
// Export the Express app as a Cloud Function
// =====================================================
exports.api = onRequest({
  memory: "256MiB",
  region: "us-central1",
  maxInstances: 10
}, async (req, res) => {
  await initializeOpenAI();
  return app(req, res);
});
