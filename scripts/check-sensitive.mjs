import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).split("\0").filter(Boolean);
const violations = [];
for (const file of files) {
  if (/(^|\/)(\.env(?:\..+)?|[^/]+\.har)$/i.test(file)) violations.push(`${file}: forbidden tracked file`);
  if (/package-lock\.json$/.test(file)) continue;
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  if (/IServ(?:SAT|SATId|Session)\s*[=:]\s*[^\s"']+/i.test(text)) violations.push(`${file}: possible session material`);
  if (/(?:ISERV_URL\s*=|--url\s+)(?:https?:\/\/)?(?!iserv\.example|example\.invalid)[a-z0-9.-]+/i.test(text)) violations.push(`${file}: non-example instance hostname`);
}
if (violations.length) { console.error(violations.join("\n")); process.exit(1); }
console.log(`Sensitive-data check passed for ${files.length} tracked files.`);
