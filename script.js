"use strict";

const $ = (id) => document.getElementById(id);
const evidence = [
  ["cotyledons", "떡잎", "떡잎의 수와 특징", "예: 싹에서 2개가 보임"],
  ["veins", "잎", "잎맥과 잎의 특징", "예: 잎이 길고 잎맥이 나란함"],
  ["flowers", "꽃", "꽃의 특징", "예: 꽃잎처럼 보이는 조각 6개"],
  ["roots", "뿌리", "뿌리의 특징", "예: 비슷한 굵기의 뿌리가 여러 개"],
  ["bundles", "줄기", "줄기 관다발의 특징", "예: 단면 가장자리에 고리 모양"],
];
const organNames = new Map(evidence.map(([key, name]) => [key, name]));
const classifications = ["", "외떡잎식물로 추정", "쌍떡잎식물로 추정", "판단 보류"];
const views = { home: "탐구 홈", lab: "탐구학습", additional: "추가학습", guide: "개념학습", journal: "나의 탐구 도감", sources: "참고 자료" };
const modeNames = { field: "현장 모드", desk: "책상 앞 모드" };
const modeBanners = {
  field: "📸 현장 모드: 실제 식물을 마주 보고 있어요! 먼저 식물 사진을 1장 이상 찍어 올려야 탐구가 시작됩니다.",
  desk: "📚 책상 앞 모드: 사진이 있어도, 없어도 괜찮아요! 관찰한 특징이나 실험·교과서 내용을 바탕으로 바로 탐구해 보세요.",
};
const photoGateMessage = "현장 모드에서는 관찰할 식물 사진을 먼저 1장 이상 올려야 다음으로 넘어갈 수 있어요!";
const modeHints = {
  field: "식물을 직접 살펴보자. 잎맥은 나란히 뻗어 있니, 그물처럼 이어져 있니?",
  desk: "사진이나 교과서, 네가 적은 관찰 내용으로 탐구할 수 있어. 잎맥은 어떤 모양이었어?",
};
const offlineHints = {
  field: {
    "잎맥이 나란히 나 있어요": "잎을 조금 가까이에서 볼 수 있다면, 잎맥이 끝까지 나란히 뻗어 있니?",
    "그물처럼 얽혀 있어요": "가지처럼 갈라진 잎맥들이 서로 연결되는지 눈으로 확인해 볼래?",
    "꽃잎 수를 세어봤어요": "꽃 한 송이에서 꽃잎이 몇 장 보였어?",
  },
  desk: {
    "잎맥이 나란히 나 있어요": "주어진 자료에서 나란히 보이는 잎맥은 어떤 분류를 뒷받침할까?",
    "그물처럼 얽혀 있어요": "자료에서 확인한 그물 모양을 근거로 어느 쪽을 추측할 수 있을까?",
    "꽃잎 수를 세어봤어요": "주어진 자료에서 확인한 꽃잎 수를 분류 기준과 어떻게 연결할 수 있을까?",
  },
};


const draftKey = "plant-observation-lesson-draft-v1";
const journalKey = "plant-observation-lesson-records-v1";
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"]);
const documentTypes = /\.(txt|md|csv|pdf|docx?|pptx?|xlsx?)$/i;
const maxFileBytes = 13 * 1024 * 1024;
const maxTotalBytes = 22 * 1024 * 1024;
const additionalKeys = new Set(["exceptionChoice", "exceptionReason", "transferChoice", "transferReason", "nextQuestion"]);

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

function openStorage(name, storeName, initialRecords = []) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, { keyPath: "id" });
      for (const record of initialRecords) {
        if (typeof record?.id === "string") store.put(record);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("도감을 열 수 없어요."));
  });
}

