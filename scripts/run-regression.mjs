import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const listPath = join(root, "scripts", "regression-tests.txt");
const tests = readFileSync(listPath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

if (tests.length === 0) {
  console.error(`No regression tests listed in ${listPath}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", ...tests],
  { cwd: root, stdio: "inherit" },
);

process.exit(result.status ?? 1);
