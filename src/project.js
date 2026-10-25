// Detects the kind of app in a folder, builds it with the developer's own tools, and finds the APK it produced.
// Mirrors the detection Digidropp's automatic builds use (backend/utils/workflows.js).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const exists = (dir, name) => fs.existsSync(path.join(dir, name));
const gradlew = isWindows ? "gradlew.bat" : "./gradlew";

function readPackageJson(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

// Returns { type, label, steps: [{ cmd, args, cwd }], apkDir } or { type: null, reason }.
export function detectProject(dir) {
  if (exists(dir, "pubspec.yaml")) {
    return {
      type: "flutter",
      label: "Flutter",
      steps: [{ cmd: "flutter", args: ["build", "apk", "--release"], cwd: dir }],
      apkDir: path.join(dir, "build/app/outputs/flutter-apk"),
    };
  }

  const pkg = readPackageJson(dir);
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (deps["react-native"] || deps.expo) {
    const android = path.join(dir, "android");
    const gradleBuild = { cmd: gradlew, args: ["assembleRelease"], cwd: android };
    const apkDir = path.join(android, "app/build/outputs/apk/release");
    if (exists(dir, "android")) return { type: "react-native", label: "React Native", steps: [gradleBuild], apkDir };
    if (deps.expo) {
      return {
        type: "expo",
        label: "Expo",
        steps: [{ cmd: "npx", args: ["expo", "prebuild", "--platform", "android", "--no-install"], cwd: dir }, gradleBuild],
        apkDir,
      };
    }
    return { type: null, reason: "This React Native project has no android/ folder." };
  }

  const gradle = ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts"].some((f) => exists(dir, f));
  if (gradle) {
    if (!exists(dir, isWindows ? "gradlew.bat" : "gradlew")) {
      return { type: null, reason: "No Gradle wrapper (gradlew) found in this folder." };
    }
    return {
      type: "android",
      label: "Android (Gradle)",
      steps: [{ cmd: gradlew, args: ["assembleDebug"], cwd: dir }],
      apkDir: dir, // searched recursively for */build/outputs/apk/debug/*.apk
    };
  }

  return { type: null, reason: "No Android, Flutter, React Native or Expo project found in this folder." };
}

// Runs each build step with the developer's terminal attached, so they see the tool's own output.
export function runSteps(steps) {
  for (const { cmd, args, cwd } of steps) {
    if (cmd === gradlew && !isWindows) {
      try {
        fs.chmodSync(path.join(cwd, "gradlew"), 0o755);
      } catch {
        // Not fatal; spawning will report it.
      }
    }
    const result = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: isWindows });
    if (result.error?.code === "ENOENT") throw new Error(`"${cmd}" wasn't found. Install it, or build yourself and run: digidropp upload <file.apk>`);
    if (result.status !== 0) throw new Error(`Build failed: ${cmd} ${args.join(" ")} exited with code ${result.status}.`);
  }
}

// The newest .apk under dir (skipping node_modules and hidden folders), built after `since`.
export function findApk(dir, since = 0) {
  let best = null;
  const walk = (current, depth) => {
    if (depth > 8) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith(".apk")) {
        const { mtimeMs } = fs.statSync(full);
        if (mtimeMs >= since && (!best || mtimeMs > best.mtimeMs)) best = { file: full, mtimeMs };
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir, 0);
  return best?.file || null;
}

// Branch, commit and last commit message of the current checkout, so builds show where they came from and what
// changed. Empty outside git.
export function gitInfo(dir) {
  const run = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : undefined;
  };
  return {
    branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: run(["rev-parse", "HEAD"]),
    message: run(["log", "-1", "--pretty=%B"])?.slice(0, 2000),
  };
}
