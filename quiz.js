"use strict";

(() => {
  const bank = [
    {
      question: "싹이 틀 때 떡잎이 한 장 나온 것을 직접 확인했어요. 이 관찰을 어떻게 해석하면 좋을까요?",
      choices: ["쌍떡잎식물 쪽을 지지하는 단서예요.", "외떡잎식물 쪽을 지지하는 단서예요.", "떡잎 수는 분류에 쓰이지 않아요.", "꽃잎도 반드시 한 장이에요."],
      answerIndex: 1,
      explanation: "떡잎 한 장은 외떡잎식물을 지지하는 직접적인 단서예요. 떡잎 수를 꽃잎 수와 혼동하지 않도록 주의해요.",
    },
    {
      question: "잎의 가는 잎맥들이 서로 연결되어 그물 모양을 이루어요. 가장 알맞은 판단은 무엇인가요?",
      choices: ["그물맥만으로 어떤 식물인지 정확히 알 수 있어요.", "잎이 길면 이 관찰은 무시해도 돼요.", "그물맥은 진정쌍떡잎 쪽 단서이므로 꽃이나 떡잎도 살펴봐요.", "나란히맥이므로 외떡잎으로 기록해요."],
      answerIndex: 2,
      explanation: "그물맥은 진정쌍떡잎식물의 대표 특징이에요. 예외가 있으므로 꽃이나 떡잎처럼 다른 단서도 비교하면 판단이 더 탄탄해져요.",
    },
    {
      question: "꽃 한 송이에서 꽃잎처럼 보이는 조각을 여섯 개 셌어요. 수를 바르게 해석한 것은 무엇인가요?",
      choices: ["6은 3의 배수이므로 외떡잎 쪽 단서가 돼요.", "6은 4의 배수이므로 쌍떡잎 쪽 단서가 돼요.", "꽃의 조각이 6개라면 떡잎도 6장이에요.", "꽃 기관 수는 분류와 관계가 없어요."],
      answerIndex: 0,
      explanation: "6은 3의 배수라 외떡잎 쪽을 지지하는 단서예요. 꽃잎처럼 보이는 조각은 한 송이에서 센 것인지 확인하고, 다른 관찰과 함께 판단해요.",
    },
    {
      question: "굵은 뿌리 하나가 뚜렷하고 그 옆에 가는 뿌리가 여러 개 달려 있어요. 무엇을 관찰한 것인가요?",
      choices: ["굵기가 비슷한 수염뿌리만 본 거예요.", "줄기의 고리 모양 관다발을 본 거예요.", "뿌리 몇 개만으로 정확한 종 이름을 알 수 있어요.", "곧은뿌리와 곁뿌리로, 진정쌍떡잎 쪽 단서예요."],
      answerIndex: 3,
      explanation: "굵은 중심 뿌리와 옆으로 갈라진 곁뿌리가 보이면 곧은뿌리형이에요. 이는 진정쌍떡잎식물에서 볼 수 있는 대표적인 단서예요.",
    },
    {
      question: "줄기 단면에서 관다발이 흩어져 있고, 일반적인 관다발 형성층은 찾을 수 없었어요. 어떤 판단이 가장 알맞나요?",
      choices: ["관다발이 흩어져 있으므로 관다발이 없는 식물이에요.", "외떡잎식물 쪽 판단을 뒷받침하는 두 단서예요.", "형성층이 보이지 않으면 줄기는 절대 굵어질 수 없어요.", "외떡잎과 진정쌍떡잎을 비교하는 단서로 쓸 수 없어요."],
      answerIndex: 1,
      explanation: "흩어진 관다발과 일반적인 관다발 형성층이 없는 것은 외떡잎 쪽을 지지해요. 대나무처럼 다른 방식으로 굵고 단단한 줄기를 만드는 식물도 있어요.",
    },
    {
      question: "대나무의 굵고 단단한 줄기를 본 친구가 진정쌍떡잎식물이라고 말했어요. 어떤 방법으로 확인하면 좋을까요?",
      choices: ["굵기가 비슷한 나무가 있는지 확인해요.", "단단한 정도를 재서 높으면 곧바로 쌍떡잎이라고 적어요.", "단면 자료에서 관다발 배열을 보고 다른 단서도 비교해요.", "줄기의 높이만 비교하면 알 수 있어요."],
      answerIndex: 2,
      explanation: "대나무는 굵고 단단한 줄기를 가진 외떡잎식물이에요. 굵기만으로는 분류할 수 없으므로 단면의 관다발 배열과 다른 단서를 함께 살펴봐요.",
    },
    {
      question: "질경이의 큰 잎맥이 나란해 보였어요. 외떡잎식물로 바로 분류하기 어려운 이유는 무엇인가요?",
      choices: ["질경이처럼 진정쌍떡잎식물도 큰 잎맥이 나란해 보일 수 있어요.", "질경이는 잎맥이 없기 때문이에요.", "진정쌍떡잎식물은 모두 잎이 둥글기 때문이에요.", "꽃이나 떡잎을 살펴봐도 추가 단서를 얻을 수 없어요."],
      answerIndex: 0,
      explanation: "질경이는 진정쌍떡잎식물이에요. 큰 잎맥이 겉보기에는 나란할 수 있으므로 가는 맥의 연결과 작은 꽃 한 송이의 구조를 함께 확인해요.",
    },
    {
      question: "사진에 흐릿한 잎 한 장만 있고 떡잎, 꽃, 뿌리, 줄기 단면은 보이지 않아요. 어떻게 기록할까요?",
      choices: ["보이지 않는 꽃잎 수를 추정해서 관찰 기록에 적어요.", "잎이 한 장 보이므로 외떡잎이라고 확정해요.", "다른 기관이 모두 없다고 기록해요.", "확인한 것만 적고, 분류는 판단 보류로 남겨요."],
      answerIndex: 3,
      explanation: "사진에 없는 부위는 관찰하지 못했다고 남겨요. 잎 한 장과 발아할 때 나오는 떡잎 한 장은 다른 단서며, 근거가 부족하면 판단 보류가 알맞아요.",
    },
  ];

  const question = document.getElementById("quiz-question");
  const options = document.getElementById("quiz-options");
  const feedback = document.getElementById("quiz-feedback");
  const status = document.getElementById("quiz-status");
  let index = 0;
  let current;
  let interacting = false;
  let queuedQuiz;
  let pending;
  const seen = new Set();

  function showQuiz(quiz, source) {
    current = quiz;
    interacting = false;
    seen.add(quiz.question);
    question.textContent = quiz.question;
    status.textContent = source;
    feedback.hidden = true;
    options.replaceChildren();
    for (const [i, text] of quiz.choices.entries()) {
      const option = document.createElement("button");
      const number = document.createElement("span");
      number.className = "quiz-number";
      number.textContent = String(i + 1) + ".";
      option.type = "button";
      option.setAttribute("aria-pressed", "false");
      option.append(number, document.createTextNode(text));
      option.addEventListener("click", () => {
        interacting = true;
        for (const choice of options.children) choice.setAttribute("aria-pressed", String(choice === option));
        feedback.textContent = i === quiz.answerIndex ? "정답이에요! " + quiz.explanation
          : "오답이에요. 정답은 " + (quiz.answerIndex + 1) + "번이에요. " + quiz.explanation;
        feedback.hidden = false;
      });
      options.append(option);
    }
  }

  options.addEventListener("focusin", () => { interacting = true; });
  document.getElementById("quiz-next").addEventListener("click", async () => {
    pending?.abort();
    if (queuedQuiz) {
      showQuiz(queuedQuiz, "AI 출제");
      queuedQuiz = null;
      question.focus({ preventScroll: true });
      return;
    }
    index = (index + 1) % bank.length;
    showQuiz(bank[index], "기본 문제 · AI가 새 문제를 준비하고 있어요.");
    question.focus({ preventScroll: true });
    const fallback = current;
    const controller = new AbortController();
    pending = controller;
    try {
      const reply = await fetch("./api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activity: "quiz", topicIndex: index }),
        signal: controller.signal,
      });
      if (!reply.ok) throw Error("Quiz request failed");
      const { quiz } = await reply.json();
      if (!quiz || seen.has(quiz.question)) throw Error("Quiz unavailable");
      if (pending !== controller || current !== fallback) return;
      if (interacting) {
        queuedQuiz = quiz;
        status.textContent = "기본 문제 · 다음 AI 문제가 준비됐어요.";
      } else showQuiz(quiz, "AI 출제");
    } catch {
      if (pending === controller) status.textContent = "기본 문제 · AI 문제를 받지 못했어요.";
    } finally {
      if (pending === controller) pending = null;
    }
  });

  const tabs = [...document.querySelectorAll(".extra-tabs [role='tab']")];
  function selectTab(selected) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
    }
  }
  for (const [i, tab] of tabs.entries()) {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      const destinations = { ArrowLeft: (i + tabs.length - 1) % tabs.length, ArrowRight: (i + 1) % tabs.length, Home: 0, End: tabs.length - 1 };
      if (!Object.hasOwn(destinations, event.key)) return;
      event.preventDefault();
      const selected = tabs[destinations[event.key]];
      selectTab(selected);
      selected.focus();
    });
  }

  showQuiz(bank[index], "기본 문제");
})();
