// VAPID 서명. 페이로드를 싣지 않으므로 암호화는 필요 없고 JWT 서명만 있으면 된다.
const encoder = new TextEncoder();

export function base64url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function audienceOf(endpoint) {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

// exp가 24시간을 넘으면 푸시 서비스가 거절한다. 6시간이면 충분하다.
export function vapidClaims(endpoint, subject, now = Date.now()) {
  const aud = audienceOf(endpoint);
  if (!aud) return null;
  return { aud, exp: Math.floor(now / 1000) + 6 * 60 * 60, sub: subject };
}

export async function signVapid(claims, jwk) {
  const header = base64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("jwk", { ...jwk, key_ops: ["sign"], ext: true },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // ES256 서명은 DER이 아니라 r‖s 64바이트 원시 형식이어야 한다. Web Crypto가 그렇게 준다.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(signingInput));
  return `${signingInput}.${base64url(signature)}`;
}

export async function authorizationHeader(endpoint, env, now = Date.now()) {
  const claims = vapidClaims(endpoint, env.VAPID_SUBJECT || "mailto:contact@salarycrew.com", now);
  if (!claims) return null;
  const token = await signVapid(claims, JSON.parse(env.VAPID_PRIVATE_JWK));
  return `vapid t=${token}, k=${env.VAPID_PUBLIC_KEY}`;
}

// 빈 푸시를 보낸다. 내용은 서비스 워커가 /api/push/alerts에서 받아 간다.
export async function sendPush(endpoint, env, now = Date.now()) {
  const authorization = await authorizationHeader(endpoint, env, now);
  if (!authorization) return { ok: false, status: 0, gone: false };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: authorization, TTL: "3600", "Content-Length": "0" }
  });
  // 404·410은 구독이 사라진 것이다. 다시 보내지 말고 지운다.
  return { ok: response.ok, status: response.status, gone: response.status === 404 || response.status === 410 };
}
