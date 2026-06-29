const API_BASE = '/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('jwt');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  getVaultStatus: () =>
    request<{ exists: boolean; salt?: string; kdfAlgo?: string; kdfParams?: import('../types').KdfParams }>('/vault/status'),

  createVault: (data: import('../types').CreateVaultRequest) =>
    request<import('../types').AuthResponse>('/vault/create', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  unlockVault: (data: import('../types').UnlockVaultRequest) =>
    request<import('../types').AuthResponse>('/vault/unlock', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  rekeyVault: (data: import('../types').RekeyVaultRequest) =>
    request<import('../types').AuthResponse>('/vault/rekey', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getServers: () =>
    request<import('../types').ServerEntry[]>('/servers'),

  createServer: (data: import('../types').CreateServerRequest) =>
    request<import('../types').ServerEntry>('/servers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateServer: (id: string, data: import('../types').UpdateServerRequest) =>
    request<import('../types').ServerEntry>(`/servers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteServer: (id: string) =>
    request<void>(`/servers/${id}`, { method: 'DELETE' }),
};
