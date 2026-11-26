"use strict";

const $ = (id) => document.getElementById(id);
const stages = [
  ["observe", "관찰", "어떤 식물을 살펴볼까요? 사진이나 표본에서 보이는 단서 한 가지부터 기록해 봐요."],
  ["guess", "추론", "관찰한 단서가 어느 쪽을 가리키나요? 추측과 그렇게 생각한 이유를 말해 봐요."],
  ["exception", "예외 토의", "표본 B의 두 단서가 같은 방향을 가리키나요? 네 생각을 먼저 알려 줘요."],
  ["conclusion", "결론", "처음 생각에서 무엇이 달라졌나요? 어떤 단서가 결론을 지지하는지 말해 봐요."],
  ["transfer", "전이 평가", "새로운 표본 C에도 분류 기준을 써 봐요. 무엇을 더 확인하고 싶나요?"],
];
const evidence = [
  ["cotyledons", "떡잎의 수", "예: 싹에서 2개가 보임"],
  ["veins", "잎맥과 잎 모양", "예: 잎이 길고 잎맥이 나란함"],
  ["flowers", "꽃의 구조", "예: 화피 조각 6개"],
  ["roots", "뿌리", "예: 비슷한 굵기의 뿌리가 여러 개"],
  ["bundles", "줄기의 관다발", "예: 단면 가장자리에 고리 모양"],
];
const classifications = ["", "외떡잎식물로 추정", "쌍떡잎식물로 추정", "판단 보류"];
const views = { home: "탐구 홈", observe: "관찰 및 비교", lab: "AI 탐구실", challenge: "예외 사례", guide: "개념 학습", journal: "나의 탐구 도감", sources: "참고 자료" };
const lessonAnchors = new Set(["observe", "lab", "challenge"]);
const offlineHints = new Map([
  ["잎맥이 나란히 나 있어요", "굵은 맥이 잎 밑에서 끝까지 비슷한 방향으로 이어지나요? 꽃도 보인다면 꽃 한 송이의 화피 조각을 세어 두 단서를 비교해 보세요."],
  ["그물처럼 얽혀 있어요", "굵은 맥에서 갈라진 작은 맥들이 다시 이어지는지 살펴봐요. 청미래덩굴처럼 작은 맥이 그물 모양인 외떡잎식물도 있어요. 다른 단서는 무엇이 보이나요?"],
  ["꽃잎 수를 세어봤어요", "꽃 한 송이의 꽃잎이나 화피 조각을 몇 개 셌나요? 작은 꽃들이 모여 있다면 한 송이의 경계를 먼저 찾고, 잎맥 관찰 결과와 비교해 봐요."],
]);
const draftKey = "plant-observation-lesson-draft-v1";
const journalKey = "plant-observation-lesson-records-v1";
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"]);
const documentTypes = /\.(txt|md|csv|pdf|docx?|pptx?|xlsx?)$/i;
const maxFileBytes = 13 * 1024 * 1024;
const maxTotalBytes = 22 * 1024 * 1024;

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function writeStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

const saved = readStorage(draftKey, {});
const draft = saved.draft && typeof saved.draft === "object" ? saved.draft : {};
const storedRecords = readStorage(journalKey, []);
let records = Array.isArray(storedRecords) ? storedRecords : [];
let recordId = typeof saved.id === "string" ? saved.id : crypto.randomUUID();
const savedIndex = Number.isInteger(saved.stage) ? [0, 1, 1, 2, 3][saved.stage]
  : stages.findIndex(([id]) => id === saved.stage);
let stage = stages[savedIndex] ? savedIndex : 0;
let sessionId = crypto.randomUUID();
let busy = false;
let reading = false;
let connectionState = "pending";
let attachments = [];
const conversations = stages.map(() => []);

for (const [key, label, example] of evidence) {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  wrapper.textContent = label;
  const input = document.createElement("input");
  input.dataset.field = key;
  input.maxLength = 160;
  input.placeholder = example;
  wrapper.append(input);
  $("evidence-fields").append(wrapper);
}

for (const select of document.querySelectorAll("[data-classification]")) {
  for (const value of classifications) select.add(new Option(value || "선택해 주세요", value));
}

const fields = [...document.querySelectorAll("[data-field]")];
const fieldValue = (key) => typeof draft[key] === "string" ? draft[key].trim() : "";
function hydrateFields() {
  for (const field of fields) field.value = fieldValue(field.dataset.field);
}
function rememberDraft() {
  writeStorage(draftKey, { id: recordId, stage: stages[stage][0], draft });
}
for (const field of fields) {
  field.addEventListener("input", () => {
    draft[field.dataset.field] = field.value;
    rememberDraft();
  });
}

