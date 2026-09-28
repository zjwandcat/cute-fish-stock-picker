export async function aiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/ai${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });
  const body = await response.json() as { success?: boolean; data?: T; error?: string };
  if (!response.ok || body.success === false) {
    throw new Error(body.error || `请求失败 (${response.status})`);
  }
  return body.data as T;
}
