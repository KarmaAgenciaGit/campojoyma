import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOTS = [
  path.resolve("docs/codex-sessions"),
  path.resolve("docs/codex-sessions-servidor"),
];

const REDACTED = "[CREDENCIAL RETIRADA]";

const rules = [
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: REDACTED,
  },
  {
    name: "api_key",
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{16,})\b/g,
    replace: REDACTED,
  },
  {
    name: "bearer",
    pattern: /(Bearer\s+)[A-Za-z0-9._~+/-]{20,}/gi,
    replace: `$1${REDACTED}`,
  },
  {
    name: "ssh_password",
    pattern: /((?:sshpass\s+-p|plink[^\r\n]*?\s-pw)\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
    replace: `$1${REDACTED}`,
  },
  {
    name: "url_password",
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+(@)/gi,
    replace: `$1${REDACTED}$2`,
  },
  {
    name: "secret_assignment",
    pattern:
      /(\b(?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|SERVICE_ROLE_KEY)[A-Z0-9_]*)\s*=\s*)(?!\s*(?:$|```))(?:"[^"]*"|'[^']*'|[^\s]+)/gim,
    replace: `$1${REDACTED}`,
  },
  {
    name: "quoted_password",
    pattern:
      /((?:contrase(?:n|ñ)a|password|passwd)[^\r\n"'`]{0,100}?(?:=|:|\ba\b)\s*)(["'`])((?!\[CREDENCIAL RETIRADA\])[^"'`\r\n]+)\2/gi,
    replace: (_match, prefix, quote) => `${prefix}${quote}${REDACTED}${quote}`,
  },
];

const listFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath)));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
};

const main = async () => {
  const shouldWrite = process.argv.includes("--redact");
  const totals = new Map(rules.map((rule) => [rule.name, 0]));
  let changedFiles = 0;

  for (const root of ROOTS) {
    for (const file of await listFiles(root)) {
      const original = await readFile(file, "utf8");
      let redacted = original;
      for (const rule of rules) {
        let count = 0;
        redacted = redacted.replace(rule.pattern, (...args) => {
          count += 1;
          return typeof rule.replace === "function" ? rule.replace(...args) : rule.replace;
        });
        totals.set(rule.name, (totals.get(rule.name) ?? 0) + count);
      }
      if (redacted !== original) {
        changedFiles += 1;
        if (shouldWrite) {
          await writeFile(file, redacted, "utf8");
        }
      }
    }
  }

  console.log(`${shouldWrite ? "Saneados" : "Detectados"}: ${changedFiles} archivos.`);
  for (const [name, count] of totals) {
    if (count > 0) console.log(`${name}: ${count}`);
  }
};

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