const stepButtons = stages.map(([, title], index) => {
  const button = document.createElement("button");
  const number = document.createElement("span");
  number.textContent = String(index + 1) + "단계:";
  button.type = "button";
  button.className = "step";
  button.append(number, " " + title);
  button.addEventListener("click", () => moveTo(index));
  $("steps").append(button);
  return button;
});

function renderView() {
  const hash = location.hash.slice(1);
  const target = Object.hasOwn(views, hash) ? hash : "home";
  const view = lessonAnchors.has(target) ? "home" : target;
  for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== view;
  for (const link of document.querySelectorAll(".sidebar nav a")) {
    if (link.hash === "#" + target) link.setAttribute("aria-current", lessonAnchors.has(target) ? "location" : "page");
    else link.removeAttribute("aria-current");
  }
  $("breadcrumb").textContent = views[target];
  if (view === "journal") renderJournal();
  if (lessonAnchors.has(target)) $(target).scrollIntoView({ block: "start" });
  else window.scrollTo(0, 0);
}

function validateStep(index) {
  const observed = evidence.some(([key]) => !/^(?:확인\s*못함|관찰\s*못함|모름|없음)?$/.test(fieldValue(key)));
  if (index === 0 && !observed) return "눈으로 확인한 특징을 한 가지 이상 적어 주세요.";
  if (index === 1 && (!fieldValue("hypothesis") || !fieldValue("reason"))) return "첫 추측과 그 근거를 적어 주세요.";
  if (index === 2 && !hasCaseReason("exception")) return "표본 B에 대한 추론과 근거를 적어 주세요.";
  if (index === 3 && (!fieldValue("conclusion") || !fieldValue("conclusionReason"))) return "처음 식물에 대한 최종 결론과 근거를 적어 주세요.";
  if (index === 4 && !hasCaseReason("transfer")) return "새 식물에 대한 추측과 근거를 적어 주세요.";
  return "";
}

function hasCaseReason(kind) {
  return Boolean(fieldValue(kind + "Choice") && fieldValue(kind + "Reason"));
}

function moveTo(next) {
  for (let index = 0; index < next; index += 1) {
    const issue = validateStep(index);
    if (issue) {
      showStep(index, true);
      $("lab-status").textContent = issue;
      return;
    }
  }
  showStep(next, true);
}

function showStep(index, focus) {
  stage = index;
  const current = stages[stage][0];
  for (const panel of document.querySelectorAll("[data-stage]")) panel.hidden = panel.dataset.stage !== current;
  for (const [position, button] of stepButtons.entries()) {
    if (position === stage) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
    button.classList.toggle("visited", position < stage);
  }
  $("step-progress").value = stage + 1;
  $("step-count").textContent = "탐구 진행 " + (stage + 1) + " / " + stages.length;
  $("prev-step").hidden = stage === 0;
  $("next-step").hidden = stage === stages.length - 1;
  $("save-record").hidden = stage !== stages.length - 1;
  $("lab-status").textContent = "";
  $("chat-status").textContent = "";
  const summary = $("review-summary");
  const summaryText = document.createElement("p");
  summaryText.textContent = evidence
    .filter(([key]) => fieldValue(key))
    .map(([key, label]) => label + " · " + fieldValue(key)).join("\n");
  summary.replaceChildren(summaryText);
  summary.hidden = !summaryText.textContent;
  renderChat();
  rememberDraft();
  if (focus) document.querySelector("[data-stage='" + current + "'] h3").focus();
}

function renderAttachments() {
  const photos = $("file-list");
  const documents = $("document-list");
  photos.replaceChildren();
  documents.replaceChildren();
  const image = attachments.find((item) => imageTypes.has(item.mime));
  const preview = $("photo-preview");
  preview.hidden = !image;
  $("upload-placeholder").hidden = Boolean(image);
  $("photo-action").textContent = image ? "다른 사진 추가하기" : "사진 선택하기";
  if (image) preview.src = image.contentString;
  else preview.removeAttribute("src");
  attachments.forEach((item, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button";
    button.textContent = "제거";
    button.setAttribute("aria-label", item.name + " 제거");
    button.addEventListener("click", () => {
      attachments.splice(index, 1);
      renderAttachments();
    });
    li.append(item.name, button);
    (imageTypes.has(item.mime) ? photos : documents).append(li);
  });
}

function readAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mime: file.type || "application/octet-stream", contentString: reader.result, size: file.size });
    reader.onerror = () => reject(new Error("파일을 읽지 못했어요."));
    reader.readAsDataURL(file);
  });
}

function refreshControls() {
  const disabled = busy || reading;
  for (const button of document.querySelectorAll(".coach-action, #chat-form button, #new-record")) {
    button.disabled = disabled;
  }
  $("attachments").disabled = disabled;
  $("documents").disabled = disabled;
}