async function journalRequest(mode, action, storeName = "records") {
  const database = await (storeName === "records" ? journalDatabase : photoDraftDatabase);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

const saved = readStorage(draftKey, {});
const draft = saved.draft && typeof saved.draft === "object" ? saved.draft : {};
for (const [key] of evidence) {
  const status = draft[key + "Status"];
  const observation = draft[key];
  if (typeof status === "string" && status && !(typeof observation === "string" && observation.trim())) draft[key] = status;
  delete draft[key + "Status"];
}
const storedRecords = readStorage(journalKey, []);
let records = Array.isArray(storedRecords) ? storedRecords : [];
const journalDatabase = openStorage("plant-observation-journal", "records", records);
const photoDraftDatabase = openStorage("plant-observation-draft-photos", "draftPhotos");
let recordId = typeof saved.id === "string" ? saved.id : crypto.randomUUID();
let lastSavedId = typeof saved.lastSavedId === "string" ? saved.lastSavedId : "";
let learningMode = Object.hasOwn(modeNames, saved.mode) ? saved.mode : "";
let busy = false;
let pendingChat = null;
let reading = true;
let saving = false;
let connectionState = "pending";
let photos = {};
let documents = [];
let photosChanged = false;
let currentView = "home";
const chats = new Map();
const photoControls = new Map();

for (const [key, organ, label, example] of evidence) {
  const card = document.createElement("fieldset");
  card.className = "organ-card";
  card.innerHTML = `<legend>${organ}</legend>
    ${key === "flowers" ? '<label class="field">꽃잎 수 <input data-field="petalCount" maxlength="24" placeholder="예: 6장"></label>' : ""}
    <label class="field">${label}<input data-field="${key}" maxlength="160" placeholder="${example}"></label>
    <img class="organ-preview" alt="${organ} 사진 미리보기" hidden>
    <div class="organ-actions">
      <label class="secondary organ-upload"><span aria-hidden="true">＋</span><span class="organ-upload-text">사진 추가</span>
        <input class="sr-only" type="file" aria-label="${organ} 사진 추가" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp">
      </label>
      <button class="text-button organ-remove" type="button" aria-label="${organ} 사진 삭제" hidden>삭제</button>
    </div>
    <p class="feedback organ-status" role="status"></p>`;
  const controls = {
    card,
    input: card.querySelector('[type="file"]'),
    preview: card.querySelector("img"),
    label: card.querySelector(".organ-upload-text"),
    remove: card.querySelector(".organ-remove"),
    status: card.querySelector(".organ-status"),
  };
  photoControls.set(key, controls);
  controls.input.addEventListener("change", () => changePhoto(key, controls.input.files[0]));
  controls.remove.addEventListener("click", () => changePhoto(key, null));
  $("evidence-fields").append(card);
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
  return orderPlantValues(Object.fromEntries(Object.entries(draft).filter(([key]) => !additionalKeys.has(key))));
}
function orderPlantValues(values) {
  const ordered = ["specimen", ...evidence.flatMap(([key]) => key === "flowers" ? ["petalCount", key, key + "Status"] : [key, key + "Status"])];
  const keys = new Set([...ordered, ...Object.keys(values)]);
  return Object.fromEntries([...keys].filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]));
}
function hydrateFields() {
  for (const field of fields) field.value = fieldValue(field.dataset.field);
}
function rememberDraft() {
  writeStorage(draftKey, { id: recordId, lastSavedId, mode: learningMode, draft });
}
for (const field of fields) {
  field.addEventListener("input", () => {
    draft[field.dataset.field] = field.value;
    rememberDraft();
  });
}

function activeChat() {
  const key = learningMode;
  if (!chats.has(key)) chats.set(key, { id: crypto.randomUUID(), turns: [] });
  return chats.get(key);
}

