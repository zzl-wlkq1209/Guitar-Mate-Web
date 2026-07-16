import { json, requirePost, supabase } from "./_supabase.mjs";

export default async (request) => {
  const rejected = requirePost(request);
  if (rejected) return rejected;

  try {
    const { token } = await request.json();
    if (typeof token !== "string" || !/^[a-f0-9]{32}$/i.test(token)) {
      return json(400, { error: "分享口令格式不正确。" });
    }
    const response = await supabase(`share_tokens?token=eq.${token}&select=payload,expires_at`, { method: "GET" });
    const rows = await response.json();
    const record = Array.isArray(rows) ? rows[0] : null;
    if (!response.ok || !record || new Date(record.expires_at).getTime() <= Date.now()) {
      await supabase(`share_tokens?token=eq.${token}`, { method: "DELETE" });
      return json(404, { error: "分享口令不存在或已过期。" });
    }
    await supabase(`share_tokens?token=eq.${token}`, { method: "DELETE" });
    return json(200, { payload: record.payload });
  } catch {
    return json(400, { error: "无法读取分享口令。" });
  }
};