async function addAttachments(event) {
  const selected = [...event.target.files];
  const fromPhotos = event.target.id === "attachments";
  const status = $(fromPhotos ? "photo-status" : "chat-status");
  event.target.value = "";
  if (!selected.length) return;
  reading = true;
  refreshControls();
  const skipped = [];
  try {
    for (const file of selected) {
      const sum = attachments.reduce((size, item) => size + item.size, file.size);
      if (!(fromPhotos ? imageTypes.has(file.type) : documentTypes.test(file.name)) ||
          file.size === 0 || file.size > maxFileBytes || sum > maxTotalBytes || attachments.length >= 10) {
        skipped.push(file.name);
        continue;
      }
      try { attachments.push(await readAttachment(file)); }
      catch { skipped.push(file.name); }
    }
    renderAttachments();
    status.textContent = skipped.length
      ? "일부 파일을 추가하지 못했어요. 지원 형식, 한 파일 13 MB, 합계 22 MB, 최대 10개를 확인해 주세요."
      : fromPhotos ? "사진을 추가했어요. 아래 AI 탐구실에서 단서를 적어 보세요." : "문서를 추가했어요.";
  } finally {
    reading = false;
    refreshControls();
  }
}
$("attachments").addEventListener("change", addAttachments);
$("documents").addEventListener("change", addAttachments);

function renderChat() {
  const log = $("chat-log");
  log.replaceChildren();
  const entries = [{ text: stages[stage][2] }, ...conversations[stage]];
  for (const { text, mine, files } of entries) {
    const bubble = document.createElement("div");
    bubble.className = "message" + (mine ? " me" : "");
    bubble.textContent = text;
    for (const file of Array.isArray(files) ? files : []) {
      if (typeof file?.url !== "string" ||
          !/^(?:\/api\/files\/[^/]|data:(?:image\/(?:png|jpeg|gif|webp|bmp)|application\/(?:octet-stream|vnd\.[\w.-]+)|text\/(?:plain|csv));base64,)/i.test(file.url)) continue;
      const link = document.createElement("a");
      link.href = file.url;
      link.textContent = file.name || "첨부 파일 내려받기";
      link.download = file.name || "attachment";
      bubble.append(link);
    }
    log.append(bubble);
  }
  log.scrollTop = log.scrollHeight;
}

async function checkConnection() {
  const label = $("connection");
  try {
    if (location.protocol === "file:") throw Error();
    const response = await fetch("./api/health");
    if (!response.ok || !(await response.json()).connected) throw Error();
    label.textContent = "AnythingLLM 연결됨";
    connectionState = "online";
    $("chat-note").textContent = "보내기를 누르면 질문과 탐구 기록, 선택한 사진·문서가 AnythingLLM에 전달돼요.";
  } catch {
    label.textContent = "기기 내 힌트 모드";
    connectionState = "offline";
    $("chat-note").textContent = "AI 연결 전에는 기기에 포함된 탐구 힌트를 보여 줘요. 입력과 사진은 전송되지 않아요.";
  }
  label.dataset.state = connectionState;
}

async function send(message) {
  if (!message || busy || reading) return;
  if (connectionState === "pending") {
    $("chat-status").textContent = "AI 연결을 확인하고 있어요. 잠시 뒤 다시 눌러 주세요.";
    return;
  }
  const sentAt = stage;
  const existingInput = $("chat-input").value;
  const turn = { text: message, mine: true };
  conversations[sentAt].push(turn);
  $("chat-input").value = "";
  if (connectionState === "offline") {
    const hint = offlineHints.get(message) || stages[sentAt][2];
    conversations[sentAt].push({ text: "기기 내 탐구 힌트 · " + hint });
    $("chat-status").textContent = "";
    renderChat();
    return;
  }
  renderChat();
  $("chat-status").textContent = "떡구전이 답변을 준비하고 있어요…";
  busy = true;
  refreshControls();
  try {
    const response = await fetch("./api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        sessionId,
        lesson: { ...draft, stage: stages[sentAt][0] },
        attachments,
      }),
    });
    const body = await response.json();
    if (!response.ok || !body.textResponse) {
      throw new Error(response.status === 503 ? "AI 연결을 확인해 주세요. 관찰과 기록은 계속할 수 있어요."
        : body.error || "답변을 받지 못했어요. 다시 보내 주세요.");
    }
    conversations[sentAt].push({ text: body.textResponse, files: body.files });
    if (stage === sentAt) $("chat-status").textContent = "";
  } catch (error) {
    conversations[sentAt].pop();
    if (stage === sentAt) {
      $("chat-input").value ||= existingInput || message;
      $("chat-status").textContent = error instanceof SyntaxError || error instanceof TypeError
        ? "AI 연결을 확인해 주세요. 관찰과 기록은 계속할 수 있어요." : error.message;
    }
  } finally {
    busy = false;
    refreshControls();
    renderChat();
  }
}