function renderView() {
  const hash = location.hash.slice(1);
  const legacy = { observe: "lab", challenge: "additional" };
  const target = Object.hasOwn(legacy, hash) ? legacy[hash] : hash;
  const view = Object.hasOwn(views, target) ? target : "home";
  if (view !== currentView) {
    $("chat-status").textContent = "";
    $("chat-input").value = "";
  }
  currentView = view;
  for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== view;
  for (const link of document.querySelectorAll(".sidebar nav a")) {
    if (link.hash === "#" + view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  $("breadcrumb").textContent = views[view];
  if (view === "journal") renderJournal();
  window.scrollTo(0, 0);
}

function renderPhotos() {
  for (const [key, controls] of photoControls) {
    const photo = photos[key];
    controls.preview.hidden = !photo;
    controls.remove.hidden = !photo;
    controls.label.textContent = photo ? "사진 변경" : "사진 추가";
    controls.input.setAttribute("aria-label", organNames.get(key) + (photo ? " 사진 변경" : " 사진 추가"));
    if (photo) controls.preview.src = photo.contentString;
    else controls.preview.removeAttribute("src");
  }
  renderPhotoGate();
  renderChat();
}

function fieldNeedsPhoto() {
  return learningMode === "field" && !Object.keys(photos).length;
}

function renderPhotoGate() {
  const locked = fieldNeedsPhoto();
  $("photo-gate").hidden = !locked;
  $("photo-gate-message").textContent = locked ? photoGateMessage : "";
  $("chat-input").readOnly = locked;
  $("chat-input").placeholder = locked ? "식물 사진을 올리면 질문을 적을 수 있어요." : "관찰한 점이나 궁금한 점을 적어 보세요.";
  if (locked) $("chat-input").setAttribute("aria-describedby", "photo-gate-message");
  else $("chat-input").removeAttribute("aria-describedby");
  for (const button of document.querySelectorAll("[data-coach], #chat-form button, #review-hypothesis, #save-record")) {
    if (locked) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  }
  if (!locked) {
    for (const id of ["hypothesis-status", "lab-status"]) {
      if ($(id).textContent === photoGateMessage) $(id).textContent = "";
    }
  }
  $("lab-grid").querySelector(".learning-workspace").toggleAttribute("data-photo-required", locked);
}

function blockWithoutFieldPhoto(status) {
  if (!fieldNeedsPhoto()) return false;
  if (status === "photo-gate-message") $("photo-gate").focus();
  else $(status).textContent = photoGateMessage;
  return true;
}

$("chat-content").addEventListener("click", (event) => {
  if (event.target.closest("#chat-log, #chat-input")) blockWithoutFieldPhoto("photo-gate-message");
});
$("chat-input").addEventListener("keydown", (event) => {
  if ((event.key.length === 1 || event.key === "Enter") && blockWithoutFieldPhoto("photo-gate-message")) {
    event.preventDefault();
  }
});
$("find-photo-upload").addEventListener("click", () => photoControls.values().next().value.input.focus());

function attachmentBytes(items) {
  return items.reduce((size, item) => size + item.size, 0);
}

async function changePhoto(key, file) {
  const controls = photoControls.get(key);
  controls.input.value = "";
  if (file === undefined || reading || saving || busy) return;
  if (file && (!imageTypes.has(file.type) || !file.size || file.size > maxFileBytes ||
      attachmentBytes([...Object.values(photos), ...documents]) - (photos[key]?.size || 0) + file.size > maxTotalBytes ||
      !photos[key] && Object.keys(photos).length + documents.length >= 10)) {
    controls.status.textContent = "지원되는 이미지와 파일 크기(한 장 13 MB, 전체 22 MB), 개수(전체 10개)를 확인해 주세요.";
    return;
  }
  reading = true;
  refreshControls();
  try {
    if (file) photos[key] = { ...await readAttachment(file), organ: key };
    else delete photos[key];
    photosChanged = true;
    rememberDraft();
    renderPhotos();
    const status = file ? "사진을 추가했어요." : "사진을 삭제했어요.";
    try {
      await journalRequest("readwrite", (store) => store.put({ id: recordId, photos }), "draftPhotos");
      controls.status.textContent = status;
    } catch {
      controls.status.textContent = status + " 페이지를 닫기 전에 결론을 저장해 주세요.";
    }
  } catch {
    controls.status.textContent = "사진을 읽지 못했어요. 다시 선택해 주세요.";
  } finally {
    reading = false;
    refreshControls();
  }
}

function renderDocuments() {
  const list = $("document-list");
  list.replaceChildren();
  for (const [index, item] of documents.entries()) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button";
    button.textContent = "제거";
    button.setAttribute("aria-label", item.name + " 제거");
    button.addEventListener("click", () => {
      if (busy || reading || saving) return;
      documents.splice(index, 1);
      renderDocuments();
    });
    li.append(item.name, button);
    list.append(li);
  }
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
  for (const button of document.querySelectorAll(".coach-action, #chat-form button, [data-new-record], #reset-observations, #reset-chat, #save-record")) {
    button.disabled = disabled;
  }
  for (const field of fields) field.disabled = saving;
  for (const radio of document.querySelectorAll('[name="learning-mode"]')) radio.disabled = busy;
  for (const { input, remove } of photoControls.values()) input.disabled = remove.disabled = disabled;
  $("documents").disabled = disabled;
}

$("documents").addEventListener("change", async (event) => {
  const selected = [...event.target.files];
  event.target.value = "";
  if (!selected.length || reading || saving || busy) return;
  reading = true;
  refreshControls();
  let skipped = false;
  try {
    const images = Object.values(photos);
    for (const file of selected) {
      if (!documentTypes.test(file.name) || !file.size || file.size > maxFileBytes ||
          attachmentBytes([...images, ...documents]) + file.size > maxTotalBytes || images.length + documents.length >= 10) {
        skipped = true;
        continue;
      }
      try { documents.push(await readAttachment(file)); }
      catch { skipped = true; }
    }
    renderDocuments();
    $("chat-status").textContent = skipped
      ? "일부 문서를 추가하지 못했어요. 파일 형식, 크기와 개수를 확인해 주세요."
      : "문서를 추가했어요.";
  } finally {
    reading = false;
    refreshControls();
  }
});

function renderMode() {
  $("mode-indicator").textContent = modeNames[learningMode] || "학습 모드 선택 전";
  const banner = $("mode-banner");
  banner.hidden = !learningMode;
  banner.textContent = modeBanners[learningMode] || "";
  banner.dataset.mode = learningMode;
  $("chat-content").hidden = !learningMode;
  for (const radio of document.querySelectorAll('[name="learning-mode"]')) radio.checked = radio.value === learningMode;
  renderPhotoGate();
  renderChat();
  renderChatNote();
}

$("mode-picker").addEventListener("change", (event) => {
  learningMode = event.target.value;
  $("chat-status").textContent = "";
  $("chat-input").value = "";
  rememberDraft();
  renderMode();
});
$("go-to-coach").addEventListener("click", focusMode);

$("review-hypothesis").addEventListener("click", () => {
  if (busy || reading || saving) return;
  const status = $("hypothesis-status");
  if (blockWithoutFieldPhoto("hypothesis-status")) return;
  const missing = !fieldValue("hypothesis") ? "hypothesis" : !fieldValue("reason") ? "reason" : "";
  if (missing) {
    status.textContent = "첫 추측을 선택하고 그렇게 생각한 근거를 적어 주세요.";
    fields.find((field) => field.dataset.field === missing).focus();
    return;
  }
  if (!learningMode) {
    status.textContent = "AI 학습 모드를 선택한 뒤 가설 검토를 요청해 주세요.";
    focusMode();
    return;
  }
  status.textContent = "";
  $("chat-input").focus({ preventScroll: true });
  send("작성한 분류 가설과 근거를 검토해 줘.", true);
});

$("reset-chat").addEventListener("click", () => {
  if (!learningMode || busy || reading || saving) return;
  chats.clear();
  $("chat-input").value = "";
  renderChat();
  $("chat-status").textContent = "대화를 초기화했어요.";
  $("chat-input").focus();
});
function focusMode() {
  const choice = $("mode-picker").querySelector("input:checked") || $("mode-picker").querySelector("input");
  choice.focus();
}


function isPraise(text) {
  return /잘했(?:어|다|네)|잘\s*(?:봤|찾았|찾아냈|짚었|골랐|관찰했|설명했|정리했|적었|생각했|비교했|구분했|분류했)|훌륭해|멋져|(?:정확히|정확하게)\s*(?:봤|찾았|찾아냈|짚었|관찰했|구분했|분류했)|핵심을\s*(?:딱\s*)?짚었|(?:관찰|추론|설명|근거|판단)(?:이|가)\s*(?:아주\s*|정말\s*)?(?:정확|좋|훌륭|탄탄)|(?:^|[.!?\n]\s*)(?:좋아|좋아요|맞아|맞아요|정답이야|정답이에요)[!！]/u.test(text);
}

function renderChat() {
  const log = $("chat-log");
  const chat = learningMode ? activeChat() : null;
  const turns = chat?.turns || [];
  const expression = chat && chat === pendingChat ? "thinking" : turns.at(-1)?.praise ? "praise" : "ready";
  for (const avatar of $("lesson-coach").querySelectorAll("[data-expression]")) {
    avatar.hidden = avatar.dataset.expression !== expression;
  }
  log.replaceChildren();
  if (!chat) return;
  const entries = [...(fieldNeedsPhoto() ? [] : [{ text: modeHints[learningMode] }]), ...turns];
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
    : "보내기를 누르면 질문과 탐구 기록, 선택한 사진·문서가 AnythingLLM에 전달돼요.";
}

async function send(message, reviewRequested = false) {
  if (!message || busy || reading || saving || blockWithoutFieldPhoto("photo-gate-message")) return;
  if (!learningMode) {
    focusMode();
    return;
  }
  if (connectionState === "pending") {
    $("chat-status").textContent = "AI 연결을 확인하고 있어요. 잠시 뒤 다시 눌러 주세요.";
    return;
  }
  const chat = activeChat();
  const { turns } = chat;
  const stillVisible = () => currentView === "lab" && activeChat() === chat;
  const attachments = [
    ...evidence.filter(([key]) => photos[key]).map(([key, organ]) => ({ ...photos[key], name: organ + "-" + photos[key].name })),
    ...documents,
  ];
  const existingInput = $("chat-input").value;
  const turn = { text: message, mine: true };
  turns.push(turn);
  $("chat-input").value = "";
  if (connectionState === "offline") {
    const hint = offlineHints[learningMode][message] || modeHints[learningMode];
    turns.push({ text: "기기 내 탐구 힌트 · " + hint });
    $("chat-status").textContent = "";
    renderChat();
    return;
  }
  busy = true;
  pendingChat = chat;
  renderChat();
  $("chat-status").textContent = "떡구전이 답변을 준비하고 있어요…";
  refreshControls();
  try {
    const response = await fetch("./api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        sessionId: chat.id,
        lesson: { ...plantValues(), stage: "learn", learningMode, reviewRequested },
        attachments,
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
    pendingChat = null;
    refreshControls();
    renderChat();
  }
}

$("chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (blockWithoutFieldPhoto("photo-gate-message")) return;
  const message = $("chat-input").value.trim();
  if (!message) {
    $("chat-status").textContent = "먼저 질문이나 관찰 내용을 적어 주세요.";
    $("chat-input").focus();
    return;
  }
  send(message);
});
for (const button of document.querySelectorAll("[data-coach]")) {
  button.addEventListener("click", () => send(button.dataset.coach));
}

function journalCounts(entries) {
  let monocots = 0;
  let eudicots = 0;
  for (const { values } of entries) {
    const group = values?.conclusion?.trim() || values?.hypothesis?.trim() || "";
    if (/^외떡잎/.test(group)) monocots += 1;
    else if (/^(?:진정\s*)?쌍떡잎/.test(group)) eudicots += 1;
  }
  return { monocots, eudicots };
}

function renderJournal() {
  const list = $("journal-list");
  list.replaceChildren();
  const { monocots, eudicots } = journalCounts(records);
  $("journal-total").textContent = String(records.length);
  $("journal-monocots").textContent = String(monocots);
  $("journal-eudicots").textContent = String(eudicots);
  $("journal-empty").hidden = records.length > 0;
  $("journal-actions").hidden = !records.length;
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
        image.alt = organNames.has(photo.organ) ? organNames.get(photo.organ) + " 사진" : photo.name || "관찰한 식물 사진";
        image.loading = "lazy";
        gallery.append(image);
      }
      entry.append(gallery);
    }
    const recordFields = [
      ...evidence.flatMap(([key, organ, label]) => [
        ...(key === "flowers" ? [["petalCount", "꽃잎 수"]] : []), [key, label], [key + "Status", organ + " 관찰 상태"],
      ]),
      ["hypothesis", "첫 추측"], ["reason", "첫 근거"], ["revision", "검토 후 생각"],
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
      if (lastSavedId === record.id) {
        lastSavedId = "";
        rememberDraft();
      }
      $("view-record").hidden = !journalRecord();
      $("journal-status").textContent = "도감에서 기록을 삭제했어요.";
      renderJournal();
    });
    entry.append(remove);
    list.append(entry);
  }
}

