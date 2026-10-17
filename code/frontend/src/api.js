// Calls the backend. In development, package.json's "proxy" forwards /api to localhost:8080.
export async function api(path, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// Money from the API is in minor units (cents, pence, kobo). Postgres bigints arrive as strings.
export function formatMoney(minor, currency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(minor) / 100);
}
