import { createServer } from 'node:http';
import handler from '../api/group-tabs.js';

export const server = createServer((req, res) => {
  if (req.url?.split('?')[0] !== '/api/group-tabs') {
    res.writeHead(404, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({
        error: { code: 'NOT_FOUND', message: 'Route not found.' },
      }),
    );
    return;
  }
  void handler(req, res);
});
server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.listen(3000, '127.0.0.1', () =>
  console.info('TidyTabs backend listening on http://127.0.0.1:3000'),
);

// local development server
