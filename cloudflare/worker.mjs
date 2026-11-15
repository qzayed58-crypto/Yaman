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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const destination = resolveRewrite(url.pathname);

    if (!destination) return env.ASSETS.fetch(request);

    const rewrittenUrl = new URL(destination, url.origin);
    rewrittenUrl.search = url.search;
    return env.ASSETS.fetch(new Request(rewrittenUrl, request));
  },
};
