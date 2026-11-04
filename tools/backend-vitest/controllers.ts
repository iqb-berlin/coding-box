import { fileURLToPath } from 'node:url';

// Put computed filesystem imports into Vite's module graph before the smoke
// assertion starts. Every discovered controller is still loaded and checked.
const modules = import.meta.glob<Record<string, unknown>>('../../apps/backend/src/app/**/*.controller.ts', { eager: true });
export const controllerModules = Object.fromEntries(Object.entries(modules).map(([name, module]) => [fileURLToPath(new URL(name, import.meta.url)), module] as const));
