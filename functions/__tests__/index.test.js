// Mock dependencies
jest.mock('busboy', () => jest.fn());

jest.mock('joi', () => ({
  object: jest.fn().mockReturnThis(),
  string: jest.fn().mockReturnThis(),
  required: jest.fn().mockReturnThis(),
  validate: jest.fn()
}));

const mockCreate = jest.fn().mockResolvedValue({
  choices: [{ message: { content: 'Test response' } }]
});

jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate
      }
    }
  }))
}));

// Mock other dependencies
jest.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: jest.fn().mockImplementation(() => ({
    accessSecretVersion: jest.fn().mockResolvedValue([{
      payload: { data: Buffer.from('test-api-key') }
    }])
  }))
}));

jest.mock('firebase-admin', () => ({
  auth: () => ({
    verifyIdToken: jest.fn().mockResolvedValue({ uid: 'test-uid' })
  }),
  firestore: () => ({
    collection: jest.fn().mockReturnThis(),
    add: jest.fn()
  }),
  initializeApp: jest.fn()
}));

// Import dependencies after mocks
const Busboy = require('busboy');
const Joi = require('joi');
const { OpenAI } = require('openai');
const admin = require('firebase-admin');

describe('API Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('chat endpoint should handle requests', async () => {
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
      body: { message: 'Test message' }
    };
    
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    // Import the api function after mocks are set up
    const { api } = require('../index');
    await api(req, res);

    expect(mockCreate).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        reply: expect.any(String)
      })
    );
  });

  test('storage bucket should be initialized', () => {
    const storageMock = admin.storage();
    const bucket = storageMock.bucket('test-bucket');
    
    expect(bucket).toBeDefined();
    expect(storageMock.bucket).toHaveBeenCalled();
  });
});