// functions/index.js

// Import required modules
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { getSecretValue } = require("./secrets"); // Imported from secrets.js
const Busboy = require("busboy");
const Joi = require("joi");
const { Configuration, OpenAIApi } = require("openai"); // Added import
const express = require("express");

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.applicationDefault(), // Using default credentials
  storageBucket: "taxstats-document-ai.appspot.com", // Replace with your bucket name
});
const db = admin.firestore();
const storage = admin.storage();

// Initialize OpenAI Client
let openaiClient;

async function initializeOpenAI() {
  try {
    const openaiApiKey = await getSecretValue("openai.key"); // Replace 'openai.key' with the correct key
    const configuration = new Configuration({
      apiKey: openaiApiKey,
    });
    openaiClient = new OpenAIApi(configuration);
    console.log("OpenAI client initialized successfully.");
  } catch (error) {
    console.error("Error initializing OpenAI client:", error);
    throw error;
  }
}

// Define Document AI Processor Details
const PROJECT_ID = "taxstats-document-ai"; // Replace with your project ID
const LOCATION = "us"; // Replace with your processor location
const PROCESSOR_ID = functions.config().docai.processor_id; // Set via Firebase config

// Removed unused variable 'DOC_AI_PROCESSOR_NAME'

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
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error("Function error:", err);
      res.status(500).json({ error: "Internal server error" });
    });
  };
}

// Initialize Express App
const app = express();
app.use(express.json()); // To parse JSON payloads

// Apply Authentication Middleware to all routes
app.use(authenticateRequest);

// Helper Function: Calculate Tax Liability
function calculateTax(income, expenses, allowances = 12570) {
  const taxableIncome = Math.max(0, income - allowances - expenses);
  let liability = 0;
  if (taxableIncome > 0) {
    // Basic rate calculation, can be expanded for actual UK tax bands
    liability = taxableIncome * 0.2;
  }
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

        // Store file metadata in Firestore
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
      const doc = docsSnap.docs[0];
      const docData = doc.data();
      // Removed unused variable 'docData'
      context = `User income: £${docData.income}, Tax paid: £${docData.taxPaid}, Expenses: £${docData.expenses}. The user wants to complete their Self-Assessment quickly. Ask minimal questions to fill any gaps.`;
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
      res
        .status(500)
        .json({ error: "Failed to communicate with AI assistant." });
    }
  })
);

// Endpoint: Get Tax Liability
app.get(
  "/getTaxLiability",
  asyncHandler(async (req, res) => {
    const docsSnap = await db
      .collection("documents")
      .orderBy("uploadedAt", "desc")
      .limit(1)
      .get();
    let liability = 0,
      income = 0,
      allowances = 12570,
      expenses = 0;
    if (!docsSnap.empty) {
      const doc = docsSnap.docs[0];
      const docData = doc.data();
      income = docData.income || 0;
      expenses = docData.expenses || 0;
      const { liability: calcLiability } = calculateTax(
        income,
        expenses,
        allowances
      );
      liability = calcLiability;
    }

    res.json({ liability, income, allowances, expenses });
  })
);

// Endpoint: Submit Return (HMRC Integration - Stub)
app.post(
  "/submitReturn",
  asyncHandler(async (req, res) => {
    const docsSnap = await db
      .collection("documents")
      .orderBy("uploadedAt", "desc")
      .limit(1)
      .get();
    if (docsSnap.empty) {
      return res.status(400).json({ error: "No documents found to submit." });
    }
    const doc = docsSnap.docs[0];
    const docData = doc.data();

    // Since it's a stub, return a placeholder response
    res.json({ message: "Submission successful (stub)" });
  })
);

// Example Endpoint: Create User with Validation
app.post(
  "/createUser",
  asyncHandler(async (req, res) => {
    const { name, email } = req.body;

    // Define Joi schema for validation
    const userSchema = Joi.object({
      name: Joi.string().min(3).required(),
      email: Joi.string().email().required(),
    });

    // Validate input
    const { error } = userSchema.validate({ name, email });
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    // Additional email format validation if needed
    const isValidEmail = (email) => {
      const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return regex.test(email);
    };
    if (!isValidEmail(email)) {
      return res
        .status(400)
        .json({ error: "Please enter a valid email address." });
    }

    try {
      // Create user in Firebase Auth
      const userRecord = await admin.auth().createUser({
        email,
        displayName: name,
      });
      res
        .status(200)
        .json({ message: "User created successfully", userRecord });
    } catch (err) {
      console.error("Error creating user:", err);
      res.status(500).json({ error: "Failed to create user." });
    }
  })
);

// Example Endpoint: Test Storage
app.post(
  "/test-storage",
  asyncHandler(async (req, res) => {
    const bucket = storage.bucket();
    const file = bucket.file("test-file.txt");

    try {
      await file.save("This is a test file for the Storage Emulator.");
      res.status(200).send("File uploaded successfully to Storage!");
    } catch (error) {
      console.error("Error uploading file:", error);
      res.status(500).send("Error uploading file to Storage.");
    }
  })
);

// Example Endpoint: Test Firestore
app.post(
  "/test-firestore",
  asyncHandler(async (req, res) => {
    const testData = { message: "Hello Firestore!" };
    const docRef = db.collection("testCollection").doc("testDocument");

    try {
      await docRef.set(testData);
      res.status(200).send("Document written successfully to Firestore!");
    } catch (error) {
      console.error("Error writing document:", error);
      res.status(500).send("Error writing document to Firestore.");
    }
  })
);

// Root Endpoint
app.get("/", (req, res) =>
  res.status(200).send("Hello from Firebase Functions!")
);

// Hosting Test Endpoint
app.get("/hosting-test", (req, res) => {
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

// Example API Endpoint
app.get("/api/hello", (req, res) => {
  res.send("Hello from Firebase Functions!");
});

// Export the Express app as a single Cloud Function
exports.api = functions.https.onRequest(app);

// Remove or comment out any app.listen():
// app.listen(PORT, () => {
//   console.log(`Listening on port ${PORT}`);
