"use strict";

const $ = (id) => document.getElementById(id);
const evidence = [
  ["roots", "뿌리", "뿌리의 특징", "예: 비슷한 굵기의 뿌리가 여러 개"],
  ["veins", "잎", "잎맥과 잎의 특징", "예: 잎이 길고 잎맥이 나란함"],
  ["flowers", "꽃", "꽃의 특징", "예: 꽃잎처럼 보이는 조각 6개"],
  ["bundles", "줄기", "줄기 관다발의 특징", "예: 단면 가장자리에 고리 모양"],
  ["cotyledons", "떡잎", "떡잎의 수와 특징", "예: 싹에서 2개가 보임"],
];
const organNames = new Map(evidence.map(([key, name]) => [key, name]));
const classifications = ["", "외떡잎식물로 추정", "쌍떡잎식물로 추정", "판단 보류"];
const views = { home: "탐구 홈", lab: "학습", additional: "추가학습", guide: "개념 학습", journal: "나의 탐구 도감", sources: "참고 자료" };
const modeNames = { field: "현장 모드", desk: "책상 앞 모드" };
const modeHints = {
  field: "식물을 직접 살펴보자. 지금 가장 또렷하게 보이는 특징은 뭐야?",
  desk: "이미 받은 사진이나 자료를 함께 살펴보자. 먼저 확인할 수 있는 특징 하나가 뭐야?",
};
const extraHints = {
  exception: "표본 B의 두 단서가 같은 방향을 가리키니?",
  transfer: "표본 C에서 네 추측을 가장 잘 뒷받침하는 단서는 뭐야?",
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
  const { exceptionChoice, exceptionReason, transferChoice, transferReason, nextQuestion, ...values } = draft;
  return values;
}
function additionalValues() {
  return Object.fromEntries(["exceptionChoice", "exceptionReason", "transferChoice", "transferReason", "nextQuestion"]
    .filter((key) => fieldValue(key)).map((key) => [key, fieldValue(key)]));
}
function hydrateFields() {
  for (const field of fields) field.value = fieldValue(field.dataset.field);
}
function rememberDraft() {
  writeStorage(draftKey, { id: recordId, mode: learningMode, draft });
}
for (const field of fields) {
  field.addEventListener("input", () => {
    draft[field.dataset.field] = field.value;
    rememberDraft();
  });
}

function chatActivity() {
  return currentView === "additional" ? $("extra-activity").value : "learn";
}

