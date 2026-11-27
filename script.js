"use strict";

const $ = (id) => document.getElementById(id);
const stages = [
  ["observe", "관찰", "어떤 식물을 살펴볼까요? 사진이나 표본에서 보이는 단서 한 가지부터 기록해 봐요."],
  ["guess", "추론", "관찰한 단서가 어느 쪽을 가리키나요? 추측과 그렇게 생각한 이유를 말해 봐요."],
  ["conclusion", "결론", "처음 생각에서 무엇이 달라졌나요? 어떤 단서가 결론을 지지하는지 말해 봐요."],
  ["transfer", "전이 평가", "새로운 표본 C에도 분류 기준을 써 봐요. 무엇을 더 확인하고 싶나요?"],
];
const exceptionHint = "표본 B의 두 단서가 같은 방향을 가리키나요? 네 생각을 먼저 알려 줘요.";
const evidence = [
  ["cotyledons", "떡잎의 수", "예: 싹에서 2개가 보임"],
  ["veins", "잎맥과 잎 모양", "예: 잎이 길고 잎맥이 나란함"],
  ["flowers", "꽃의 구조", "예: 화피 조각 6개"],
  ["roots", "뿌리", "예: 비슷한 굵기의 뿌리가 여러 개"],
  ["bundles", "줄기의 관다발", "예: 단면 가장자리에 고리 모양"],
];
const classifications = ["", "외떡잎식물로 추정", "쌍떡잎식물로 추정", "판단 보류"];
const views = { home: "탐구 홈", observe: "관찰 및 비교", lab: "AI 탐구실", challenge: "예외 토의", guide: "개념 학습", journal: "나의 탐구 도감", sources: "참고 자료" };
const lessonAnchors = new Set(["observe", "lab"]);
const offlineHints = new Map([
  ["잎맥이 나란히 나 있어요", "굵은 맥이 잎 밑에서 끝까지 비슷한 방향으로 이어지나요? 꽃도 보인다면 꽃 한 송이의 화피 조각을 세어 두 단서를 비교해 보세요."],
  ["그물처럼 얽혀 있어요", "굵은 잎맥에서 갈라진 작은 맥들이 다시 이어지는지 살펴봐요. 이 모양을 관찰 기록에 어떻게 적을까요?"],
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

function openJournal() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("plant-observation-journal", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("records", { keyPath: "id" });
      for (const record of records) {
        if (typeof record?.id === "string") store.put(record);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("도감을 열 수 없어요."));
  });
}

