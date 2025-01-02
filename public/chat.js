document.getElementById('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const messageInput = document.getElementById('message');
  const message = messageInput.value.trim();
  const userId = 'USER_ID_HERE'; // Replace with authenticated user's ID

  if (!message) return;

  // Display user's message
  const chatBox = document.getElementById('chatBox');
  chatBox.innerHTML += `<p><strong>You:</strong> ${message}</p>`;
  chatBox.scrollTop = chatBox.scrollHeight;

  messageInput.value = '';

  try {
    const response = await fetch('/ai-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, message }),
    });

    const result = await response.json();
    if (response.ok) {
      chatBox.innerHTML += `<p><strong>AI:</strong> ${result.reply}</p>`;
      chatBox.scrollTop = chatBox.scrollHeight;
    } else {
      chatBox.innerHTML += `<p><strong>Error:</strong> ${result.error}</p>`;
    }
  } catch (error) {
    console.error('AI Assistant Error:', error);
    chatBox.innerHTML += `<p><strong>Error:</strong> Failed to get response.</p>`;
  }
});