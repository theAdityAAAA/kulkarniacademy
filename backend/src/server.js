import { createServer } from 'node:http';

// Foundation only. Trial enquiries currently go directly to WhatsApp.
const port = Number(process.env.PORT) || 3001;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method === 'GET' && request.url === '/api/health') {
    response.writeHead(200);
    response.end(JSON.stringify({ status: 'ok', service: 'kulkarni-academy-api' }));
    return;
  }
  response.writeHead(404);
  response.end(JSON.stringify({ error: 'Not found' }));
});
server.listen(port, '127.0.0.1', () => console.log(`Academy API outline: http://127.0.0.1:${port}`));
