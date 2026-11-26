import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Este arquivo é o primeiro import do index.ts. Ele carrega o .env da raiz antes
// de qualquer outro módulo ler process.env (o db.ts lê DB_PATH ao ser importado).
const rootEnvPath = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}
