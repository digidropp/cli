#!/usr/bin/env node
// digidropp: build your app and get an install link + QR code from the terminal.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import QRCode from "qrcode";
import { clearConfig, configPath, DEFAULT_API_URL, loadConfig, saveConfig } from "./config.js";
import { detectProject, findApk, gitInfo, isMainBranch, runSteps } from "./project.js";

// Keep in step with package.json; the release workflow checks both against the tag.
const VERSION = "0.1.1";
const DASHBOARD_TOKENS_URL = "https://digidropp.online/dashboard/settings";

// ── Output ────────────────────────────────────────────────────────────

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const bold = paint("1");
const dim = paint("2");
const green = paint("32");
const yellow = paint("33");
const red = paint("31");
const cyan = paint("36");

const ok = (msg) => console.log(`${green("✓")} ${msg}`);
const step = (msg) => console.log(`${cyan("●")} ${msg}`);

class CliError extends Error {}

const HELP = `
${bold("digidropp")} ${dim(`v${VERSION}`)}: build your app and get an install link + QR code

${bold("Commands")}
  digidropp deploy              Build the app in this folder and upload it (same as just: digidropp)
  digidropp upload <file>       Upload an .apk or .ipa you already built
  digidropp apps                List your apps and their install links
  digidropp login               Save your upload token
  digidropp logout              Remove the saved token

${bold("Options")}
  -m, --notes <text>            Release notes shown to testers (default: your last commit message)
  -d, --dir <folder>            App folder (default: current folder)
      --main                    Update the main install link even from a feature branch
  -v, --version                 Show the version
  -h, --help                    Show this help

${bold("Examples")}
  digidropp deploy -m "Fixed checkout"
  digidropp deploy -d apps/mobile
  digidropp upload build/app/outputs/flutter-apk/app-release.apk -m "Hotfix"

${bold("Environment")}
  DIGIDROPP_TOKEN               Upload token (instead of logging in), for CI and AI agents
  DIGIDROPP_API_URL             API URL (default: ${DEFAULT_API_URL})

Docs: https://digidropp.online/docs#cli
`;

// ── Arguments ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-m" || arg === "--notes") opts.notes = argv[++i];
    else if (arg === "-d" || arg === "--dir") opts.dir = argv[++i];
    else if (arg === "--main") opts.main = true;
    else if (arg === "-v" || arg === "--version") opts.version = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg.startsWith("-")) throw new CliError(`Unknown option ${arg}. Run digidropp --help.`);
    else opts.positional.push(arg);
  }
  return opts;
}

// ── API ───────────────────────────────────────────────────────────────

