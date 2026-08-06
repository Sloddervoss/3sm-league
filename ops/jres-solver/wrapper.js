#!/usr/bin/env node
/**
 * JRES-solver microservice wrapper.
 * HTTP POST /solve  →  body: { input: <race-JSON>, options?: { timeLimit?, spotterMode?, allowNoSpotter?, optimalityGap? } }
 * Returns:  { status: "ok"|"infeasible"|"error", output?, diagnosis?, stats? }
 * The binary is spawned as a subprocess (JSON in via temp file → JSON out).
 * No code is copied from the MIT repo; this is a thin adapter around the CLI contract.
 */
const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BINARY = process.env.JRES_SOLVER_BIN || "/usr/local/bin/jres_solver";
const PORT = parseInt(process.env.PORT || "8080", 10);

function runSolve(input, options = {}) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jres-"));
    const inFile = path.join(tmpDir, "in.json");
    const outFile = path.join(tmpDir, "out.json");
    fs.writeFileSync(inFile, JSON.stringify(input));

    const args = ["--input", inFile, "--output", outFile];
    if (options.timeLimit != null) args.push("--time-limit", String(options.timeLimit));
    if (options.spotterMode) args.push("--spotter-mode", options.spotterMode);
    if (options.allowNoSpotter) args.push("--allow-no-spotter");
    if (options.optimalityGap != null) args.push("--optimality-gap", String(options.optimalityGap));

    const child = spawn(BINARY, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    let done = false;
    const finish = (code) => {
      if (done) return; done = true;
      let output = null;
      try { if (fs.existsSync(outFile)) output = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch (e) { /* no output */ }
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (code === 0) return resolve({ status: "ok", output });
      if (code === 1 && output) return resolve({ status: "infeasible", output });
      return reject(new Error(stderr || `solver exited ${code}`));
    };
    child.on("close", finish);
    child.on("error", (err) => { if (!done) { done = true; fs.rmSync(tmpDir, { recursive: true, force: true }); reject(err); } });
  });
}

http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/solve") {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "POST /solve expected" }));
  }
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 5_000_000) req.destroy(); });
  req.on("end", async () => {
    try {
      const parsed = JSON.parse(body);
      if (!parsed.input || typeof parsed.input !== "object") throw new Error("field 'input' (object) required");
      const result = await runSolve(parsed.input, parsed.options || {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error", error: String(err.message || err) }));
    }
  });
}).listen(PORT, () => {
  console.error(`JRES-solver service listening on :${PORT} (bin=${BINARY})`);
});
