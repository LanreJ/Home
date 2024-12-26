const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

const client = new SecretManagerServiceClient({
  projectId: "taxstats-document-ai"
});

/**
 * Retrieves the value of a secret from Secret Manager.
 * @param {string} secretName - The name of the secret (e.g., "openai_api_key").
 * @returns {Promise<string>} The secret value.
 */
const getSecretValue = async (secretName) => {
  try {
    const name = `projects/taxstats-document-ai/secrets/${secretName}/versions/latest`;
    const [version] = await client.accessSecretVersion({ name });
    const payload = version.payload.data.toString();
    return payload;
  } catch (error) {
    console.error(`Error accessing secret ${secretName}:`, error);
    throw error;
  }
};

module.exports = { getSecretValue };
