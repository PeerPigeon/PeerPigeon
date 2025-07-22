/**
 * Mock unsea crypto library for testing
 */
import { jest } from '@jest/globals';

// Mock sea functions
const mockSea = {
  work: jest.fn().mockResolvedValue('mock-hashed-password'),
  pair: jest.fn().mockResolvedValue({
    pub: 'mock-public-key',
    priv: 'mock-private-key',
    epriv: 'mock-encrypted-private-key',
    epub: 'mock-encrypted-public-key'
  }),
  encrypt: jest.fn().mockResolvedValue('mock-encrypted-data'),
  decrypt: jest.fn().mockResolvedValue('mock-decrypted-data'),
  sign: jest.fn().mockResolvedValue('mock-signature'),
  verify: jest.fn().mockResolvedValue(true)
};

export { mockSea as sea };
export default mockSea;