function journalRecord() {
  return records.find((record) => record.id === recordId) || records.find((record) => record.id === lastSavedId);
}

async function saveRecord() {
  saving = true;
  refreshControls();
  try {
    const previous = records.find((record) => record.id === recordId);
    const values = orderPlantValues({ ...previous?.values, ...plantValues() });
    const legacyPhotos = (previous?.photos || []).filter((photo) => !organNames.has(photo.organ));
    const organPhotos = evidence.map(([key]) => photos[key]).filter(Boolean);
    const savedRecord = { id: recordId, values, photos: [...organPhotos, ...legacyPhotos], savedAt: Date.now() };
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
  if (busy || reading || saving) return;
  const status = $("lab-status");
  if (blockWithoutFieldPhoto("lab-status")) return;
  const conclusion = fieldValue("conclusion");
  if (!conclusion || !fieldValue("conclusionReason")) {
    status.textContent = "분류 결론과 판단 근거를 적어 주세요.";
    return;
  }
  const observed = [...organNames.keys(), "petalCount"].some((key) =>
    !/^(?:확인\s*못함|관찰\s*못함|모름|없음|관찰할\s*수\s*없음|확인하기\s*어려움)?$/.test(fieldValue(key)));
  if (!observed && conclusion !== "판단 보류") {
    status.textContent = "확인한 특징을 하나 이상 적거나, 단서가 부족하면 판단 보류를 선택해 주세요.";
    return;
  }
  if (await saveRecord()) {
    resetCurrentRecord(true, recordId);
    status.textContent = "나의 탐구 도감에 저장했어요. 새 탐구를 시작할 수 있어요.";
  }
});


