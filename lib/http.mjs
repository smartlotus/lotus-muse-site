// 路由与响应封装（Workers / Node 通用，只用 Response/URL 这类标准全局）
// 约定：一切响应都是 JSON，形状恒为 { ok: boolean, ... }。

export const ERROR_STATUS = {
  bad_request: 400,
  invalid_input: 400,
  unsafe_path: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict_sequence: 409,
  too_large: 413,
  github_unauthenticated: 503,
  pages_unconfigured: 503,
  github_failed: 502,
  internal: 500,
};

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function err(code, message, extra = {}) {
  const status = ERROR_STATUS[code] ?? 500;
  return json({ ok: false, error: { code, message, ...extra } }, status);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(pattern) {
  // "/entries/:seq" -> ^/entries/([^/]+)$
  const names = [];
  const body = pattern
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        names.push(seg.slice(1));
        return "([^/]+)";
      }
      if (seg === "*") {
        names.push("wildcard");
        return "(.*)";
      }
      return escapeRe(seg);
    })
    .join("/");
  return { re: new RegExp(`^${body}$`), names };
}

export function buildRouter(routes) {
  const compiled = routes.map((r) => ({ ...r, ...compile(r.pattern) }));
  return {
    routes: compiled,
    match(method, pathname) {
      let pathMatched = false;
      for (const r of compiled) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        const params = {};
        r.names.forEach((n, i) => {
          params[n] = decodeURIComponent(m[i + 1]);
        });
        return { route: r, params };
      }
      return pathMatched ? { wrongMethod: true } : null;
    },
  };
}

export const SCOPES = [
  "read",
  "entry.write",
  "page.write",
  "site.republish",
  "site.restore",
];

export function bearer(request) {
  const h = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : "";
}

// 不做长度泄漏：两边都做摘要后按字节比，长度不等也走完整循环
export function tokenEquals(a, b) {
  const enc = new TextEncoder();
  const xs = enc.encode(String(a ?? ""));
  const ys = enc.encode(String(b ?? ""));
  let diff = xs.length ^ ys.length;
  const n = Math.max(xs.length, ys.length);
  for (let i = 0; i < n; i += 1) {
    diff |= (xs[i % xs.length || 0] ?? 0) ^ (ys[i % ys.length || 0] ?? 0);
  }
  return xs.length === ys.length && diff === 0;
}
