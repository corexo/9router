import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const blueGreen = resolve(root, "scripts/deploy-qnap-bluegreen.sh");
const wrapper = resolve(root, "scripts/deploy-qnap.sh");
const legacy = resolve(root, "scripts/deploy-qnap-legacy.sh");

describe("QNAP blue/green deploy", () => {
  it("all deployment shell scripts parse", () => {
    for (const file of [blueGreen, wrapper, legacy, resolve(root, "scripts/update-nginx-upstream.sh")]) {
      expect(() => execFileSync("bash", ["-n", file])).not.toThrow();
    }
  });

  it("renders stable public and reverse-proxy-only listeners", () => {
    const config = execFileSync("bash", [blueGreen, "--render-config", "9321", "1", "127.0.0.1", "10.0.3.6"], { encoding: "utf8" });
    expect(config).toContain("listen 9311;");
    expect(config).toContain("listen 127.0.0.1:9312;");
    expect(config).toContain("allow 10.0.3.6;");
    expect(config.match(/proxy_pass http:\/\/127\.0\.0\.1:9321;/g)).toHaveLength(2);
    expect(config).toContain("proxy_buffering off;");
    expect(config).toContain("proxy_read_timeout 600s;");
  });

  it("can render a bridge-only canary before the one-time direct-port handoff", () => {
    const config = execFileSync("bash", [blueGreen, "--render-config", "9322", "0", "127.0.0.1", "10.0.3.6"], { encoding: "utf8" });
    expect(config).not.toContain("listen 9311;");
    expect(config).toContain("listen 127.0.0.1:9312;");
  });

  it("reads valid Blue/Green state locally without contacting QNAP", () => {
    const dir = mkdtempSync(join(tmpdir(), "pirouter-bg-state-"));
    const stateFile = join(dir, "state.env");
    writeFileSync(stateFile, "MODE=bluegreen\nACTIVE_SLOT=green\nACTIVE_IMAGE=9router-qnap-test:new\nPREVIOUS_SLOT=blue\nPREVIOUS_IMAGE=9router-qnap-test:old\n");
    try {
      const result = execFileSync("bash", [blueGreen, "--test-state", stateFile], { encoding: "utf8" });
      expect(result).toContain("active=green image=9router-qnap-test:new previous=blue");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("rewrites only the existing pirouter upstream target", () => {
    const dir = mkdtempSync(join(tmpdir(), "pirouter-nginx-upstream-"));
    const configFile = join(dir, "pirouter.conf");
    const backupFile = join(dir, "pirouter.conf.bak");
    writeFileSync(configFile, "upstream pirouter_backend {\n  server 10.0.3.7:20128;\n}\nserver { listen 443 ssl; }\n");
    try {
      execFileSync("sh", [resolve(root, "scripts/update-nginx-upstream.sh"), configFile, "10.0.3.1:9312", backupFile]);
      expect(readFileSync(configFile, "utf8")).toContain("server 10.0.3.1:9312;");
      expect(readFileSync(backupFile, "utf8")).toContain("server 10.0.3.7:20128;");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
