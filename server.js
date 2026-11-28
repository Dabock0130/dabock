const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const ROOT = __dirname;
loadEnv(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 8765);
const HOST = process.env.RAILWAY_ENVIRONMENT_ID ? "0.0.0.0" : "127.0.0.1";
const PREVIEW = HOST === "127.0.0.1" && process.argv.includes("--preview");
const PREVIEW_STARTED = Date.now();
const BASE_URL = (process.env.ANYTHINGLLM_URL || "").replace(/\/+$/, "");
const API_KEY = process.env.ANYTHINGLLM_API_KEY || "";
const WORKSPACE_SLUG = process.env.ANYTHINGLLM_WORKSPACE_SLUG || "";

const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_CHARS = 18 * 1024 * 1024;
const CHAT_TIMEOUT_MS = 180_000;
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/style.css", ["style.css", "text/css"]],
  ["/script.js", ["script.js", "text/javascript"]],
  ["/quiz.js", ["quiz.js", "text/javascript"]],
  ["/assets/tteokgujeon-banner.png", ["assets/tteokgujeon-banner.png", "image/png"]],
  ["/assets/tteokgujeon-ready.jpg", ["assets/tteokgujeon-ready.jpg", "image/jpeg"]],
  ["/assets/tteokgujeon-thinking.jpg", ["assets/tteokgujeon-thinking.jpg", "image/jpeg"]],
  ["/assets/tteokgujeon-praise.jpg", ["assets/tteokgujeon-praise.jpg", "image/jpeg"]],
]);

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

const DOCUMENT_EXTS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
]);

const server = http.createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");

  if (PREVIEW && request.method === "GET" && request.url === "/__preview/version") {
    const assets = ["index.html", "style.css", "script.js", "quiz.js"];
    try {
      const stats = await Promise.all(assets.map((file) => fs.promises.stat(path.join(ROOT, file))));
      return sendJson(response, 200, { version: [PREVIEW_STARTED, ...stats.map((file) => file.mtimeMs)].join(":") });
    } catch {
      return sendJson(response, 503, { error: "Preview files are being updated." });
    }
  }

  const publicFile = PUBLIC_FILES.get(request.url.split("?", 1)[0]);
  if (request.method === "GET" && publicFile) {
    return serveAsset(response, ...publicFile);
  }

  if (request.method === "GET" && request.url === "/favicon.ico") {
    response.writeHead(204);
    return response.end();
  }

  if (request.method === "GET" && request.url === "/api/health") {
    return checkAnythingLlm(response);
  }

  if (request.method === "GET" && request.url === "/healthz") {
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "POST" && request.url === "/api/chat") {
    return chat(request, response);
  }

  if (request.method === "GET" && request.url.startsWith("/api/files/")) {
    return proxyGeneratedFile(request, response);
  }

  sendJson(response, 404, { error: "요청한 경로를 찾을 수 없습니다." });
});

async function checkAnythingLlm(response) {
  const missing = missingSettings();
  if (missing.length) {
    return sendJson(response, 503, {
      connected: false,
      error: `서버 환경 변수 설정이 필요합니다: ${missing.join(", ")}`,
    });
  }

  try {
    const upstream = await fetchWithTimeout(
      `${BASE_URL}/api/v1/workspace/${encodeURIComponent(WORKSPACE_SLUG)}`,
      { headers: { Authorization: `Bearer ${API_KEY}` } },
      15_000,
    );

    if (!upstream.ok) {
      return sendJson(response, 503, {
        connected: false,
        error: upstream.status === 401 || upstream.status === 403
          ? authError(upstream.status)
          : `AnythingLLM 워크스페이스 확인에 실패했습니다. (HTTP ${upstream.status})`,
      });
    }

    const data = await upstream.json();
    if (!Array.isArray(data.workspace) ||
        !data.workspace.some((workspace) => workspace.slug === WORKSPACE_SLUG)) {
      return sendJson(response, 503, {
        connected: false,
        error: "워크스페이스 slug를 확인해 주세요.",
      });
    }

    sendJson(response, 200, { connected: true });
  } catch {
    sendJson(response, 503, {
      connected: false,
      error: "AnythingLLM 서버에 연결할 수 없습니다.",
    });
  }
}

