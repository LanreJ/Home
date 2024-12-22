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
const { getSecretValue, getSecretValueFromConfig } = require("./secrets"); // Updated import
const Busboy = require("busboy");
const Joi = require("joi");
const { Configuration, OpenAIApi } = require("openai"); // Added import
const express = require("express"); // Ensure express is imported

// Initialize Firebase Admin SDK with Default Credentials
admin.initializeApp({
  credential: admin.credential.applicationDefault(), // Uses ADC by default
  storageBucket: "taxstats-document-ai.appspot.com", // Replace with your bucket name
});
const db = admin.firestore();
const storage = admin.storage();

// Initialize Express app
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Initialize OpenAI Client
let openaiClient;

/**
 * Initializes the OpenAI client using the API key from Secret Manager.
 */
const initializeOpenAI = async () => {
  try {
    const openaiApiKey = await getSecretValue("openai.key"); // Ensure 'openai.key' is the correct secret name
    const configuration = new Configuration({
      apiKey: openaiApiKey,
    });
    openaiClient = new OpenAIApi(configuration);
    console.log("OpenAI client initialized successfully.");
  } catch (err) {
    console.error("Error initializing OpenAI client:", err);
  }
};

// Initialize OpenAI when functions start
initializeOpenAI();

// Serve HTML for Hosting Emulator
app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Firebase Hosting Emulator</title>
</head>
<body>
  <h1>Welcome to Firebase Hosting Emulator</h1>
  <p>If you see this, hosting emulator is working!</p>
</body>
</html>`);
});

// Example API Endpoint
app.get("/api/hello", (req, res) => {
  res.send("Hello from Firebase Functions!");
});

// Example API Endpoint: List Documents
app.get(
  "/api/listDocuments",
  asyncHandler(async (req, res) => {
    try {
      const snapshot = await db.collection("documents").get();
      const files = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      res.json({ files });
    } catch (err) {
      console.error("Error listing documents:", err);
      res.status(500).json({ error: "Failed to list documents" });
    }
  })
);

// Endpoint: Chat with OpenAI
app.post(
  "/api/chat",
  asyncHandler(async (req, res) => {
    const userMessage = req.body.userMessage || "";
    if (!openaiClient) {
      await initializeOpenAI();
    }

    const docsSnap = await db
      .collection("documents")
      .orderBy("uploadedAt", "desc")
      .limit(1)
      .get();
    let context = "No documents found.";

    if (!docsSnap.empty) {
      const doc = docsSnap.docs[0];
      context = doc.data().content;
    }

    try {
      const response = await openaiClient.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: userMessage },
          { role: "assistant", content: context },
        ],
      });

      const reply = response.data.choices[0].message.content;
      res.json({ reply });
    } catch (err) {
      console.error("Error communicating with OpenAI:", err);
      res.status(500).json({ error: "Failed to communicate with OpenAI" });
    }
  })
);

/**
 * Helper function to handle async errors in Express routes.
 * @param {Function} fn - The async function to wrap.
 * @returns {Function} - The wrapped function.
 */
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Export the Express app as a Firebase HTTPS function
exports.app = functions.https.onRequest(app);

// If you have other functions, export them similarly
// exports.anotherFunction = functions.https.onRequest(anotherApp);

// Optional: Listen on port only if not running in Firebase Functions environment

}

// Remove or comment out this block
/*
const PORT = process.env.PORT || 8332;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
*/
