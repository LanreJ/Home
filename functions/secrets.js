const functions = require("firebase-functions");
const {SecretManagerServiceClient} = require("@google-cloud/secret-manager");

// Initialize Secret Manager Client
const secretClient = new SecretManagerServiceClient({
  projectId: "taxstats-document-ai",
});

/**
 * Retrieves a secret value from Google Secret Manager.
 * @param {string} key - The name of the secret.
 * @return {Promise<string>} - The secret value.
 */
const getSecretValueFromSecretManager = async (key) => {
  try {
    const projectId = functions.config().gcp.project;
    const [version] = await secretClient.accessSecretVersion({
      name: `projects/${projectId}/secrets/${key}/versions/latest`,
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

const someLongString =
  "This is a very long string that exceeds the maximum allowed line length in ESLint configuration.";

const anotherVeryLongFunctionCall = someFunction(
  param1,
  param2,
  param3,
  param4,
  param5,
  param6,
  param7
);

module.exports = {
  getSecretValue,
  getSecretValueFromSecretManager,
  getSecretValueFromConfig,
};