async function chat(request, response) {
  const missing = missingSettings();
  if (missing.length) {
    return sendJson(response, 503, {
      error: `서버 환경 변수 설정이 필요합니다: ${missing.join(", ")}`,
    });
  }

  try {
    const body = await readJson(request);
    if (body.activity === "quiz") return await generateQuiz(response, body.topicIndex);
    const attachments = normalizeAttachments(body.attachments);
    const photoCount = attachments.filter(({ mime }) => mime.startsWith("image/")).length;
    if (body.lesson?.learningMode === "field" && !photoCount) {
      return sendJson(response, 400, { error: "현장 모드에서는 관찰할 식물 사진을 먼저 1장 이상 올려야 다음으로 넘어갈 수 있어요!" });
    }
    let message = typeof body.message === "string" ? body.message.trim() : "";
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim()
        ? body.sessionId.trim().slice(0, 128)
        : "plant-observation";

    if (!message && attachments.length) {
      message = defaultMessageFor(attachments);
    }

    if (!message) {
      return sendJson(response, 400, { error: "질문을 입력해 주세요." });
    }

    const lessonMessage = prepareLessonMessage(body.lesson, message, attachments, photoCount);
    const payload = {
      message: lessonMessage || prepareChatMessage(message),
      mode: lessonMessage ? "chat" : "automatic",
      sessionId,
    };
    if (attachments.length) {
      payload.attachments = attachments;
    }

    const upstream = await requestWorkspaceChat(payload, CHAT_TIMEOUT_MS);

    const raw = await upstream.text();
    let data = {};
    try {
      data = JSON.parse(raw);
    } catch {
      // AnythingLLM이 JSON 이외의 응답을 반환한 경우 아래에서 처리합니다.
    }

    if (!upstream.ok) {
      const error =
        upstream.status === 401 || upstream.status === 403
          ? authError(upstream.status)
          : upstream.status === 404
            ? "워크스페이스 slug를 확인해 주세요."
            : `AnythingLLM 요청에 실패했습니다. (HTTP ${upstream.status})`;
      return sendJson(response, 502, { error });
    }

    const files = collectReplyFiles(data);
    let textResponse =
      typeof data.textResponse === "string" ? data.textResponse.trim() : "";
    if (lessonMessage && textResponse) {
      textResponse = constrainLessonReply(textResponse, body.lesson);
    }

    if (!files.length && wantsGeneratedFile(message)) {
      const generated = makeDownloadableFile(message, textResponse);
      if (generated) {
        files.push(generated);
        textResponse = "요청하신 파일을 만들어 첨부했습니다. 아래에서 다운로드할 수 있습니다.";
      }
    }

    if (!textResponse && files.length) {
      textResponse = "파일을 첨부했습니다.";
    }

    if (!textResponse) {
      return sendJson(response, 502, {
        error: "AnythingLLM 응답에서 답변을 찾지 못했습니다.",
      });
    }

    sendJson(response, 200, { textResponse, files });
  } catch (error) {
    if (error.name === "AbortError") {
      return sendJson(response, 504, {
        error: "AnythingLLM 응답 시간이 초과되었습니다.",
      });
    }
    if (error.name === "PayloadTooLargeError") {
      return sendJson(response, 413, {
        error: "첨부 파일이 너무 큽니다. 파일 개수나 크기를 줄여 주세요.",
      });
    }
    if (error instanceof SyntaxError) {
      return sendJson(response, 400, { error: "잘못된 요청 형식입니다." });
    }
    console.error("채팅 연결 오류:", error.message);
    sendJson(response, 502, {
      error: "AnythingLLM 서버에 연결할 수 없습니다.",
    });
  }
}

function requestWorkspaceChat(payload, timeoutMs) {
  const endpoint = `${BASE_URL}/api/v1/workspace/${encodeURIComponent(WORKSPACE_SLUG)}/chat`;
  return fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, timeoutMs);
}

