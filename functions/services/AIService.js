// ...existing code...
async function getContext(userId) {
  // Pull user data from docs, bank feeds, chats
  const documents = await getDocumentsForUser(userId);
  const transactions = await getBankFeedsForUser(userId);
  const chatHistory = await getChatHistory(userId);

  const mergedContext = {
    documents,
    transactions,
    chatHistory,
  };
  return mergedContext;
}

async function generateAIResponse(userId, query) {
  const context = await getContext(userId);
  // Provide context as part of prompt
  // ... call OpenAI with mergedContext ...
}
// ...existing code...