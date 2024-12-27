const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const secrets = new SecretManagerServiceClient({
  keyFilename: './key-file.json',
  projectId: 'taxstats-document-ai'
});

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

module.exports = { getSecretValue };
