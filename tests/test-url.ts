export const appUrl = `http://localhost:${process.env.YBUY_TEST_PORT ?? '5174'}`;
export const appWebSocketUrl = appUrl.replace(/^http:/, 'ws:');
