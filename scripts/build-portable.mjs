#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const PRODUCT_NAME = "TauriTavern";
const BINARY_CANDIDATES = ["tauritavern", "TauriTavern"];

function printHelp() {
    console.log(`Usage: node scripts/build-portable.mjs [options] [-- <extra tauri args>]

Options:
  --target <triple>       Rust target triple, e.g. x86_64-pc-windows-msvc
  --output-dir <path>     Portable output directory (default: release)
  --skip-web-build        Skip frontend bundle build
  --help                  Show this help message
`);
}

function quoteShellArgument(value) {
    if (value.length === 0) {
        return "\"\"";
    }
    if (!/[\s"]/u.test(value)) {
        return value;
    }
    return `"${value.replace(/"/gu, '\\"')}"`;
}

function run(command, args, cwd, env = process.env) {
    const commandLine = [command, ...args.map(quoteShellArgument)].join(" ");
    const result = spawnSync(commandLine, { cwd, env, stdio: "inherit", shell: true });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function parseArgs(argv) {
    const options = {
        target: null,
        outputDir: "release",
        skipWebBuild: false,
        extraTauriArgs: [],
    };

    let passThrough = false;
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];

        if (passThrough) {
            options.extraTauriArgs.push(value);
            continue;
        }

        if (value === "--") {
            passThrough = true;
            continue;
        }

        if (value === "--help" || value === "-h") {
            printHelp();
            process.exit(0);
        }

        if (value === "--skip-web-build") {
            options.skipWebBuild = true;
            continue;
        }

        if (value === "--target") {
            const target = argv[index + 1];
            if (!target) {
                throw new Error("Missing value for --target");
            }
            options.target = target;
            index += 1;
            continue;
        }

        if (value === "--output-dir") {
            const outputDir = argv[index + 1];
            if (!outputDir) {
                throw new Error("Missing value for --output-dir");
            }
            options.outputDir = outputDir;
            index += 1;
            continue;
        }

        options.extraTauriArgs.push(value);
    }

    return options;
}

function resolveReleaseDirectory(repoRoot, target) {
    const releaseRoot = target
        ? path.join(repoRoot, "src-tauri", "target", target, "release")
        : path.join(repoRoot, "src-tauri", "target", "release");
    return releaseRoot;
}

function resolvePortableBinary(releaseDirectory) {
    for (const candidate of BINARY_CANDIDATES) {
        const binaryPath = path.join(releaseDirectory, `${candidate}.exe`);
        if (existsSync(binaryPath) && statSync(binaryPath).isFile()) {
            return binaryPath;
        }
    }

    const fallback = readdirSync(releaseDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .find((name) => name.toLowerCase().endsWith(".exe"));

    if (fallback) {
        return path.join(releaseDirectory, fallback);
    }

    throw new Error(`Unable to locate built portable binary in ${releaseDirectory}`);
}

function windowsOnlyArch(arch) {
    if (arch !== "x64") {
        throw new Error(`TauriTavern is Windows x64 only; got architecture ${arch}`);
    }
    return "x64";
}

function buildPlatformTag(target) {
    if (target) {
        return target.replace(/[^a-zA-Z0-9._-]/g, "_");
    }
    return `windows-${windowsOnlyArch(process.arch)}`;
}

function main() {
    if (process.platform !== "win32") {
        throw new Error("TauriTavern portable builds are Windows-only");
    }

    const repoRoot = process.cwd();
    const options = parseArgs(process.argv.slice(2));

    const tauriArgs = ["scripts/tauri-app.mjs", "build", "--no-bundle", "--features", "portable"];
    if (options.target) {
        tauriArgs.push("--target", options.target);
    }
    if (options.extraTauriArgs.length > 0) {
        tauriArgs.push(...options.extraTauriArgs);
    }
    const tauriEnv = options.skipWebBuild
        ? { ...process.env, TAURITAVERN_SKIP_WEB_BUILD: "1" }
        : process.env;
    run("node", tauriArgs, repoRoot, tauriEnv);

    const releaseDirectory = resolveReleaseDirectory(repoRoot, options.target);
    const binaryPath = resolvePortableBinary(releaseDirectory);
    const outputDirectory = path.resolve(repoRoot, options.outputDir);
    mkdirSync(outputDirectory, { recursive: true });

    const extension = ".exe";
    const artifactName = `${PRODUCT_NAME}-${buildPlatformTag(options.target)}-portable${extension}`;
    const artifactPath = path.join(outputDirectory, artifactName);
    copyFileSync(binaryPath, artifactPath);

    console.log(`Portable binary copied to ${artifactPath}`);
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
