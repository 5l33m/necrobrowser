const baseURL = 'http://localhost:3000';
const apiToken = 'test-only-necrobrowser-api-token';
const rawFetch = global.fetch.bind(global);

function authenticatedFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${apiToken}`);
  return rawFetch(url, { ...options, headers });
}

// Existing API and task tests model authenticated operator traffic by default.
global.fetch = authenticatedFetch;

global.testHelpers = {
  baseURL,
  apiToken,
  rawFetch,
  authHeaders: { Authorization: `Bearer ${apiToken}` },

  // Helper to wait for task completion
  async waitForTaskCompletion(taskId, maxWaitMs = 30000) {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const response = await fetch(`${baseURL}/instrument/${taskId}`);
      const data = await response.json();

      if (data.status === 'completed' || data.status === 'error') {
        return data;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Task ${taskId} did not complete within ${maxWaitMs}ms`);
  }
};
