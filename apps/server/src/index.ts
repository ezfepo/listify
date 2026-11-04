import { buildApp } from './app.js';

const PORT = 8787;
const HOST = '127.0.0.1';

const app = await buildApp();

app.listen({ port: PORT, host: HOST }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
