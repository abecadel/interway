// Started by `node server.mjs` in the container (see service/Dockerfile).
import { main } from './server';

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