async function journalRequest(mode, action) {
  const database = await journalDatabase;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("records", mode);
    const request = action(transaction.objectStore("records"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

const saved = readStorage(draftKey, {});
const draft = saved.draft && typeof saved.draft === "object" ? saved.draft : {};
const storedRecords = readStorage(journalKey, []);
let records = Array.isArray(storedRecords) ? storedRecords : [];
const journalDatabase = openJournal();
let recordId = typeof saved.id === "string" ? saved.id : crypto.randomUUID();
const savedStage = Number.isInteger(saved.stage) ? ["observe", "guess", "guess", "conclusion", "transfer"][saved.stage] : saved.stage;
const savedIndex = stages.findIndex(([id]) => id === (savedStage === "exception" ? "conclusion" : savedStage));
let stage = stages[savedIndex] ? savedIndex : 0;
let sessionId = crypto.randomUUID();
let busy = false;
let pendingTurns = null;
let reading = false;
let saving = false;
let connectionState = "pending";
let attachments = [];
let photosChanged = false;
let inChallenge = false;
const exceptionSession = crypto.randomUUID();
const exceptionConversation = [];
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
  for (const value of classifications) {
    const label = select.dataset.field === "conclusion" ? conclusionLabel(value) : value;
    select.add(new Option(label || "선택해 주세요", value));
  }
}

const fields = [...document.querySelectorAll("[data-field]")];
const fieldValue = (key) => typeof draft[key] === "string" ? draft[key].trim() : "";
function conclusionLabel(value) {
  return (value || "").replace(/로 추정$/, "");
}
function plantValues() {
  const { exceptionChoice, exceptionReason, ...values } = draft;
  return values;
}
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
  const wasInChallenge = inChallenge;
  inChallenge = view === "challenge";
  if (inChallenge !== wasInChallenge) {
    $(inChallenge ? "challenge-lab" : "lab-grid").append($("lesson-coach"));
    $("chat-input").value = "";
    $("chat-status").textContent = "";
    renderChat();
    renderChatNote();
  }
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
  if (stages[index][0] === "conclusion" && (!fieldValue("conclusion") || !fieldValue("conclusionReason"))) return "처음 식물에 대한 최종 결론과 근거를 적어 주세요.";
  if (stages[index][0] === "transfer" && !hasCaseReason("transfer")) return "새 식물에 대한 추측과 근거를 적어 주세요.";
  return "";
}

function hasCaseReason(kind) {
  return Boolean(fieldValue(kind + "Choice") && fieldValue(kind + "Reason"));
}

async function moveTo(next) {
  if (saving || reading) return;
  for (let index = 0; index < next; index += 1) {
    const issue = validateStep(index);
    if (issue) {
      showStep(index, true);
      $("lab-status").textContent = issue;
      return;
    }
  }
  const conclusionIndex = stages.findIndex(([id]) => id === "conclusion");
  const justSaved = next > conclusionIndex && stage <= conclusionIndex;
  if (justSaved && !await saveRecord()) return;
  showStep(next, true);
  if (justSaved) {
    $("lab-status").textContent = attachments.some((item) => imageTypes.has(item.mime))
      ? "관찰 특징, 결론, 사진을 도감에 저장했어요."
      : "관찰 특징과 결론을 도감에 저장했어요.";
  }
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
  $("next-step").textContent = current === "conclusion" ? "결론 마치기 · 도감에 자동 저장" : "다음 단계";
  $("save-record").hidden = stage !== stages.length - 1;
  $("view-record").hidden = current !== "transfer" || !records.some((record) => record.id === recordId);
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
      if (saving) return;
      attachments.splice(index, 1);
      if (imageTypes.has(item.mime)) photosChanged = true;
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
  const disabled = busy || reading || saving;
  for (const button of document.querySelectorAll(".coach-action, #chat-form button, #new-record")) {
    button.disabled = disabled;
  }
  $("attachments").disabled = disabled;
  $("documents").disabled = disabled;
  for (const button of [...stepButtons, $("prev-step"), $("next-step"), $("save-record")]) {
    button.disabled = reading || saving;
  }
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
      try {
        attachments.push(await readAttachment(file));
        if (fromPhotos) photosChanged = true;
      }
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

function isPraise(text) {
  return /잘했(?:어|다|네)|잘\s*(?:봤|찾았|찾아냈|짚었|골랐|관찰했|설명했|정리했|적었|생각했|비교했|구분했|분류했)|훌륭해|멋져|(?:정확히|정확하게)\s*(?:봤|찾았|찾아냈|짚었|관찰했|구분했|분류했)|핵심을\s*(?:딱\s*)?짚었|(?:관찰|추론|설명|근거|판단)(?:이|가)\s*(?:아주\s*|정말\s*)?(?:정확|좋|훌륭|탄탄)|(?:^|[.!?\n]\s*)(?:좋아|좋아요|맞아|맞아요|정답이야|정답이에요)[!！]/u.test(text);
}

function renderChat() {
  const log = $("chat-log");
  const turns = inChallenge ? exceptionConversation : conversations[stage];
  const expression = turns === pendingTurns ? "thinking" : turns.at(-1)?.praise ? "praise" : "ready";
  for (const avatar of $("lesson-coach").querySelectorAll("[data-expression]")) {
    avatar.hidden = avatar.dataset.expression !== expression;
  }
  log.replaceChildren();
  const entries = [{ text: inChallenge ? exceptionHint : stages[stage][2] }, ...turns];
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
  } catch {
    label.textContent = "기기 내 힌트 모드";
    connectionState = "offline";
  }
  label.dataset.state = connectionState;
  renderChatNote();
}

function renderChatNote() {
  if (connectionState === "pending") return;
  $("chat-note").textContent = connectionState === "offline"
    ? "AI 연결 전에는 기기에 포함된 탐구 힌트를 보여 줘요. 입력과 사진은 전송되지 않아요."
    : inChallenge ? "보내기를 누르면 예외 사례에 대한 추론과 질문이 AnythingLLM에 전달돼요."
    : "보내기를 누르면 질문과 탐구 기록, 선택한 사진·문서가 AnythingLLM에 전달돼요.";
}

async function send(message) {
  if (!message || busy || reading) return;
  if (connectionState === "pending") {
    $("chat-status").textContent = "AI 연결을 확인하고 있어요. 잠시 뒤 다시 눌러 주세요.";
    return;
  }
  const sentAt = stage;
  const sentInChallenge = inChallenge;
  const turns = sentInChallenge ? exceptionConversation : conversations[sentAt];
  const stillVisible = () => inChallenge === sentInChallenge && (sentInChallenge || stage === sentAt);
  const [exceptionChoice, exceptionReason] = [fieldValue("exceptionChoice"), fieldValue("exceptionReason")];
  const existingInput = $("chat-input").value;
  const turn = { text: message, mine: true };
  turns.push(turn);
  $("chat-input").value = "";
  if (connectionState === "offline") {
    const hint = sentInChallenge ? exceptionHint : offlineHints.get(message) || stages[sentAt][2];
    turns.push({ text: "기기 내 탐구 힌트 · " + hint });
    $("chat-status").textContent = "";
    renderChat();
    return;
  }
  busy = true;
  pendingTurns = turns;
  renderChat();
  $("chat-status").textContent = "떡구전이 답변을 준비하고 있어요…";
  refreshControls();
  try {
    const response = await fetch("./api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        sessionId: sentInChallenge ? exceptionSession : sessionId,
        lesson: sentInChallenge ? { exceptionChoice, exceptionReason, stage: "exception" }
          : { ...plantValues(), stage: stages[sentAt][0] },
        attachments: sentInChallenge ? [] : attachments,
      }),
    });
    const body = await response.json();
    if (!response.ok || !body.textResponse) {
      throw new Error(response.status === 503 ? "AI 연결을 확인해 주세요. 관찰과 기록은 계속할 수 있어요."
        : body.error || "답변을 받지 못했어요. 다시 보내 주세요.");
    }
    turns.push({ text: body.textResponse, files: body.files, praise: isPraise(body.textResponse) });
    if (stillVisible()) $("chat-status").textContent = "";
  } catch (error) {
    turns.pop();
    if (stillVisible()) {
      $("chat-input").value ||= existingInput || message;
      $("chat-status").textContent = error instanceof SyntaxError || error instanceof TypeError
        ? "AI 연결을 확인해 주세요. 관찰과 기록은 계속할 수 있어요." : error.message;
    }
  } finally {
    busy = false;
    pendingTurns = null;
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
    const status = $(kind === "exception" ? "exception-status" : "lab-status");
    if (kind && !hasCaseReason(kind)) {
      status.textContent = "먼저 나의 추측과 그 근거를 적어 주세요.";
      return;
    }
    status.textContent = "";
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
    summary.textContent = (values.specimen || "이름을 적지 않은 표본") + " · " + date + " · " + conclusionLabel(values.conclusion);
    entry.append(summary);
    if (Array.isArray(record.photos) && record.photos.length) {
      const gallery = document.createElement("div");
      gallery.className = "journal-photos";
      for (const photo of record.photos) {
        if (!imageTypes.has(photo.mime) || !photo.contentString?.startsWith("data:" + photo.mime + ";base64,")) continue;
        const image = document.createElement("img");
        image.src = photo.contentString;
        image.alt = photo.name || "관찰한 식물 사진";
        image.loading = "lazy";
        gallery.append(image);
      }
      entry.append(gallery);
    }
    const recordFields = [
      ...evidence, ["hypothesis", "첫 추측"], ["reason", "첫 근거"], ["revision", "검토 후 생각"],
      ["exceptionChoice", "예외 사례 추론"], ["exceptionReason", "예외 사례 근거"],
      ["conclusion", "최종 결론"], ["conclusionReason", "최종 근거"], ["transferChoice", "새 식물 추측"],
      ["transferReason", "새 식물 근거"], ["nextQuestion", "더 알아보고 싶은 질문"],
    ];
    for (const [key, label] of recordFields) {
      if (!values[key]) continue;
      const p = document.createElement("p");
      p.textContent = label + " · " + (key === "conclusion" ? conclusionLabel(values[key]) : values[key]);
      entry.append(p);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-button";
    remove.textContent = "이 기록 삭제";
    remove.addEventListener("click", async () => {
      if (!window.confirm("도감에서 이 기록을 삭제할까요?")) return;
      remove.disabled = true;
      try {
        await journalRequest("readwrite", (store) => store.delete(record.id));
      } catch {
        remove.disabled = false;
        $("journal-status").textContent = "기록을 삭제하지 못했어요.";
        return;
      }
      records = records.filter((item) => item.id !== record.id);
      $("journal-status").textContent = "도감에서 기록을 삭제했어요.";
      renderJournal();
    });
    entry.append(remove);
    list.append(entry);
  }
}