async function api(config, pathname, options = {}) {
  let res;
  try {
    res = await fetch(`${config.apiUrl}${pathname}`, {
      ...options,
      headers: { Authorization: `Bearer ${config.token}`, ...(options.headers || {}) },
    });
  } catch {
    throw new CliError(`Couldn't reach Digidropp at ${config.apiUrl}. Check your internet connection.`);
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new CliError("Your token isn't valid any more. Run: digidropp login");
  if (!res.ok) throw new CliError(body.error || `Digidropp returned an error (${res.status}).`);
  return body;
}

function requireToken(config) {
  if (!config.token) throw new CliError(`You're not logged in. Run: digidropp login  ${dim("(or set DIGIDROPP_TOKEN)")}`);
  return config;
}

// ── Commands ──────────────────────────────────────────────────────────

async function login() {
  console.log(`Create an upload token in Digidropp under ${bold("CI & tokens")}:\n  ${cyan(DASHBOARD_TOKENS_URL)}\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const token = (await rl.question("Paste your token (dd_…): ")).trim();
  rl.close();
  if (!token.startsWith("dd_")) throw new CliError("That doesn't look like a Digidropp token. Tokens start with dd_.");

  const config = { ...loadConfig(), token };
  await api(config, "/projects"); // fails with a clear message if the token is wrong
  saveConfig({ token });
  ok(`Logged in. Token saved to ${dim(configPath())}`);
}

function logout() {
  clearConfig();
  ok("Logged out.");
}

async function apps() {
  const config = requireToken(loadConfig());
  const { projects } = await api(config, "/projects");
  if (!projects.length) return console.log("No apps yet. Run digidropp in your app's folder to upload the first build.");
  for (const p of projects) {
    const latest = p.latest ? `v${p.latest.versionName || "?"} (${p.latest.buildVersion})` : "no builds";
    console.log(`${bold(p.name)} ${dim(`${p.platform === "ios" ? "iOS" : "Android"} · ${latest}`)}\n  ${cyan(p.installUrl)}`);
  }
}

async function upload(file, opts, git = {}) {
  const config = requireToken(loadConfig());
  if (!file) throw new CliError("Which file? Usage: digidropp upload <file.apk|file.ipa>");
  const full = path.resolve(file);
  if (!fs.existsSync(full)) throw new CliError(`File not found: ${file}`);
  if (!/\.(apk|ipa)$/i.test(full)) throw new CliError("Only .apk and .ipa files can be uploaded.");

  const size = fs.statSync(full).size;
  step(`Uploading ${path.basename(full)} ${dim(`(${(size / 1024 / 1024).toFixed(1)} MB)`)}…`);

  const blob = fs.openAsBlob ? await fs.openAsBlob(full) : new Blob([fs.readFileSync(full)]);
  const form = new FormData();
  form.append("file", blob, path.basename(full));
  // Without -m, testers see the last commit message, so they know what changed without asking.
  const notes = opts.notes ?? git.message;
  if (notes) form.append("releaseNotes", notes);
  // From a feature branch, the build goes to that branch's link and leaves the main install link alone.
  const branchBuild = !opts.main && !isMainBranch(git);
  if (branchBuild) form.append("branchBuild", "true");
  if (git.branch && git.branch !== "HEAD") form.append("branch", git.branch);
  if (git.commit) form.append("commit", git.commit);

  const { project, build, links } = await api(config, "/builds", { method: "POST", body: form });
  ok(`Uploaded ${bold(project.name)} ${build.versionName || ""} (${build.buildVersion}) as build #${build.buildNumber}`);
  printWarnings(build.warnings);
  if (branchBuild && links.branch) {
    console.log(dim(`  Built from branch ${git.branch}, so your main install link is unchanged (use --main to update it).`));
    await printLink(links.branch, `Install (newest build from ${git.branch}):`);
  } else {
    await printLink(links.install);
  }
}

async function buildAndUpload(opts) {
  requireToken(loadConfig()); // fail before a long build, not after it
  const dir = path.resolve(opts.dir || ".");
  const project = detectProject(dir);
  if (!project.type) {
    throw new CliError(`${project.reason}\nRun it in your app's folder, or upload a file you built: digidropp upload <file.apk>`);
  }

  ok(`Detected ${project.label} app`);
  step("Building… (this uses your own build tools)\n");
  const started = Date.now();
  runSteps(project.steps);

  const apk = findApk(project.apkDir, started - 1000);
  if (!apk) throw new CliError(`The build finished, but no new .apk was found in ${path.relative(dir, project.apkDir) || "."}.`);
  console.log();
  ok(`Built ${path.relative(dir, apk)}`);
  await upload(apk, opts, gitInfo(dir));
}

function printWarnings(warnings = []) {
  const order = { blocking: 0, warning: 1, info: 2 };
  for (const w of [...warnings].sort((a, b) => order[a.level] - order[b.level])) {
    const icon = w.level === "blocking" ? red("✗") : w.level === "warning" ? yellow("⚠") : dim("ℹ");
    console.log(`  ${icon} ${w.level === "info" ? dim(w.message) : w.message}`);
  }
}

async function printLink(url, label = "Install:") {
  console.log(`\n  ${bold(label)} ${cyan(url)}\n`);
  if (process.stdout.isTTY) {
    const qr = await QRCode.toString(url, { type: "terminal", small: true });
    console.log(qr.replace(/^/gm, "  "));
    console.log(dim("  Scan with your phone to install.\n"));
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.version) return console.log(VERSION);
  if (opts.help) return console.log(HELP);

  const [command, ...rest] = opts.positional;
  switch (command) {
    case undefined:
    case "deploy":
      return buildAndUpload(opts);
    case "upload":
      return upload(rest[0], opts, gitInfo(process.cwd()));
    case "apps":
      return apps();
    case "login":
      return login();
    case "logout":
      return logout();
    case "help":
      return console.log(HELP);
    default:
      throw new CliError(`Unknown command "${command}". Run digidropp --help.`);
  }
}

main().catch((err) => {
  console.error(`${red("✗")} ${err instanceof CliError ? err.message : err.stack || err}`);
  process.exit(1);
});
