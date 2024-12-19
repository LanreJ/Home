/**
 * secrets.js
 * 
 * This module handles retrieving sensitive secrets and configuration values.
 * 
 * - Secrets from Google Secret Manager:
 *   Store your API keys (e.g., OpenAI, HMRC credentials) in Secret Manager. 
 *   For example, create a secret named "openai_api_key" and store your OpenAI key in it.
 *
 *   Usage:
 *     const openaiApiKey = await getSecretValue('openai_api_key');
 * 
 * - Environment variables or Firebase Functions Config:
 *   Certain non-sensitive configuration values (like IDs or locations) can be set as environment variables
 *   or via `firebase functions:config:set`.
 *   
 *   Usage:
 *     const functions = require('firebase-functions');
 *     const docAiProcessorId = functions.config().docai.processor_id; 
 *     const docAiLocation = functions.config().docai.location; 
 *
 *   OR from process.env if you’ve set them at deployment time:
 *     const docAiProcessorId = process.env.DOC_AI_PROCESSOR_ID;
 *     const docAiLocation = process.env.DOC_AI_LOCATION;
 *
 *   Choose one approach and stick to it for consistency.
 */

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// Initialize Secret Manager Client
const client = new SecretManagerServiceClient();

// Cache to store secrets
const secretCache = {};

// Cache expiration time (in milliseconds) - e.g., 5 minutes
const cacheExpiration = 5 * 60 * 1000; 

/**
 * Fetches a secret value from Google Secret Manager.
 * Assumes you have created a secret with the name `secretName`.
 * Example:
 *   echo "your-api-key" > key.txt
 *   gcloud secrets create openai_api_key --data-file=key.txt
 * 
 * To grant Cloud Functions access:
 *   gcloud secrets add-iam-policy-binding openai_api_key \
 *     --member=serviceAccount:invoker-sa@taxstats-document-ai.iam.gserviceaccount.com \
 *     --role=roles/secretmanager.secretAccessor
 * 
 * @param {string} secretName - The name of the secret (e.g., 'openai_api_key').
 * @returns {Promise<string>} - The secret value.
 */
async function getSecretFromSecretManager(secretName) {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;

  if (!projectId) {
    throw new Error('GCP_PROJECT environment variable is not set.');
  }

  const [version] = await client.accessSecretVersion({
    name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
  });

  const payload = version.payload.data.toString('utf8');
  return payload;
}

/**
 * Retrieves a secret value with caching to minimize Secret Manager calls.
 * 
 * @param {string} secretName - The name of the secret to retrieve.
 * @returns {Promise<string>} - The secret value.
 */
async function getSecretValue(secretName) {
  // Check if secret is in cache and not expired
  if (secretCache[secretName] && secretCache[secretName].expiresAt > Date.now()) {
    return secretCache[secretName].value;
  }

  // If not in cache or expired, fetch from Secret Manager
  const secretValue = await getSecretFromSecretManager(secretName); 
  secretCache[secretName] = { value: secretValue, expiresAt: Date.now() + cacheExpiration };
  return secretValue;
}

// Example usage:
// To retrieve your OpenAI API key from Secret Manager:
// const openaiApiKey = await getSecretValue('openai_api_key');

// If you choose to store Document AI processor info in secrets, you might do:
// const docAiProcessorId = await getSecretValue('doc_ai_processor_id');
// const docAiLocation = await getSecretValue('doc_ai_location');
// const docAiProjectId = await getSecretValue('doc_ai_project_id');

// Otherwise, if not sensitive, fetch them from functions config or environment variables:
// const functions = require('firebase-functions');
// const docAiProcessorId = functions.config().docai.processor_id;
// const docAiLocation = functions.config().docai.location;
// const docAiProjectId = functions.config().docai.project_id;

module.exports = { getSecretValue };