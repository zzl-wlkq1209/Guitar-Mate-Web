const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

export function requirePost(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Only POST requests are supported." });
  if (!supabaseUrl || !serviceRoleKey) return json(500, { error: "Share service is not configured." });
  return null;
}

export async function supabase(path, options = {}) {
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}
