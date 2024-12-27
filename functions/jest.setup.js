jest.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: jest.fn(() => ({
    accessSecretVersion: jest.fn().mockResolvedValue([{
      payload: { data: Buffer.from('test-key') }
    }])
  }))
}));

jest.mock('@google-cloud/documentai', () => ({
  v1: {
    DocumentProcessorServiceClient: jest.fn(() => ({
      processDocument: jest.fn().mockResolvedValue([{
        document: { text: 'Processed document content' }
      }])
    }))
  }
}));

jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  auth: () => ({
    verifyIdToken: jest.fn().mockResolvedValue({ uid: 'test-uid' })
  }),
  storage: () => ({
    bucket: jest.fn().mockReturnValue({
      file: jest.fn().mockReturnValue({
        save: jest.fn().mockResolvedValue([{}])
      })
    })
  }),
  firestore: () => ({
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    add: jest.fn().mockResolvedValue({ id: 'doc123' })
  })
}));

jest.mock('openai', () => ({
  OpenAI: jest.fn(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: 'Test response' } }]
        })
      }
    }
  }))
}));