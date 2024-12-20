// functions/index.js

// Import required modules
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { getSecretValue } = require("./secrets"); // Imported from secrets.js
const Busboy = require("busboy");
const Joi = require("joi");
const { Configuration, OpenAIApi } = require("openai"); // Added import

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
    const openaiApiKey = await getSecretValue("openai.key");
    const configuration = new Configuration({ apiKey: openaiApiKey });
    openaiClient = new OpenAIApi(configuration);
    console.log("OpenAI client initialized successfully.");
  } catch (error) {
    console.error("Error initializing OpenAI client:", error);
    throw error;
  }
}

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
const app = require("express")();
app.use(require("express").json()); // To parse JSON payloads

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

// Root Endpoint
app.get("/", (req, res) =>
  res.status(200).send("Hello from Firebase Functions!")
);

// Export the Express app as a single Cloud Function
exports.api = functions.https.onRequest(app);