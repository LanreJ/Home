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

// Middleware to authenticate requests
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
    req.user = decodedToken; // Attach user info to request
    next();
  } catch (err) {
    console.error("Authentication failed: Invalid token", err);
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

// Async error handler
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Apply Authentication Middleware to all routes
app.use(authenticateRequest);

// Helper Function: Calculate Tax Liability
function calculateTax(income, expenses, allowances = 12570) {
  const taxableIncome = Math.max(0, income - allowances - expenses);
  const liability = taxableIncome > 0 ? taxableIncome * 0.2 : 0;
  return { liability, allowances, taxableIncome };
}

// Endpoint: Upload Document
app.post(
  "/uploadDocument",
  asyncHandler(async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const busboy = new Busboy({ headers: req.headers });
    let fileBuffer = null;
    let uploadedFileName = null;

    busboy.on("file", (fieldname, file, filename) => {
      uploadedFileName = filename || "doc.pdf";
      const buffers = [];
      file.on("data", (data) => buffers.push(data));
      file.on("end", () => {
        fileBuffer = Buffer.concat(buffers);
      });
    });

    busboy.on("finish", async () => {
      if (!fileBuffer) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileName = `user-uploads/${Date.now()}-${uploadedFileName}`;
      const bucket = storage.bucket();

      try {
        await bucket.file(fileName).save(fileBuffer);
        console.log("Document uploaded:", fileName);

        const fileMeta = {
          fileName: uploadedFileName,
          storagePath: fileName,
          userId: req.user.uid,
          uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await db.collection("userFiles").add(fileMeta);

        res.json({ message: "Document uploaded and recorded.", fileMeta });
      } catch (err) {
        console.error("Error saving file to bucket:", err);
        res.status(500).json({ error: "Failed to upload file" });
      }
    });

    busboy.end(req.rawBody);
  })
);

// Endpoint: List Documents
app.get(
  "/listDocuments",
  asyncHandler(async (req, res) => {
    const userId = req.user.uid;
    try {
      const filesSnap = await db
        .collection("userFiles")
        .where("userId", "==", userId)
        .orderBy("uploadedAt", "desc")
        .get();

      const files = filesSnap.docs.map((doc) => ({
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
  "/chat",
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
      const docData = docsSnap.docs[0].data();
      context = `User income: £${docData.income}, Tax paid: £${docData.taxPaid}, Expenses: £${docData.expenses}. The user wants to complete their Self-Assessment quickly.`;
    }

    try {
      const completion = await openaiClient.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are an assistant helping a user complete their UK Self-Assessment. Use the context to minimize questions:\n${context}`,
          },
          { role: "user", content: userMessage },
        ],
      });

      const reply = completion.data.choices[0].message.content.trim();
      res.json({ reply });
    } catch (error) {
      console.error("Error communicating with OpenAI:", error);
      res.status(500).json({ error: "Failed to communicate with AI assistant." });
    }
  })
);

// Example API Endpoint
app.get("/api/hello", (req, res) => {
  res.send("Hello from Firebase Functions!");
});

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

// Export the Express app as a Firebase HTTPS function
exports.api = functions.https.onRequest(app);

// If you have other functions, export them similarly
// exports.anotherFunction = functions.https.onRequest(anotherApp);
