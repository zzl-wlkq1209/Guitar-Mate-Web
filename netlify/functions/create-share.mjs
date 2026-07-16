import { json, requirePost, supabase } from "./_supabase.mjs";

export default async (request) => {
  const rejected = requirePost(request);
  if (rejected) return rejected;

  try {
    const { payload } = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json(400, { error: "分享内容无效。" });
    }
    if (JSON.stringify(payload).length > 200_000) {
      return json(413, { error: "分享内容过大。" });
    }

    const token = crypto.randomUUID().replaceAll("-", "");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await supabase(`share_tokens?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, { method: "DELETE" });
    const response = await supabase("share_tokens", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ token, payload, expires_at: expiresAt }),
    });
    if (!response.ok) return json(502, { error: "暂时无法创建分享口令。" });
    return json(200, { token, expiresAt });
  } catch {
    return json(400, { error: "请求格式无效。" });
  }
};
