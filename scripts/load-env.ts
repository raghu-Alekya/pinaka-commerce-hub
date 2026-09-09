import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

// Load before AppModule and repository initialization, regardless of shell cwd.
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) loadEnvFile(envPath);
