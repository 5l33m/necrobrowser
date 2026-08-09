const { baseURL, rawFetch, authHeaders } = global.testHelpers;

describe('Necrobrowser API authentication', () => {
  test('exposes only the health endpoint without credentials', async () => {
    const response = await rawFetch(`${baseURL}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  test('rejects an operator route without credentials', async () => {
    const response = await rawFetch(`${baseURL}/tasks`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  test('rejects an operator route with an invalid token', async () => {
    const response = await rawFetch(`${baseURL}/tasks`, {
      headers: { Authorization: 'Bearer incorrect-token' }
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  test('allows an operator route with the configured bearer token', async () => {
    const response = await rawFetch(`${baseURL}/tasks`, {
      headers: authHeaders
    });

    expect(response.status).toBe(200);
  });
});