async function saveRecord() {
  saving = true;
  refreshControls();
  try {
    const previous = records.find((record) => record.id === recordId);
    const { exceptionChoice, exceptionReason } = previous?.values || {};
    const values = { ...plantValues() };
    if (exceptionChoice) values.exceptionChoice = exceptionChoice;
    if (exceptionReason) values.exceptionReason = exceptionReason;
    const photos = attachments.filter((item) => imageTypes.has(item.mime));
    const savedRecord = { id: recordId, values, photos, savedAt: Date.now() };
    await journalRequest("readwrite", (store) => store.put(savedRecord));
    records = [savedRecord, ...records.filter((record) => record.id !== recordId)];
    photosChanged = false;
    if (location.hash === "#journal") renderJournal();
    return true;
  } catch {
    $("lab-status").textContent = "브라우저에 기록을 저장하지 못했어요. 저장 공간 설정을 확인해 주세요.";
    return false;
  } finally {
    saving = false;
    refreshControls();
  }
}

$("save-record").addEventListener("click", async () => {
  if (reading || saving) return;
  for (let index = 0; index < stages.length; index += 1) {
    const issue = validateStep(index);
    if (issue) {
      showStep(index, true);
      $("lab-status").textContent = issue;
      return;
    }
  }
  if (await saveRecord()) location.hash = "journal";
});

