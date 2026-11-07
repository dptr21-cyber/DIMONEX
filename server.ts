/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * server.ts
 * DIMONEX Entry Point
 * Supports both development (tsx server.ts) and production (node server.ts).
 */

import fs from 'node:fs';
import path from 'node:path';

const isTsx = process.execArgv.some(a => a.includes('tsx'));
const bundledExists = fs.existsSync(path.resolve(process.cwd(), 'server.js'));

if (!isTsx && bundledExists) {
  import('./server.js');
} else {
  import('./server/serverApp.js');
}