async function generateQuiz(response, topicIndex) {
  const topics = ["떡잎 수", "잎맥", "꽃잎 수", "뿌리 형태", "줄기 관다발과 형성층", "대나무 예외", "질경이 예외", "단서가 부족할 때의 판단 보류"];
  const topic = Number.isInteger(topicIndex) && topics[topicIndex] || topics[0];
  const upstream = await requestWorkspaceChat({
    mode: "chat",
    sessionId: "quiz-" + randomUUID(),
    message: [
      "추가학습 객관식 문제를 만드는 교사용 출제 요청이다. 학생과 하는 관찰 문답이나 가설 검토가 아니다. 워크스페이스의 탐구 흐름에서 모든 관찰과 가설 검토가 끝난 뒤 사용하는 실전 적용 퀴즈 한 문제를 작성한다.",
      `중학교 생명과학 · 이번 주제는 ${topic}이다. 새로운 관찰 상황을 만들어 서로 다른 선지 4개와 오직 하나의 명확한 정답을 준다. 잎맥·꽃잎 수 등 대표 특징에는 예외가 있을 수 있다. 친근한 한국어 해설을 1~2문장으로 쓴다.`,
      '출제 화면이 읽을 JSON 객체 하나만 출력한다. 앞뒤 인사, 마크다운, 일반 대화는 생략한다. 형식은 {"question":"문제 문장","choices":["첫째 선지","둘째 선지","셋째 선지","넷째 선지"],"answerIndex":0,"explanation":"해설"}이다. answerIndex는 0부터 센 실제 정답 위치이며, 문제 문장에 정답을 공개하지 않는다.',
    ].join("\n"),
  }, 12000);
  if (!upstream.ok) return sendJson(response, 502, { error: "AI 문제를 받지 못했어요." });
  const data = await upstream.json();
  const quiz = parseQuiz(data.textResponse);
  if (!quiz) return sendJson(response, 502, { error: "AI 문제 형식을 확인하지 못했어요." });
  return sendJson(response, 200, { quiz });
}

function parseQuiz(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const { question, choices, answerIndex, explanation } = JSON.parse(text.slice(start, end + 1));
    const validText = (value, limit) => typeof value === "string" && value.trim() && value.trim().length <= limit;
    if (!validText(question, 300) || !validText(explanation, 500) ||
        !Array.isArray(choices) || ![4, 5].includes(choices.length) ||
        !choices.every((choice) => validText(choice, 180)) ||
        !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= choices.length) return null;
    const trimmed = choices.map((choice) => choice.trim());
    return new Set(trimmed).size === trimmed.length
      ? { question: question.trim(), choices: trimmed, answerIndex, explanation: explanation.trim() }
      : null;
  } catch {
    return null;
  }
}

function normalizeAttachments(raw) {
  if (!Array.isArray(raw)) return [];

  const attachments = [];
  for (const item of raw) {
    if (attachments.length >= MAX_ATTACHMENTS) break;
    if (!item || typeof item !== "object") continue;

    const name = safeFileName(item.name);
    const contentString =
      typeof item.contentString === "string" ? item.contentString : "";
    if (!name || !isBase64DataUrl(contentString)) continue;
    if (contentString.length > MAX_ATTACHMENT_CHARS) continue;

    const ext = path.extname(name).toLowerCase();
    const mime = String(item.mime || "").toLowerCase().trim();

    if (IMAGE_MIMES.has(mime) || mime.startsWith("image/")) {
      attachments.push({
        name,
        mime: mime === "image/jpg" ? "image/jpeg" : mime,
        contentString,
      });
      continue;
    }

    if (DOCUMENT_EXTS.has(ext)) {
      attachments.push({
        name,
        mime: "application/anythingllm-document",
        contentString,
      });
    }
  }
  return attachments;
}

function collectReplyFiles(data) {
  const files = [];
  const seen = new Set();
  const outputs = [];
  if (Array.isArray(data.outputs)) outputs.push(...data.outputs);
  if (data.output) outputs.push(data.output);

  for (const item of outputs) {
    const file = fileFromOutput(item);
    if (!file || seen.has(file.url)) continue;
    seen.add(file.url);
    files.push(file);
  }

  const text = typeof data.textResponse === "string" ? data.textResponse : "";
  for (const file of filesFromText(text)) {
    if (seen.has(file.url)) continue;
    seen.add(file.url);
    files.push(file);
  }
  return files.slice(0, MAX_ATTACHMENTS);
}

