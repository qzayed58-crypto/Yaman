import assert from "node:assert/strict";
import { test } from "node:test";
import rewrites from "../rewrites.generated.json" with { type: "json" };
import worker, { resolveRewrite } from "../worker.mjs";

function sampleSource(source) {
  return source
    .replace(/:([A-Za-z][A-Za-z0-9_]*)\*/g, "sample/nested")
    .replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "sample");
}

test("Cloudflare rewrite table is generated from every Vercel rewrite", () => {
  assert.equal(rewrites.length, 50);
  for (const rule of rewrites) {
    assert.equal(resolveRewrite(sampleSource(rule.source)), rule.destination, rule.source);
  }
});

test("key Vercel routes resolve to the same static files", () => {
  const cases = [
    ["/stories.html", "/stories/index.html"],
    ["/stories", "/stories/index.html"],
    ["/stories/", "/stories/index.html"],
    ["/courses", "/courses/index.html"],
    ["/courses/", "/courses/index.html"],
    ["/B1_level3", "/B1_level3/index.html"],
    ["/grammar-level6", "/grammar-level6/index.html"],
    ["/read", "/read/index.html"],
    ["/read/", "/read/index.html"],
    ["/arabic-academy", "/arabic-academy/index.html"],
    ["/arabic-academy/curriculum/b1/chapter-1/2", "/arabic-academy/index.html"],
    ["/arabic-academy/guide/sentence-parsing/b1/group-2", "/arabic-academy/index.html"],
    ["/arabic-academy/rhetoric/applications/branch/quran-rhetoric/lesson/3", "/arabic-academy/index.html"],
  ];

  for (const [pathname, destination] of cases) {
    assert.equal(resolveRewrite(pathname), destination, pathname);
  }
});

test("unmatched paths are not rewritten", () => {
  assert.equal(resolveRewrite("/read/not-a-vercel-route"), null);
});

test("the root path serves the same index file as Vercel's default static hosting", () => {
  assert.equal(resolveRewrite("/"), "/index.html");
});

test("conversation data satisfies the runtime integrity checks", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
  const match = html.match(/<script type="application\/json" id="cue-conversations-data-v1">([\s\S]*?)<\/script>/);
  assert.ok(match, "conversation data block exists");
  const conversations = JSON.parse(match[1]);
  const expectedMessages = { A1: 16, A2: 20, B1: 24, B2: 30, C1: 36, C2: 40 };
  assert.equal(conversations.length, Object.keys(expectedMessages).length * 25);

  for (const [level, count] of Object.entries(expectedMessages)) {
    const items = conversations.filter((item) => item.level === level);
    assert.equal(items.length, 25, `${level} conversation count`);
    for (const item of items) {
      const id = `${level}-${String(item.number).padStart(2, "0")}`;
      assert.equal(item.messages?.length, count, `${id} message count`);
      assert.equal(item.speakers?.length, 2, `${id} speaker list`);
      for (const [index, message] of item.messages.entries()) {
        assert.equal(message.speaker, item.speakers[index % 2], `${id} message ${index + 1} speaker`);
        assert.ok(message.english?.trim(), `${id} message ${index + 1} English text`);
        assert.ok(message.arabic?.trim(), `${id} message ${index + 1} Arabic text`);
      }
    }
  }
});

test("rewrites preserve the original query string", async () => {
  let forwardedRequest;
  const request = new Request("https://example.test/read?level=1&from=home");
  const response = await worker.fetch(request, {
    ASSETS: {
      fetch: async (rewrittenRequest) => {
        forwardedRequest = rewrittenRequest;
        return new Response("ok");
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(forwardedRequest.url, "https://example.test/read/index.html?level=1&from=home");
});

test("unmatched asset requests are passed to Cloudflare static assets unchanged", async () => {
  const request = new Request("https://example.test/robots.txt");
  let forwardedRequest;
  await worker.fetch(request, {
    ASSETS: {
      fetch: async (assetRequest) => {
        forwardedRequest = assetRequest;
        return new Response("ok");
      },
    },
  });

  assert.equal(forwardedRequest, request);
});
