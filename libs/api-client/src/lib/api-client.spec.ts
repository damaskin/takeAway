import { createApiClient } from './api-client';

describe('api-client', () => {
  it('returns the provided config', () => {
    const client = createApiClient({ baseUrl: 'http://localhost:3000/api' });
    expect(client.baseUrl).toBe('http://localhost:3000/api');
  });
});
