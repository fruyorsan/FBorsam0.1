import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');

  // Next.js 16: cookies() is async
  const cookieStore = await cookies();
  const storedState = cookieStore.get('google_oauth_state')?.value;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  if (!code || !returnedState || storedState !== returnedState) {
    return NextResponse.redirect(baseUrl);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  const redirectUri = `${baseUrl}/api/auth/google/callback`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }).toString(),
  });

  const tokenData = await tokenRes.json();
  const idToken: string = tokenData.id_token;

  if (!idToken) {
    return NextResponse.redirect(baseUrl);
  }

  const payloadBase64 = idToken.split('.')[1];
  const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf-8'));
  const email: string = payload.email ?? '';
  const name: string = payload.name ?? email.split('@')[0];

  const emailJson = JSON.stringify(email);
  const nameJson = JSON.stringify(name);
  const html = `<!DOCTYPE html>
<html>
<head><meta charset='utf-8'><title>Giriş Yapılıyor...</title></head>
<body>
<script>
  localStorage.setItem('f_borsam_email', ${emailJson});
  localStorage.setItem('f_borsam_nickname', ${nameJson});
  window.location.href = '/';
<\/script>
<p>Yönlendiriliyor...</p>
</body>
</html>`;

  const response = new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });

  response.cookies.set('f_borsam_session', 'active_session', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });

  response.cookies.delete('google_oauth_state');

  return response;
}