function resetCurrentRecord(resetAll, savedId = "") {
  const oldId = recordId;
  for (const key of Object.keys(draft)) delete draft[key];
  recordId = crypto.randomUUID();
  lastSavedId = savedId;
  photos = {};
  photosChanged = false;
  if (resetAll) {
    learningMode = "";
    documents = [];
    chats.clear();
    $("chat-input").value = "";
    $("chat-status").textContent = "";
    renderDocuments();
    renderMode();
  }
  $("lab-status").textContent = "";
  $("hypothesis-status").textContent = "";
  $("observation-status").textContent = "";
  $("view-record").hidden = !savedId;
  for (const controls of photoControls.values()) controls.status.textContent = "";
  hydrateFields();
  rememberDraft();
  renderPhotos();
  journalRequest("readwrite", (store) => store.delete(oldId), "draftPhotos").catch(() => {});
}

$("reset-observations").addEventListener("click", () => {
  if (busy || reading || saving) return;
  const hasRecord = Object.keys(plantValues()).some((key) => fieldValue(key)) || Object.keys(photos).length;
  if (hasRecord && !window.confirm("현재 탐구의 사진과 입력한 기록을 모두 지울까요?")) return;
  resetCurrentRecord(false, journalRecord()?.id);
  $("observation-status").textContent = "현재 탐구의 사진과 입력한 기록을 비웠어요.";
});