function fileFromOutput(item) {
  if (!item) return null;
  if (typeof item === "string") {
    return fileFromStorage(item, item);
  }

  const payload =
    item.payload && typeof item.payload === "object"
      ? { ...item, ...item.payload }
      : item;

  const storageName = safeStorageName(
    payload.storageFilename || storageNameFromUrl(payload.url),
  );
  if (storageName) {
    const displayName = safeFileName(
      payload.filename || payload.name || storageName,
    );
    const kind =
      item.type === "imageGenerationCard" || isImageName(displayName) || isImageName(storageName)
        ? "image"
        : "document";
    return {
      name: displayName,
      kind,
      mime: mimeFromName(displayName || storageName),
      size: Number(payload.fileSize) || 0,
      url: `/api/files/${encodeURIComponent(storageName)}?name=${encodeURIComponent(displayName)}`,
    };
  }

  const dataUrl = [payload.contentString, payload.image].find(
    (value) => typeof value === "string" && isBase64DataUrl(value),
  );
  if (!dataUrl) return null;
  const name = safeFileName(payload.filename || payload.name || "attachment");
  return {
    name,
    kind: isImageName(name) || String(payload.mime || "").startsWith("image/") || dataUrl.startsWith("data:image/")
      ? "image"
      : "document",
    mime: payload.mime || mimeFromDataUrl(dataUrl) || mimeFromName(name),
    size: Number(payload.fileSize) || 0,
    url: dataUrl,
  };
}

function filesFromText(text) {
  const files = [];
  const imageMarkdown = /!\[[^\]]*\]\((data:image\/[a-z0-9.+-]+;base64,[^)]+)\)/gi;
  let match;
  let index = 1;
  while ((match = imageMarkdown.exec(text))) {
    files.push({
      name: `image-${index}.png`,
      kind: "image",
      mime: mimeFromDataUrl(match[1]),
      size: 0,
      url: match[1],
    });
    index += 1;
  }

  const generated = /generated-files\/([A-Za-z0-9._-]+)/gi;
  while ((match = generated.exec(text))) {
    const storageName = safeStorageName(match[1]);
    if (!storageName) continue;
    const name = safeFileName(storageName);
    files.push({
      name,
      kind: isImageName(name) ? "image" : "document",
      mime: mimeFromName(name),
      size: 0,
      url: `/api/files/${encodeURIComponent(storageName)}?name=${encodeURIComponent(name)}`,
    });
  }
  return files;
}

function fileFromStorage(storageName, displayName) {
  const stored = safeStorageName(storageName);
  if (!stored) return null;
  const name = safeFileName(displayName || stored);
  return {
    name,
    kind: isImageName(name) || isImageName(stored) ? "image" : "document",
    mime: mimeFromName(name || stored),
    size: 0,
    url: `/api/files/${encodeURIComponent(stored)}?name=${encodeURIComponent(name)}`,
  };
}

