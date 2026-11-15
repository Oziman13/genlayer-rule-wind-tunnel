// Compares the source that is stored on-chain for the Rule Wind Tunnel contract with the files in this repository.
// Read-only: it sends one JSON-RPC call (gen_getContractCode) and signs nothing.
//
//   node scripts/verify-deployed-source.mjs
//   node scripts/verify-deployed-source.mjs --rpc https://studio.genlayer.com/api --address 0x... --file deployed/rule_wind_tunnel.studionet-0xF319.py
//
// Exit code 0: the on-chain bytes equal the deployed/ file exactly.
// Exit code 1: they differ, or the call failed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const RPC = opt("rpc", "https://studio.genlayer.com/api");
const ADDRESS = opt("address", "0xF319FDf761A71Eb81D8FD8bcaBC9d03e155270E5");
const DEPLOYED_FILE = opt("file", "deployed/rule_wind_tunnel.studionet-0xF319.py");
const CURRENT_FILE = "contracts/rule_wind_tunnel.py";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Everything after the leading comment block (the runner line and the version line). The header layout was changed
// after the deployment (a blank line under the runner line), so the two files are compared by their code as well.
function body(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.startsWith("from genlayer import"));
  if (start < 0) throw new Error("no 'from genlayer import' line");
  return lines.slice(start).join("\n").replace(/\s+$/, "");
}

async function chainSource() {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_getContractCode", params: [ADDRESS] }),
  });
  const reply = await response.json();
  if (typeof reply.result !== "string") throw new Error("unexpected reply: " + JSON.stringify(reply).slice(0, 200));
  return Buffer.from(reply.result, "base64");
}

try {
  const onChain = process.env.RWT_CODE_FILE ? readFileSync(process.env.RWT_CODE_FILE) : await chainSource();
  const deployed = readFileSync(join(ROOT, DEPLOYED_FILE));
  const current = readFileSync(join(ROOT, CURRENT_FILE));
  console.log("contract          " + ADDRESS);
  console.log("on-chain          " + onChain.length + " bytes  sha256 " + sha(onChain));
  console.log(DEPLOYED_FILE.padEnd(17) + " " + deployed.length + " bytes  sha256 " + sha(deployed));
  console.log(CURRENT_FILE.padEnd(17) + " " + current.length + " bytes  sha256 " + sha(current));
  const exact = onChain.equals(deployed);
  const sameCode = body(onChain.toString("utf8")) === body(current.toString("utf8"));
  console.log("on-chain == " + DEPLOYED_FILE + " (byte for byte): " + (exact ? "YES" : "NO"));
  console.log("on-chain code == " + CURRENT_FILE + " (after the header comment lines): " + (sameCode ? "YES" : "NO"));
  process.exit(exact ? 0 : 1);
} catch (error) {
  console.error("verification failed: " + error.message);
  process.exit(1);
}
