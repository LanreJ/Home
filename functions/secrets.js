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

const functions = require("firebase-functions");
const {SecretManagerServiceClient} = require("@google-cloud/secret-manager");

// Initialize Secret Manager Client
const secretClient = new SecretManagerServiceClient();

/**
 * Retrieves a secret value from Google Secret Manager.
 * @param {string} key - The name of the secret.
 * @return {Promise<string>} - The secret value.
 */
const getSecretValueFromSecretManager = async (key) => {
  try {
    const [version] = await secretClient.accessSecretVersion({
      name: `projects/${functions.config().gcp.project}/secrets/${key}/versions/latest`,
    });
    const payload = version.payload.data.toString("utf8");
    return payload;
  } catch (error) {
    console.error(`Error accessing secret ${key} from Secret Manager:`, error);
    throw error;
  }
};

/**
 * Retrieves a secret value from Firebase Functions config.
 * @param {string} key - The configuration key in the format 'section.key'.
 * @return {Promise<string>} - The secret value.
 */
const getSecretValueFromConfig = async (key) => {
  try {
    const sections = key.split(".");
    if (sections.length !== 2) {
      throw new Error(`Invalid key format for secret retrieval: ${key}`);
    }
    const [section, secretKey] = sections;
    const value = functions.config()[section][secretKey];
    if (!value) {
      throw new Error(`Secret ${key} not found in Firebase Functions config.`);
    }
    return value;
  } catch (error) {
    console.error(`Error retrieving secret '${key}' from config:`, error);
    throw error;
  }
};

/**
 * Retrieves a secret value using Secret Manager first, then Firebase Functions config as a fallback.
 * @param {string} key - The name of the secret.
 * @return {Promise<string>} - The secret value.
 */
const getSecretValue = async (key) => {
  try {
    return await getSecretValueFromSecretManager(key);
  } catch (error) {
    console.warn(`Falling back to config for secret '${key}'`);
    return await getSecretValueFromConfig(key);
  }
};

module.exports = {getSecretValue, getSecretValueFromSecretManager, getSecretValueFromConfig};
