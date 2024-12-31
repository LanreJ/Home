const functions = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const OpenAI = require('openai');
import { SecretsService } from './services/SecretsService.js';

// Initialize Firebase Admin
admin.initializeApp();

// Fetch environment variables from Firebase Config
const projectId = functions.config().project.id || 'taxstats-document-ai';
const processorId = functions.config().processor.id || '937da5fa78490a0b';
const processorName = `projects/${projectId}/locations/europe-west2/processors/${processorId}`;

// Initialize Document AI
const docaiClient = new DocumentProcessorServiceClient();

// Initialize Express
const app = express();
app.use(cors({ origin: true }));
app.use(bodyParser.json());

// Initialize Secret Manager
const secrets = new SecretsService();

async function getSecretValue(secretName) {
  try {
    const name = `projects/taxstats-document-ai/secrets/${secretName}/versions/latest`;
    const [version] = await secrets.accessSecretVersion({ name });
    return version.payload.data.toString();
  } catch (error) {
    console.error(`Error accessing secret ${secretName}:`, error);
    throw new Error('Failed to access secret');
  }
}

export async function initializeSecrets() {
    const integrationSecrets = await secrets.getIntegrationSecrets();
    return integrationSecrets;
}

export { secrets };

module.exports = { getSecretValue };
