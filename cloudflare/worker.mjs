import rewriteRules from "./rewrites.generated.json" with { type: "json" };

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceToRegex(source) {
  const segments = source.slice(1).split("/");
  let expression = "^";

  for (const segment of segments) {
    if (segment === "") {
      expression += "/";
    } else if (segment.startsWith(":") && segment.endsWith("*")) {
      expression += "(?:/.*)?";
    } else if (segment.startsWith(":")) {
      expression += "/[^/]+";
    } else {
      expression += `/${escapeRegex(segment)}`;
    }
  }

  return new RegExp(`${expression}$`);
}

export function resolveRewrite(pathname) {
  if (pathname === "/") return "/index.html";

  for (const rule of rewriteRules) {
    if (sourceToRegex(rule.source).test(pathname)) return rule.destination;
  }
  return null;
}

async function fetchAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const contentType = response.headers.get("content-type") || "";
  if (!/^text\/html(?:\s*;|$)/i.test(contentType) || /\bcharset\s*=\s*utf-?8\b/i.test(contentType)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=UTF-8");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const destination = resolveRewrite(url.pathname);

    if (!destination) return fetchAsset(request, env);

    const rewrittenUrl = new URL(destination, url.origin);
    rewrittenUrl.search = url.search;
    return fetchAsset(new Request(rewrittenUrl, request), env);
  },
};