$("chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const message = $("chat-input").value.trim();
  if (!message) {
    $("chat-status").textContent = "먼저 질문이나 관찰 내용을 적어 주세요.";
    $("chat-input").focus();
    return;
  }
  send(message);
});
for (const button of document.querySelectorAll("[data-coach], [data-reveal]")) {
  button.addEventListener("click", () => {
    const kind = button.dataset.check || button.dataset.reveal;
    if (kind && !hasCaseReason(kind)) {
      $("lab-status").textContent = "먼저 나의 추측과 그 근거를 적어 주세요.";
      return;
    }
    $("lab-status").textContent = "";
    if (button.dataset.reveal) $(kind + "-explanation").hidden = false;
    else send(button.dataset.coach);
  });
}

function renderJournal() {
  const list = $("journal-list");
  list.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "card";
    empty.textContent = "아직 탐구 기록이 없어요. 탐구실에서 결론을 정리하면 여기에 나타나요.";
    list.append(empty);
  }
  for (const record of records) {
    const values = record.values || {};
    const entry = document.createElement("details");
    entry.className = "card";
    const summary = document.createElement("summary");
    const date = new Date(record.savedAt).toLocaleDateString("ko-KR");
    summary.textContent = (values.specimen || "이름을 적지 않은 표본") + " · " + date + " · " + (values.conclusion || "");
    entry.append(summary);
    const recordFields = [
      ...evidence, ["hypothesis", "첫 추측"], ["reason", "첫 근거"], ["revision", "검토 후 생각"],
      ["exceptionChoice", "예외 사례 추론"], ["exceptionReason", "예외 사례 근거"],
      ["conclusion", "최종 결론"], ["conclusionReason", "최종 근거"], ["transferChoice", "새 식물 추측"],
      ["transferReason", "새 식물 근거"], ["nextQuestion", "더 알아보고 싶은 질문"],
    ];
    for (const [key, label] of recordFields) {
      if (!values[key]) continue;
      const p = document.createElement("p");
      p.textContent = label + " · " + values[key];
      entry.append(p);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "이 기록 삭제";
    remove.addEventListener("click", () => {
      if (!window.confirm("도감에서 이 기록을 삭제할까요?")) return;
      const remaining = records.filter((item) => item.id !== record.id);
      if (!writeStorage(journalKey, remaining)) {
        $("journal-status").textContent = "기록을 삭제하지 못했어요.";
        return;
      }
      records = remaining;
      $("journal-status").textContent = "도감에서 기록을 삭제했어요.";
      renderJournal();
    });
    entry.append(remove);
    list.append(entry);
  }
}

$("save-record").addEventListener("click", () => {
  for (let index = 0; index < stages.length; index += 1) {
    const issue = validateStep(index);
    if (issue) {
      showStep(index, true);
      $("lab-status").textContent = issue;
      return;
    }
  }
  const savedRecord = { id: recordId, values: { ...draft }, savedAt: Date.now() };
  const updated = [savedRecord, ...records.filter((record) => record.id !== recordId)];
  if (!writeStorage(journalKey, updated)) {
    $("lab-status").textContent = "브라우저에 기록을 저장하지 못했어요. 저장 공간 설정을 확인해 주세요.";
    return;
  }
  records = updated;
  location.hash = "journal";
});

$("new-record").addEventListener("click", () => {
  const previous = records.find((record) => record.id === recordId);
  const changed = fields.some((field) => fieldValue(field.dataset.field) !== (previous?.values?.[field.dataset.field]?.trim() || ""));
  if (changed && !window.confirm("저장하지 않은 탐구 내용을 비우고 새로 시작할까요?")) return;
  for (const key of Object.keys(draft)) delete draft[key];
  recordId = crypto.randomUUID();
  sessionId = crypto.randomUUID();
  attachments = [];
  conversations.forEach((turns) => { turns.length = 0; });
  $("chat-input").value = "";
  $("exception-explanation").hidden = true;
  $("transfer-explanation").hidden = true;
  hydrateFields();
  renderAttachments();
  showStep(0, false);
  location.hash = "lab";
});

$("prev-step").addEventListener("click", () => moveTo(stage - 1));
$("next-step").addEventListener("click", () => moveTo(stage + 1));
window.addEventListener("hashchange", renderView);
hydrateFields();
showStep(stage, false);
renderView();
checkConnection();
