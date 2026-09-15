import { join, resolve } from 'node:path';

/** Portable releases set this to a writable directory outside the application. */
export const DATA_DIRECTORY = resolve(process.env.CUTE_FISH_DATA_DIR || join(process.cwd(), 'api', 'data'));

export function dataFile(name: string): string {
  return join(DATA_DIRECTORY, name);
}