function activeChat() {
  const key = learningMode + ":" + chatActivity();
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
  if (view === "lab" || view === "additional") {
    $(view === "additional" ? "challenge-lab" : "lab-grid").append($("lesson-coach"));
    $("extra-topic").hidden = view !== "additional" || !learningMode;
    renderChat();
    renderChatNote();
  }
  for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== view;
  for (const link of document.querySelectorAll(".sidebar nav a")) {
    if (link.hash === "#" + view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  $("breadcrumb").textContent = views[view];
  if (view === "journal") renderJournal();
  window.scrollTo(0, 0);
}

function hasCaseReason(kind) {
  return Boolean(fieldValue(kind + "Choice") && fieldValue(kind + "Reason"));
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
}

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
  for (const button of document.querySelectorAll(".coach-action, #chat-form button, #new-record")) {
    button.disabled = disabled;
  }
  for (const radio of document.querySelectorAll('[name="learning-mode"]')) radio.disabled = busy;
  for (const { input, remove } of photoControls.values()) input.disabled = remove.disabled = disabled;
  $("documents").disabled = disabled;
  $("save-record").disabled = reading || saving;
  $("save-additional").disabled = reading || saving;
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
  $("chat-content").hidden = !learningMode;
  $("extra-topic").hidden = currentView !== "additional" || !learningMode;
  for (const radio of document.querySelectorAll('[name="learning-mode"]')) radio.checked = radio.value === learningMode;
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
$("extra-activity").addEventListener("change", () => {
  $("chat-status").textContent = "";
  $("chat-input").value = "";
  renderChat();
});
$("go-to-coach").addEventListener("click", focusMode);
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
  const entries = [{ text: extraHints[chatActivity()] || modeHints[learningMode] }, ...turns];
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
    : currentView === "additional" ? "보내기를 누르면 선택한 활동의 추론과 질문이 AnythingLLM에 전달돼요."
    : "보내기를 누르면 질문과 탐구 기록, 선택한 사진·문서가 AnythingLLM에 전달돼요.";
}

async function send(message) {
  if (!message || busy || reading) return;
  if (!learningMode) {
    focusMode();
    return;
  }
  if (connectionState === "pending") {
    $("chat-status").textContent = "AI 연결을 확인하고 있어요. 잠시 뒤 다시 눌러 주세요.";
    return;
  }
  const activity = chatActivity();
  const chat = activeChat();
  const { turns } = chat;
  const stillVisible = () => (currentView === "lab" || currentView === "additional") && activeChat() === chat;
  const lesson = activity === "learn" ? plantValues()
    : Object.fromEntries([activity + "Choice", activity + "Reason"].map((key) => [key, fieldValue(key)]));
  const attachments = activity === "learn" ? [
    ...Object.entries(photos).map(([key, photo]) => ({ ...photo, name: organNames.get(key) + "-" + photo.name })),
    ...documents,
  ] : [];
  const existingInput = $("chat-input").value;
  const turn = { text: message, mine: true };
  turns.push(turn);
  $("chat-input").value = "";
  if (connectionState === "offline") {
    const hint = extraHints[activity] || offlineHints[learningMode][message] || modeHints[learningMode];
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
        lesson: { ...lesson, stage: activity, learningMode },
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
    const status = $(kind ? kind + "-status" : "lab-status");
    if (kind && !hasCaseReason(kind)) {
      status.textContent = "먼저 나의 추측과 그 근거를 적어 주세요.";
      return;
    }
    status.textContent = "";
    if (button.dataset.reveal) $(kind + "-explanation").hidden = false;
    else {
      if (kind) $("extra-activity").value = kind;
      send(button.dataset.coach);
    }
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
        image.alt = organNames.has(photo.organ) ? organNames.get(photo.organ) + " 사진" : photo.name || "관찰한 식물 사진";
        image.loading = "lazy";
        gallery.append(image);
      }
      entry.append(gallery);
    }
    const recordFields = [
      ...evidence.flatMap(([key, organ, label]) => [[key, label], [key + "Status", organ + " 관찰 상태"]]),
      ["petalCount", "꽃잎 수"], ["hypothesis", "첫 추측"], ["reason", "첫 근거"], ["revision", "검토 후 생각"],
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

async function saveRecord(additionalOnly = false) {
  saving = true;
  refreshControls();
  try {
    const previous = records.find((record) => record.id === recordId);
    const values = { ...previous?.values, ...(additionalOnly ? {} : plantValues()), ...additionalValues() };
    const legacyPhotos = (previous?.photos || []).filter((photo) => !organNames.has(photo.organ));
    const savedPhotos = additionalOnly ? previous.photos : [...legacyPhotos, ...Object.values(photos)];
    const savedRecord = { id: recordId, values, photos: savedPhotos, savedAt: Date.now() };
    await journalRequest("readwrite", (store) => store.put(savedRecord));
    records = [savedRecord, ...records.filter((record) => record.id !== recordId)];
    if (!additionalOnly) photosChanged = false;
    if (location.hash === "#journal") renderJournal();
    return true;
  } catch {
    $(additionalOnly ? "additional-status" : "lab-status").textContent = "브라우저에 기록을 저장하지 못했어요. 저장 공간 설정을 확인해 주세요.";
    return false;
  } finally {
    saving = false;
    refreshControls();
  }
}

$("save-record").addEventListener("click", async () => {
  if (reading || saving) return;
  const status = $("lab-status");
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
    $("view-record").hidden = false;
    status.textContent = "나의 탐구 도감에 저장했어요.";
  }
});


$("save-additional").addEventListener("click", async () => {
  if (reading || saving) return;
  const status = $("additional-status");
  if (!Object.keys(additionalValues()).length) {
    status.textContent = "추가학습에서 생각한 내용을 먼저 적어 주세요.";
    return;
  }
  if (!records.some((record) => record.id === recordId)) {
    status.textContent = "초안을 저장했어요. 본 학습의 결론을 저장하면 도감에서도 볼 수 있어요.";
    return;
  }
  if (await saveRecord(true)) status.textContent = "추가학습 기록을 나의 탐구 도감에 저장했어요.";
});

$("new-record").addEventListener("click", () => {
  const previous = records.find((record) => record.id === recordId);
  const changed = photosChanged || Object.keys(draft).some((key) => fieldValue(key) !== (previous?.values?.[key]?.trim() || ""));
  if (changed && !window.confirm("저장하지 않은 탐구 내용을 비우고 새로 시작할까요?")) return;
  const oldId = recordId;
  for (const key of Object.keys(draft)) delete draft[key];
  recordId = crypto.randomUUID();
  learningMode = "";
  photos = {};
  documents = [];
  photosChanged = false;
  chats.clear();
  $("extra-activity").value = "exception";
  for (const kind of ["exception", "transfer"]) {
    $(kind + "-explanation").hidden = true;
    $(kind + "-status").textContent = "";
  }
  $("additional-status").textContent = "";
  $("chat-input").value = "";
  $("lab-status").textContent = "";
  $("view-record").hidden = true;
  for (const controls of photoControls.values()) controls.status.textContent = "";
  hydrateFields();
  rememberDraft();
  renderPhotos();
  renderDocuments();
  renderMode();
  journalRequest("readwrite", (store) => store.delete(oldId), "draftPhotos").catch(() => {});
  location.hash = "lab";
});

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
  $("view-record").hidden = !previous;
  if (location.hash === "#journal") renderJournal();
}).catch(() => {
  $("journal-status").textContent = "브라우저에서 도감 저장 공간을 열지 못했어요.";
}).finally(() => {
  reading = false;
  refreshControls();
});


checkConnection();
