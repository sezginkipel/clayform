// Development only: run the TypeScript worker through tsx (the built package uses worker.js).
import { register } from 'tsx/esm/api';

register();
await import('./worker.ts');
