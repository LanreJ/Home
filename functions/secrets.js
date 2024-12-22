const functions = require("firebase-functions");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

const client = new SecretManagerServiceClient();

/**
 * Retrieves the value of a secret from Google Secret Manager.
 * @param {string} key - The name of the secret.
 * @returns {Promise<string>} - The secret's value.
 */
const getSecretValueFromSecretManager = async (key) => {
  try {
    // Retrieve the project ID from the environment variable
    const projectId = process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT_ID;

    if (!projectId) {
      throw new Error("Project ID is not defined in the environment variables.");
    }

    const secretClient = new SecretManagerServiceClient(); // Uses ADC by default

    // Construct the secret name
    const secretName = `projects/${projectId}/secrets/${key}/versions/latest`;

    // Access the secret version
    const [version] = await secretClient.accessSecretVersion({
      name: secretName,
    });

    // Extract the payload as a string
    const payload = version.payload.data.toString("utf8");
    return payload;
  } catch (err) {
    console.error(`Error accessing secret '${key}' from Secret Manager:`, err);
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

// Export the functions
module.exports = {
  getSecretValue,
  getSecretValueFromConfig,
};
