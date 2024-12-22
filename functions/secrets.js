const functions = require("firebase-functions");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

// Initialize Secret Manager Client
const secretClient = new SecretManagerServiceClient({
  projectId: "taxstats-document-ai",
});

/**
 * Retrieves a secret value from Google Secret Manager.
 * @param {string} key - The name of the secret.
 * @returns {Promise<string>} - The secret value.
 */
const getSecretValueFromSecretManager = async (key) => {
  try {
    const projectId = functions.config().gcp.project;
    const [version] = await secretClient.accessSecretVersion({
      name: `projects/${projectId}/secrets/${key}/versions/latest`,
    });
    const payload = version.payload.data.toString("utf8");
    return payload;
  } catch (err) {
    console.error(`Error accessing secret ${key} from Secret Manager:`, err);
    throw err;
  }
};

/**
 * Retrieves a secret value from Firebase Functions config.
 * @param {string} key - The configuration key in 'section.key' format.
 * @returns {Promise<string>} - The secret value.
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
      throw new Error(`Secret '${key}' not found in Firebase config.`);
    }
    return value;
  } catch (err) {
    console.error("Error retrieving secret from config:", err);
    throw err;
  }
};

/**
 * Tries to retrieve a secret from Secret Manager.
 * Falls back to Firebase config if Secret Manager fails.
 * @param {string} key - The name of the secret.
 * @returns {Promise<string>} - The secret value.
 */
const getSecretValue = async (key) => {
  try {
    return await getSecretValueFromSecretManager(key);
  } catch (e) {
    console.warn(`Falling back to config for secret '${key}'`);
    return await getSecretValueFromConfig(key);
  }
};

module.exports = {
  getSecretValue,
  getSecretValueFromSecretManager,
  getSecretValueFromConfig,
};
