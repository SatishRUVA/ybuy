export const appUrl = process.env.YBUY_TEST_URL ?? 'http://localhost:5174';
export const appWebSocketUrl = appUrl.replace(/^http:/, 'ws:');
