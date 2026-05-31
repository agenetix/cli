import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(process.argv[2] ?? join(rootDir, ".tmp", "emcy-cli-package"));

const rootPackage = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
const legacyPackage = JSON.parse(await readFile(join(rootDir, "compat", "emcy-cli", "package.json"), "utf8"));
const version = process.env.LEGACY_EMCY_CLI_VERSION ?? legacyPackage.version;

const packageJson = {
  ...legacyPackage,
  version,
  type: rootPackage.type,
  bin: rootPackage.bin,
  files: rootPackage.files,
  engines: rootPackage.engines,
  dependencies: rootPackage.dependencies,
  optionalDependencies: rootPackage.optionalDependencies,
};

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(join(rootDir, "dist"), join(outputDir, "dist"), { recursive: true });
await cp(join(rootDir, "LICENSE"), join(outputDir, "LICENSE"));
await cp(join(rootDir, "compat", "emcy-cli", "README.md"), join(outputDir, "README.md"));
await writeFile(join(outputDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

console.log(`Prepared ${legacyPackage.name}@${version} in ${outputDir}`);
