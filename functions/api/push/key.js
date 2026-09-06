export function onRequestGet(context) {
  const key = context.env.VAPID_PUBLIC_KEY || null;
  return Response.json({ key }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
