#!/usr/bin/env node
// NixOS ships no generic-Linux dynamic loader, so the prebuilt `workerd`
// binary that ships with the @astrojs/cloudflare adapter (via miniflare)
// cannot be exec'd. This script rewrites the ELF interpreter/RPATH to point
// at the Nix glibc store path resolved from the system `ldd`.
//
// It is a no-op on non-NixOS systems or if the binary is already patched.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const isNixOS = existsSync("/etc/NIXOS") || existsSync("/run/current-system");

if (!isNixOS) {
  process.exit(0);
}

const bin = path.resolve(
  "node_modules/@cloudflare/workerd-linux-64/bin/workerd",
);

if (!existsSync(bin)) {
  process.exit(0);
}

try {
  // Already runnable? Nothing to do.
  execFileSync(bin, ["--version"], { stdio: "ignore" });
  process.exit(0);
} catch {
  // fall through to patching
}

let libc;
try {
  const ldd = execFileSync("ldd", [bin], { encoding: "utf8" });
  const match = ldd.match(/libc\.so\.6 => (\S+)/);
  if (!match) throw new Error("libc not found in ldd output");
  // /nix/store/<hash>-glibc-.../lib/libc.so.6 -> /nix/store/<hash>-glibc-...
  libc = path.resolve(path.dirname(match[1]), "..");
} catch (err) {
  console.warn(`[patch-workerd] could not resolve glibc: ${err.message}`);
  process.exit(0);
}

const loader = path.join(libc, "lib", "ld-linux-x86-64.so.2");
const libDir = path.join(libc, "lib");

try {
  execFileSync("patchelf", [
    "--set-interpreter",
    loader,
    "--set-rpath",
    libDir,
    bin,
  ]);
  console.log(
    `[patch-workerd] patched workerd for NixOS (glibc ${libc})`,
  );
} catch (err) {
  console.warn(
    `[patch-workerd] patching failed (install patchelf?): ${err.message}`,
  );
}