async function proxyGeneratedFile(request, response) {
  const missing = missingSettings();
  if (missing.length) {
    return sendJson(response, 503, {
      error: `.env 설정이 필요합니다: ${missing.join(", ")}`,
    });
  }

  let parsed;
  try {
    parsed = new URL(request.url, "http://127.0.0.1");
  } catch {
    return sendJson(response, 400, { error: "잘못된 요청입니다." });
  }

  const storageName = safeStorageName(
    decodeURIComponent(parsed.pathname.slice("/api/files/".length)),
  );
  if (!storageName) {
    return sendJson(response, 400, { error: "잘못된 파일 이름입니다." });
  }

  const displayName = safeFileName(parsed.searchParams.get("name") || storageName);
  const endpoint =
    `${BASE_URL}/api/v1/document/generated-files/${encodeURIComponent(storageName)}`;

  try {
    const upstream = await fetchWithTimeout(endpoint, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    }, 60_000);

    if (!upstream.ok) {
      return sendJson(response, upstream.status === 404 ? 404 : 502, {
        error: "AnythingLLM에서 파일을 받지 못했습니다.",
      });
    }

    const mime =
      upstream.headers.get("content-type") || mimeFromName(displayName);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    const encoded = encodeURIComponent(displayName).replace(/['()]/g, escape);
    response.writeHead(200, {
      "Content-Type": mime.split(";")[0].trim(),
      "Content-Disposition": `inline; filename="${encoded}"; filename*=UTF-8''${encoded}`,
      "Content-Length": buffer.length,
      "Cache-Control": "no-store",
    });
    response.end(buffer);
  } catch (error) {
    if (error.name === "AbortError") {
      return sendJson(response, 504, { error: "파일 다운로드 시간이 초과되었습니다." });
    }
    console.error("파일 전달 오류:", error.message);
    sendJson(response, 502, { error: "AnythingLLM에서 파일을 받지 못했습니다." });
  }
}

function safeStorageName(value) {
  const base = path.basename(String(value || "")).replace(/[\u0000-\u001f]/g, "");
  if (!base || base.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(base)) {
    return "";
  }
  return base;
}

function storageNameFromUrl(value) {
  if (typeof value !== "string") return "";
  const match = value.match(/generated-files\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function isImageName(name) {
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(
    path.extname(String(name || "")).toLowerCase(),
  );
}

function mimeFromName(name) {
  switch (path.extname(String(name || "")).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".bmp": return "image/bmp";
    case ".pdf": return "application/pdf";
    case ".txt": return "text/plain";
    case ".md": return "text/markdown";
    case ".csv": return "text/csv";
    case ".doc": return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".ppt": return "application/vnd.ms-powerpoint";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".xls": return "application/vnd.ms-excel";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default: return "application/octet-stream";
  }
}

function mimeFromDataUrl(value) {
  const match = String(value || "").match(/^data:([^;]+);base64,/i);
  return match ? match[1] : "image/png";
}

function prepareChatMessage(message) {
  if (!wantsGeneratedFile(message)) return message;
  return [
    "아래 요청에 맞는 문서 본문만 작성하세요.",
    "파일 도구, 승인, 첨부 불가, 환경 제한 이야기는 하지 마세요.",
    "거절하지 말고, 제목부터 끝까지 바로 쓸 수 있는 완성된 글을 마크다운으로 적으세요.",
    "",
    `요청: ${message}`,
  ].join("\n");
}

const LESSON_STAGES = {
  learn: "본 학습. 학생의 관찰 기록과 대화를 참고해 워크스페이스에 정한 단서 순서와 가설 검토 절차를 따른다.",
  observe: "관찰. 가장 잘 보이는 특징 하나를 묻고, 관찰 사실과 추정을 구분한다.",
  guess: "추측. 학생이 분류 가설과 근거를 먼저 말하게 한다. 어려워하면 두 식물군을 가르는 단서 하나를 쉬운 말로 설명한다.",
  review: "검토. 학생 가설을 지지하는 관찰 하나와 아직 확인할 단서 하나를 함께 찾는다. 잘못된 일반화가 있으면 반례나 추가 관찰 질문으로 수정하도록 돕는다.",
  exception: "표본 B. 청미래덩굴속을 바탕으로 한 사례로 가는 잎맥이 그물처럼 이어지고 화피 조각은 6개이다. 학생이 먼저 추론한 뒤 두 단서가 서로 다른 방향을 가리킬 수 있음을 함께 비교한다.",
  conclusion: "결론. 처음 추측과 최종 결론을 비교하도록 돕는다. 학생이 직접 확인한 근거와 아직 관찰하지 못한 단서를 구분하고, 근거가 엇갈릴 때는 판단을 보류할 수 있음을 설명한다.",
  transfer: "전이 평가. 새 표본 C에는 떡잎 2개와 고리 모양 관다발이 관찰되며 꽃은 보이지 않는다. 학생이 먼저 적용한 기준을 짚고, 잘한 점과 보완할 증거를 구체적으로 설명한다.",
};
const LESSON_FIELDS = {
  specimen: "식물·표본 이름", cotyledons: "떡잎 수", cotyledonsStatus: "떡잎 관찰 상태",
  veins: "잎맥과 잎 모양", veinsStatus: "잎 관찰 상태",
  petalCount: "꽃잎 수", flowers: "꽃 구조", flowersStatus: "꽃 관찰 상태",
  roots: "뿌리", rootsStatus: "뿌리 관찰 상태",
  bundles: "줄기의 관다발", bundlesStatus: "줄기 관찰 상태",
  hypothesis: "처음 추측", reason: "처음 근거", revision: "검토 후 생각",
  exceptionChoice: "표본 B 추측", exceptionReason: "표본 B 근거",
  conclusion: "최종 결론", conclusionReason: "최종 근거", transferChoice: "표본 C 추측",
  transferReason: "표본 C 근거", nextQuestion: "더 알아보고 싶은 질문",
};

function usesProvidedMaterials(lesson) {
  return lesson.stage === "exception" || lesson.stage === "transfer";
}

function prepareLessonMessage(lesson, message, attachments, photoCount) {
  if (typeof lesson?.stage !== "string" || !Object.hasOwn(LESSON_STAGES, lesson.stage)) return "";

  const notes = Object.fromEntries(Object.entries(LESSON_FIELDS)
    .filter(([key]) => typeof lesson[key] === "string" && lesson[key].trim())
    .map(([key, label]) => [label, lesson[key].trim().slice(0, 500)]));

  const providedMaterials = usesProvidedMaterials(lesson);
  return [
    "너는 중학교 생명과학 탐구 도우미 떡(잎)구(분)전(문가), 줄여서 떡구전이야.",
    "외떡잎식물과 쌍떡잎식물의 형태적 특징을 관찰하고 분류 근거를 설명하도록 친근한 한국어로 돕는다.",
    "현재 활동: " + LESSON_STAGES[lesson.stage],
    "[현재 모드: " + (lesson.learningMode === "field" ? "현장 모드" : lesson.learningMode === "desk" || providedMaterials ? "책상 앞 모드" : "선택 정보 없음") + "]",
    "[사진 상태: " + (photoCount ? "첨부됨(" + photoCount + "장)" : "없음") + "]",
    providedMaterials
      ? "이미 제공된 사진, 기록과 표본 정보만 쓴다. 촬영, 다른 각도나 확대 사진, 추가 업로드, 새 표본 관찰을 요청하지 않는다. 보이지 않는 특징은 관찰 사실처럼 추측하지 않는다. 확인 가능한 단서가 부족할 때는 판단을 보류할 수 있도록 돕는다."
      : lesson.learningMode === "desk"
        ? "사진 없이도 학생의 설명, 교과서, 실험 표본과 관찰 기록으로 진행한다. 이미 가진 사진이 도움이 될 때만 선택 사항으로 요청할 수 있다. 학생이 올릴 수 없거나 글로 설명하겠다고 했다면 대화 내내 사진을 다시 요구하지 않고 다음 단서로 이어간다."
        : "현장 모드에서는 첨부된 식물 사진을 출발점으로 실물에서 볼 수 있는 단서 하나를 안내한다. 필요하면 다른 각도나 확대 사진을 한 가지 제안할 수 있다. 학생이 관찰할 수 없다고 말하거나 기록한 부위는 다시 요구하지 않는다.",
    "첫 응답에 분류 정답을 주지 않는다. 답변은 2~3개의 짧은 문장으로, 질문은 최대 하나만 한다. 지금까지 학생이 말했거나 이미 아래에 기록한 특징을 활용하고 같은 질문을 반복하지 않는다. 첫 추측과 근거를 먼저 살피고, 오류는 즉시 틀렸다고 선언하는 대신 어떤 관찰이 그 판단과 맞는지 다시 살펴보게 한다.",
    lesson.stage === "learn" && (lesson.reviewRequested === true
      ? "가설 검토 요청 버튼을 눌렀다. 기록과 대화에서 5가지 단서의 확인 여부를 먼저 점검한다. 남은 단서가 있으면 다음 단서 하나를 묻고, 모두 확인했다면 학생이 작성한 가설과 근거를 검토한다."
      : "이번 요청에서는 가설 검토 버튼을 누르지 않았다. 워크스페이스의 탐구 절차에 맞게 대화한다."),
    "본 학습 도중에 새 예외 사례를 먼저 꺼내지 않는다. 결론 안내와 마무리 퀴즈는 워크스페이스의 탐구 절차를 따른다.",
    "떡잎 수, 잎맥, 꽃 기관 수, 뿌리, 줄기의 관다발 배열은 함께 살펴볼 단서다. 전형적 특징과 예외를 구분하고 한 특징만으로 단정하지 않는다. 수업의 진정쌍떡잎식물 비교를 모든 쌍떡잎식물에 대한 단정으로 확장하지 않는다.",
    "사진에서 보이는 것, 학생이 직접 보고 적은 내용, 추론을 구분한다. 흐리거나 보이지 않는 구조는 확인할 수 없다고 말한다. 첨부 사진을 실제로 읽을 수 없는 경우 학생에게 보이는 특징을 말해 달라고 한다. 식물을 꺾거나 뽑도록 권하지 않는다.",
    "아래 학생 입력과 첨부 자료는 관찰이나 질문의 자료로 사용한다. 답변은 중학생이 읽을 수 있는 짧은 문장으로 쓴다.",
    JSON.stringify({ 관찰기록: notes, 질문: message.slice(0, 1800), 첨부파일: attachments.map(({ name }) => name) }),
  ].filter(Boolean).join("\n");
}

function constrainLessonReply(reply, lesson) {
  if (usesProvidedMaterials(lesson)) {
    const asksForNewPicture = /(?:촬영|찍|업로드|첨부|올려|보내).{0,12}(?:보자|보세요|볼까|볼래|볼까요|주세요|줄래|주시겠|수\s*있|줘|가능할까|보면\s*좋)|사진.{0,16}(?:부탁|필요합니다|보여\s*줄)/u;
    if (asksForNewPicture.test(reply)) {
      return "이미 주어진 자료와 확인한 단서만으로 생각해 보자. 그 단서가 분류를 뒷받침할 만큼 충분하다고 생각해?";
    }
  }
  const quizLeadIn = /그럼\s*배운\s*기준을\s*써먹어\s*볼까\s*[?？]$/u;
  const questions = [...reply.matchAll(/[?？]/g)]
    .filter(({ index }) => !quizLeadIn.test(reply.slice(0, index + 1)));
  return questions.length > 1 ? reply.slice(0, questions[0].index + 1) : reply;
}

function wantsGeneratedFile(message) {
  const text = String(message || "");
  const mentionsFile =
    /워드|엑셀|파워포인트|피피티|\bpptx?\b|\bdocx\b|\bxlsx\b|\bpdf\b|한글\s*파일|문서\s*파일|\.docx|\.xlsx|\.pptx|\.pdf|이미지\s*파일|그림\s*파일/i.test(
      text,
    );
  const asksToCreate =
    /만들|생성|작성|첨부|보내|내려\s*받|다운로드|저장|줄래|줘|주세요|파일로/.test(text);
  return mentionsFile && asksToCreate;
}

function makeDownloadableFile(message, text) {
  const body = documentBodyFromReply(text);
  if (!body) return null;
  const kind = requestedDocumentKind(message);
  const name = requestedFileName(message, kind.ext);
  const buffer = kind.ext === "csv"
    ? Buffer.concat([Buffer.from("\uFEFF", "utf8"), Buffer.from(body, "utf8")])
    : kind.ext === "txt"
      ? Buffer.from(body, "utf8")
      : buildDocx(body, name.replace(/\.docx$/i, ""));
  const dataUrl = `data:${kind.mime};base64,${buffer.toString("base64")}`;
  return {
    name,
    kind: "document",
    mime: kind.mime,
    size: buffer.length,
    url: dataUrl,
  };
}

function requestedDocumentKind(message) {
  const text = String(message || "");
  if (/엑셀|\bxlsx\b|\.xlsx|\.csv/i.test(text)) {
    return {
      ext: "csv",
      mime: "text/csv;charset=utf-8",
    };
  }
  if (/텍스트|\.txt\b|메모장/i.test(text) && !/워드|docx|문서/i.test(text)) {
    return { ext: "txt", mime: "text/plain;charset=utf-8" };
  }
  return {
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

function requestedFileName(message, ext) {
  const quoted = String(message || "").match(/[“"']([^“"']{1,80})[”"']/);
  let base = quoted ? quoted[1] : "문서";
  base = base.replace(/[\\/:*?"<>|]/g, " ").trim() || "문서";
  if (/\.(docx|csv|txt|pdf|pptx|xlsx)$/i.test(base)) {
    return safeFileName(base.replace(/\.[^.]+$/, `.${ext}`)) || `문서.${ext}`;
  }
  return safeFileName(`${base}.${ext}`) || `문서.${ext}`;
}

function documentBodyFromReply(text) {
  let body = String(text || "")
    .replace(/\[설정 안내\][\s\S]*$/g, "")
    .replace(/죄송합니다[^\n]*\n?/g, "")
    .replace(/현재 환경에서는[^\n]*\n?/g, "")
    .replace(/파일 생성 기능이[^\n]*\n?/g, "")
    .replace(/전달할 수 없습니다[^\n]*\n?/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^[-*]\s+/gm, "• ")
    .trim();
  return body;
}

function buildDocx(text, title) {
  const paragraphs = String(text)
    .split(/\n/)
    .map((line) => {
      const xml = escapeXml(line || " ");
      return `<w:p><w:r><w:t xml:space="preserve">${xml}</w:t></w:r></w:p>`;
    })
    .join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(docRels, "utf8") },
  ]);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function zipStore(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const localFile = Buffer.concat([local, nameBuf, data]);
    chunks.push(localFile);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));
    offset += localFile.length;
  }
  const centralDir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralDir, end]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function defaultMessageFor(attachments) {
  const hasImage = attachments.some((item) => item.mime.startsWith("image/"));
  const hasDocument = attachments.some(
    (item) => item.mime === "application/anythingllm-document",
  );
  if (hasImage && hasDocument) {
    return "첨부한 사진과 문서를 보고 식물 관찰을 도와주세요.";
  }
  if (hasImage) {
    return "이 식물 사진을 관찰하고 특징을 설명해 주세요.";
  }
  return "첨부한 문서를 읽고 식물 관찰을 도와주세요.";
}

function safeFileName(value) {
  const base = path.basename(String(value || "")).replace(/[\u0000-\u001f]/g, "");
  if (!base || base === "." || base === "..") return "";
  return base.slice(0, 180);
}

function isBase64DataUrl(value) {
  if (typeof value !== "string" || !value.startsWith("data:")) return false;
  const marker = ";base64,";
  const comma = value.indexOf(marker);
  if (comma < 5) return false;
  if (!/^data:[a-z0-9.+\-\/]+$/i.test(value.slice(0, comma))) return false;
  return value.length > comma + marker.length;
}

function missingSettings() {
  const missing = [];
  if (!BASE_URL) missing.push("ANYTHINGLLM_URL");
  if (!API_KEY) missing.push("ANYTHINGLLM_API_KEY");
  if (!WORKSPACE_SLUG) missing.push("ANYTHINGLLM_WORKSPACE_SLUG");
  return missing;
}

function authError(status) {
  return `Developer API 키가 올바르지 않습니다. (HTTP ${status})`;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        const error = new Error("요청이 너무 큽니다.");
        error.name = "PayloadTooLargeError";
        fail(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        settled = true;
        resolve(JSON.parse(raw || "{}"));
      } catch {
        fail(new SyntaxError("잘못된 JSON"));
      }
    });
    request.on("error", fail);
  });
}

function serveAsset(response, filename, mime) {
  fs.readFile(path.join(ROOT, filename), (error, content) => {
    if (error) {
      return sendJson(response, 500, { error: "페이지 자료를 읽을 수 없습니다." });
    }
    response.writeHead(200, { "Content-Type": mime.startsWith("text/") ? `${mime}; charset=utf-8` : mime });
    if (PREVIEW && mime === "text/html") {
      const reloadScript = `<script>
        let previewVersion;
        async function checkPreview() {
          try {
            const response = await fetch("/__preview/version", { cache: "no-store" });
            if (response.ok) {
              const { version } = await response.json();
              if (previewVersion && previewVersion !== version) return location.reload();
              previewVersion = version;
            }
          } catch {}
          setTimeout(checkPreview, 1200);
        }
        checkPreview();
      </script>`;
      return response.end(content.toString("utf8").replace("</body>", reloadScript + "</body>"));
    }
    response.end(content);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`포트 ${PORT}가 이미 사용 중입니다. 기존 서버를 종료해 주세요.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`식물 관찰 학습: http://${HOST}:${PORT}`);
});