for (const button of document.querySelectorAll("[data-new-record]")) {
  button.addEventListener("click", () => {
    if (busy || reading || saving) return;
    const previous = journalRecord();
    const changed = photosChanged || Object.keys(plantValues()).some((key) => fieldValue(key) !== (previous?.values?.[key]?.trim() || ""));
    const hasChat = [...chats.values()].some(({ turns }) => turns.length);
    if ((changed || hasChat) && !window.confirm("현재 탐구의 사진, 기록과 대화를 비우고 새로 시작할까요?")) return;
    resetCurrentRecord(true);
    if (currentView === "lab") $("lab-title").focus();
    else location.hash = "lab";
  });
}

window.addEventListener("hashchange", renderView);
hydrateFields();
renderMode();
renderView();
refreshControls();
Promise.all([
  journalRequest("readonly", (store) => store.getAll()),
  journalRequest("readonly", (store) => store.get(recordId), "draftPhotos").catch(() => null),
]).then(([entries, photoDraft]) => {
  records = entries.sort((a, b) => b.savedAt - a.savedAt);
  const previous = records.find((record) => record.id === recordId);
  const savedPhotos = Object.fromEntries((previous?.photos || []).filter((photo) => organNames.has(photo.organ)).map((photo) => [photo.organ, photo]));
  photos = photoDraft?.photos || savedPhotos;
  photosChanged = evidence.some(([key]) => photos[key]?.contentString !== savedPhotos[key]?.contentString ||
    photos[key]?.name !== savedPhotos[key]?.name);
  renderPhotos();
  $("view-record").hidden = !journalRecord();
  if (location.hash === "#journal") renderJournal();
}).catch(() => {
  $("journal-status").textContent = "브라우저에서 도감 저장 공간을 열지 못했어요.";
}).finally(() => {
  reading = false;
  refreshControls();
});


checkConnection();