$("new-record").addEventListener("click", () => {
  const previous = records.find((record) => record.id === recordId);
  const changed = photosChanged || Object.keys(plantValues()).some((key) => fieldValue(key) !== (previous?.values?.[key]?.trim() || ""));
  if (changed && !window.confirm("저장하지 않은 탐구 내용을 비우고 새로 시작할까요?")) return;
  for (const key of Object.keys(plantValues())) delete draft[key];
  recordId = crypto.randomUUID();
  sessionId = crypto.randomUUID();
  attachments = [];
  photosChanged = false;
  conversations.forEach((turns) => { turns.length = 0; });
  $("chat-input").value = "";
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
const openedRecord = recordId;
journalRequest("readonly", (store) => store.getAll()).then((entries) => {
  records = entries.sort((a, b) => b.savedAt - a.savedAt);
  const previous = records.find((record) => record.id === recordId);
  if (recordId === openedRecord && !photosChanged && Array.isArray(previous?.photos)) {
    attachments = [...previous.photos, ...attachments.filter((item) => !imageTypes.has(item.mime))];
    renderAttachments();
  }
  $("view-record").hidden = stages[stage][0] !== "transfer" || !previous;
  if (location.hash === "#journal") renderJournal();
}).catch(() => {
  $("journal-status").textContent = "브라우저에서 도감 저장 공간을 열지 못했어요.";
});
checkConnection();
