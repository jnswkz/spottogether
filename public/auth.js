// OAuth 2.0 Authorization Code + PKCE cho Spotify.
// PKCE khong can client_secret -> chay hoan toan phia trinh duyet an toan.

const SCOPES = [
  'user-read-playback-state',    // doc thiet bi + trang thai phat cua app Spotify
  'user-modify-playback-state',  // dieu khien play/pause/seek tren app Spotify (can Premium)
  'user-read-currently-playing',
].join(' ');

function randomString(len) {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const arr = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}

async function sha256base64url(plain) {
  const data = new TextEncoder().encode(plain);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function login(clientId, redirectUri) {
  const verifier = randomString(64);
  const challenge = await sha256base64url(verifier);
  localStorage.setItem('pkce_verifier', verifier);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

// Goi khi quay ve tu Spotify voi ?code=...
export async function handleCallback(clientId, redirectUri) {
  const code = new URLSearchParams(location.search).get('code');
  if (!code) return null;

  const verifier = localStorage.getItem('pkce_verifier');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const data = await res.json();
  saveTokens(data);
  window.history.replaceState({}, '', '/'); // xoa ?code khoi thanh dia chi
  return data;
}

function saveTokens(data) {
  if (data.access_token) {
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('expires_at', String(Date.now() + data.expires_in * 1000));
  }
  if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
}

// Tra ve access token con han; tu dong refresh neu sap het han.
export async function getValidToken(clientId) {
  const token = localStorage.getItem('access_token');
  const expiresAt = Number(localStorage.getItem('expires_at')) || 0;
  if (token && Date.now() < expiresAt - 60000) return token;

  const refresh = localStorage.getItem('refresh_token');
  if (!refresh) return null;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
  });
  const data = await res.json();
  saveTokens(data);
  return data.access_token || null;
}

export function logout() {
  ['access_token', 'refresh_token', 'expires_at', 'pkce_verifier'].forEach((k) =>
    localStorage.removeItem(k),
  );
}
