import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const vercelPath = path.join(root, "vercel.json");
const vercel = JSON.parse(await readFile(vercelPath, "utf8"));

if (!Array.isArray(vercel.rewrites) || vercel.rewrites.length === 0) {
  throw new Error("vercel.json must define at least one rewrite rule.");
}

const rewrites = [];
const workerFirst = new Set();
workerFirst.add("/");

for (const [index, rule] of vercel.rewrites.entries()) {
  if (typeof rule.source !== "string" || !rule.source.startsWith("/")) {
    throw new Error(`Invalid Vercel rewrite source at index ${index}.`);
  }
  if (typeof rule.destination !== "string" || !rule.destination.startsWith("/")) {
    throw new Error(`Invalid Vercel rewrite destination at index ${index}.`);
  }

  const sourceSegments = rule.source.slice(1).split("/");
  const dynamicIndexes = [];
  for (const [segmentIndex, segment] of sourceSegments.entries()) {
    if (!segment.startsWith(":")) continue;
    if (!/^:[A-Za-z][A-Za-z0-9_]*\*?$/.test(segment)) {
      throw new Error(`Unsupported Vercel dynamic route source: ${rule.source}`);
    }
    dynamicIndexes.push(segmentIndex);
    if (segment.endsWith("*") && segmentIndex !== sourceSegments.length - 1) {
      throw new Error(`A Vercel catch-all route must be the final segment: ${rule.source}`);
    }
  }

  if (dynamicIndexes.length > 0) {
    const prefix = `/${sourceSegments.slice(0, dynamicIndexes[0]).join("/")}`;
    workerFirst.add(`${prefix}/*`);
  } else {
    workerFirst.add(rule.source);
  }

  const destinationPath = path.resolve(publicDir, `.${rule.destination}`);
  if (!destinationPath.startsWith(`${publicDir}${path.sep}`)) {
    throw new Error(`Rewrite destination escapes public/: ${rule.destination}`);
  }
  try {
    await access(destinationPath);
  } catch {
    throw new Error(`Vercel rewrite destination is missing: public${rule.destination}`);
  }

  rewrites.push({ source: rule.source, destination: rule.destination });
}

const allWorkerFirstPatterns = [...workerFirst];
const workerFirstPatterns = allWorkerFirstPatterns.filter((pattern) =>
  !allWorkerFirstPatterns.some(
    (other) => other !== pattern && other.endsWith("/*") && pattern.startsWith(other.slice(0, -1)),
  ),
);

const generatedRoutes = path.join(root, "cloudflare", "rewrites.generated.json");
await writeFile(generatedRoutes, `${JSON.stringify(rewrites, null, 2)}\n`);

const wranglerConfig = {
  name: "english-teacher",
  account_id: "896a59fb139126bb729036baaff0ae58",
  main: "cloudflare/worker.mjs",
  compatibility_date: "2026-10-25",
  compatibility_flags: [],
  workers_dev: true,
  assets: {
    directory: "./public",
    binding: "ASSETS",
    html_handling: "none",
    run_worker_first: workerFirstPatterns,
  },
};

const generatedWranglerConfig = path.join(root, "wrangler.generated.jsonc");
await writeFile(generatedWranglerConfig, `${JSON.stringify(wranglerConfig, null, 2)}\n`);

console.log(
  `Generated Cloudflare route table (${rewrites.length} Vercel rewrites) and Wrangler config (${workerFirstPatterns.length} Worker-first patterns).`,
);
