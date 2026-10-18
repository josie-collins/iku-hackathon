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

// Read a sentence out loud with the backend's ElevenLabs voice. Never throws:
// the spoken confirmation is a bonus, the result is already on screen.
export async function speakAloud(groupId, text) {
  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/trips/${groupId}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch {
    // no voice, no problem
  }
}

// Money from the API is in minor units (cents, pence, kobo). Postgres bigints arrive as strings.
export function formatMoney(minor, currency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(minor) / 100);
}
