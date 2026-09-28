import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { DATA_DIRECTORY, dataFile } from './dataDirectory.js';

export interface PersistedConfig {
  tushareToken?: string;
  ai?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    enabled?: boolean;
    protocol?: 'deepseek' | 'openai-compatible';
    memoryEnabled?: boolean;
    thinkingEnabled?: boolean;
    reasoningEffort?: 'auto' | 'low' | 'high' | 'max';
  };
}

const CONFIG_FILE = dataFile('config.json');
let writes: Promise<unknown> = Promise.resolve();

export async function readPersistedConfig(): Promise<PersistedConfig> {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as PersistedConfig : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function writeConfig(config: PersistedConfig): Promise<void> {
  await mkdir(DATA_DIRECTORY, { recursive: true });
  const temporary = `${CONFIG_FILE}.tmp`;
  await writeFile(temporary, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, CONFIG_FILE);
}

export function updatePersistedConfig(update: (current: PersistedConfig) => PersistedConfig): Promise<PersistedConfig> {
  const pending = writes.then(async () => {
    const config = update(await readPersistedConfig());
    await writeConfig(config);
    return config;
  });
  writes = pending.catch(() => undefined);
  return pending;
}

export async function writePersistedConfig(config: PersistedConfig): Promise<void> {
  await updatePersistedConfig(() => config);
}
