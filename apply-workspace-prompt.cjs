const { readFileSync } = require("node:fs");
const { isDeepStrictEqual } = require("node:util");
const { ANYTHINGLLM_URL, ANYTHINGLLM_API_KEY, ANYTHINGLLM_WORKSPACE_SLUG } = process.env;

async function main() {
  const prompt = readFileSync("ANYTHINGLLM_SETUP.md", "utf8").replace(/\r\n/g, "\n")
    .match(/```text\n([\s\S]*?)\n```/)?.[1];
  if (!prompt || !ANYTHINGLLM_URL || !ANYTHINGLLM_API_KEY || !ANYTHINGLLM_WORKSPACE_SLUG) {
    throw new Error("Missing workspace connection or prompt");
  }
  const url = ANYTHINGLLM_URL.replace(/\/+$/, "") + "/api/v1/workspace/" + encodeURIComponent(ANYTHINGLLM_WORKSPACE_SLUG);
  const headers = { Authorization: "Bearer " + ANYTHINGLLM_API_KEY, "Content-Type": "application/json" };
  async function request(endpoint, options) {
    const response = await fetch(url + endpoint, { headers, signal: AbortSignal.timeout(15000), ...options });
    if (!response.ok) throw new Error("Workspace API returned HTTP " + response.status);
    return response.json();
  }
  async function readWorkspace() {
    const { workspace } = await request("");
    const item = Array.isArray(workspace) ? workspace.find(entry => entry.slug === ANYTHINGLLM_WORKSPACE_SLUG) : workspace;
    if (item?.slug !== ANYTHINGLLM_WORKSPACE_SLUG) throw new Error("Configured workspace not found");
    return item;
  }
  const before = await readWorkspace();
  if (before.openAiPrompt !== prompt) {
    const result = await request("/update", { method: "POST", body: JSON.stringify({ openAiPrompt: prompt }) });
    if (result.error) throw new Error("Workspace API rejected the update");
  }
  const after = await readWorkspace();
  if (after.openAiPrompt !== prompt) throw new Error("Workspace prompt readback did not match");
  const settings = ({ openAiPrompt, lastUpdatedAt, updatedAt, ...rest }) => rest;
  if (!isDeepStrictEqual(settings(before), settings(after))) throw new Error("An unrelated workspace field differed on readback");
  console.log("Workspace prompt verified verbatim; other workspace fields verified unchanged; linked documents: " +
    (Array.isArray(after.documents) ? after.documents.length : "not reported"));
}

main().catch(error => {
  console.error("Workspace prompt verification failed: " + error.message);
  process.exitCode = 1;
});
