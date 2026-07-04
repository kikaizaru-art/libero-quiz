// リベロクイズ — ゲームロジック
// XP・レベル・ストリーク・デイリーミッション・実績バッジ / localStorage永続化

(() => {
  "use strict";

  const STORAGE_KEY = "libero-quiz-save-v1";
  const XP_PER_CORRECT = 10;
  const COMBO_BONUS = 2;        // 2コンボ目以降、1問ごとに (コンボ数-1)×2 XP
  const CLEAR_BONUS = 20;
  const PERFECT_BONUS = 30;
  const PASS_LINE = 3;          // 5問中3問正解でクリア

  const MISSIONS = [
    { id: "clear",   name: "ステージを1回クリアする", goal: 1,  reward: 30, key: "clears" },
    { id: "correct", name: "10問正解する",           goal: 10, reward: 30, key: "correct" },
    { id: "combo",   name: "3問連続で正解する",       goal: 3,  reward: 20, key: "combo" },
  ];

  const BADGES = [
    { id: "first_clear", name: "はじめの一歩", desc: "初めてステージをクリア" },
    { id: "perfect",     name: "全問正解", desc: "1ステージを全問正解でクリア" },
    { id: "combo5",      name: "5問連続正解", desc: "5問連続で正解" },
    { id: "allcats",     name: "全分野着手", desc: "全分野で1ステージ以上クリア" },
    { id: "streak3",     name: "3日連続学習", desc: "3日連続で学習" },
    { id: "streak7",     name: "7日連続学習", desc: "7日連続で学習" },
    { id: "level5",      name: "レベル5到達", desc: "レベル5に到達" },
    { id: "level10",     name: "レベル10到達", desc: "レベル10に到達" },
    ...QUIZ_DATA.map(c => ({
      id: `master_${c.id}`, name: `${c.name}マスター`,
      desc: `${c.name}の全ステージで星3を獲得`,
    })),
    { id: "complete", name: "全ステージ制覇", desc: "全ステージで星3を獲得" },
  ];

  // ---------- セーブデータ ----------

  function defaultState() {
    return {
      xp: 0,
      stages: {},                                  // "catId-stageIdx" -> { stars, best }
      streak: { count: 0, last: null },
      daily: { date: null, clears: 0, correct: 0, combo: 0, claimed: [] },
      badges: [],
      totals: { answered: 0, correct: 0, perfects: 0, maxCombo: 0, clears: 0 },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return Object.assign(defaultState(), JSON.parse(raw));
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* プライベートモード等では保存不可 */ }
  }

  let state = loadState();

  // ---------- レベル計算 ----------

  function xpNeededFor(level) {
    return 100 + (level - 1) * 50; // Lv1→2は100XP、以降50XPずつ増加
  }

  function levelInfo(xp) {
    let level = 1, rest = xp;
    while (rest >= xpNeededFor(level)) {
      rest -= xpNeededFor(level);
      level++;
    }
    return { level, current: rest, needed: xpNeededFor(level) };
  }

  // ---------- 日次処理(ミッション・ストリーク) ----------

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function ensureDaily() {
    const today = todayStr();
    if (state.daily.date !== today) {
      state.daily = { date: today, clears: 0, correct: 0, combo: 0, claimed: [] };
      saveState();
    }
  }

  function touchStreak() {
    const today = todayStr();
    if (state.streak.last === today) return;
    const yesterday = new Date(Date.now() - 86400000);
    const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    state.streak.count = state.streak.last === yStr ? state.streak.count + 1 : 1;
    state.streak.last = today;
    if (state.streak.count >= 3) awardBadge("streak3");
    if (state.streak.count >= 7) awardBadge("streak7");
  }

  // ---------- 通知・演出 ----------

  function toast(msg) {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 350);
    }, 2600);
  }

  function showLevelUp(level) {
    document.getElementById("levelup-level").textContent = `Lv.${level}`;
    document.getElementById("levelup-overlay").classList.remove("hidden");
  }

  // ---------- XP・バッジ付与 ----------

  function gainXp(amount) {
    const before = levelInfo(state.xp).level;
    state.xp += amount;
    const after = levelInfo(state.xp).level;
    if (after > before) {
      if (after >= 5) awardBadge("level5");
      if (after >= 10) awardBadge("level10");
      showLevelUp(after);
    }
  }

  function awardBadge(id) {
    if (state.badges.includes(id)) return;
    const badge = BADGES.find(b => b.id === id);
    if (!badge) return;
    state.badges.push(id);
    toast(`実績解除:${badge.name}`);
  }

  function checkMissions() {
    ensureDaily();
    for (const m of MISSIONS) {
      if (state.daily.claimed.includes(m.id)) continue;
      if (state.daily[m.key] >= m.goal) {
        state.daily.claimed.push(m.id);
        gainXp(m.reward);
        toast(`目標達成:「${m.name}」 +${m.reward}XP`);
      }
    }
  }

  function checkCollectionBadges() {
    if (state.totals.clears >= 1) awardBadge("first_clear");
    if (state.totals.perfects >= 1) awardBadge("perfect");
    if (state.totals.maxCombo >= 5) awardBadge("combo5");

    const clearedAllCats = QUIZ_DATA.every(c =>
      c.stages.some((_, i) => (state.stages[`${c.id}-${i}`] || {}).stars >= 1)
    );
    if (clearedAllCats) awardBadge("allcats");

    let allMastered = true;
    for (const c of QUIZ_DATA) {
      const mastered = c.stages.every((_, i) => (state.stages[`${c.id}-${i}`] || {}).stars === 3);
      if (mastered) awardBadge(`master_${c.id}`);
      else allMastered = false;
    }
    if (allMastered) awardBadge("complete");
  }

  // ---------- 画面遷移 ----------

  const screens = document.querySelectorAll(".screen");
  const navItems = document.querySelectorAll(".nav-item");

  function show(screenId) {
    screens.forEach(s => s.classList.toggle("active", s.id === screenId));
    navItems.forEach(n => n.classList.toggle("active", n.dataset.screen === screenId));
    const navScreens = ["screen-home", "screen-map", "screen-badges", "screen-stages"];
    document.getElementById("bottom-nav").style.display =
      navScreens.includes(screenId) ? "flex" : "none";
    window.scrollTo(0, 0);
  }

  navItems.forEach(n => n.addEventListener("click", () => {
    show(n.dataset.screen);
    render();
  }));

  // ---------- ホーム描画 ----------

  function renderHome() {
    ensureDaily();
    const info = levelInfo(state.xp);
    document.getElementById("home-level").textContent = info.level;
    document.getElementById("home-streak").textContent = `連続 ${state.streak.count}日`;
    document.getElementById("home-xp-fill").style.width = `${(info.current / info.needed) * 100}%`;
    document.getElementById("home-xp-text").textContent = `${info.current} / ${info.needed} XP`;

    const missionList = document.getElementById("mission-list");
    missionList.innerHTML = "";
    for (const m of MISSIONS) {
      const progress = Math.min(state.daily[m.key], m.goal);
      const done = state.daily.claimed.includes(m.id);
      const el = document.createElement("div");
      el.className = `mission${done ? " done" : ""}`;
      el.innerHTML = `
        <div class="mission-main">
          <div class="mission-name">${m.name} (${progress}/${m.goal})</div>
          <div class="mission-bar"><div class="mission-bar-fill" style="width:${(progress / m.goal) * 100}%"></div></div>
        </div>
        <div class="mission-reward">${done ? "達成" : `+${m.reward}XP`}</div>`;
      missionList.appendChild(el);
    }

    const totalStages = QUIZ_DATA.reduce((a, c) => a + c.stages.length, 0);
    const clearedStages = Object.values(state.stages).filter(s => s.stars >= 1).length;
    const totalStars = Object.values(state.stages).reduce((a, s) => a + (s.stars || 0), 0);
    const stats = [
      { value: `${clearedStages}/${totalStages}`, label: "クリア" },
      { value: `${totalStars}/${totalStages * 3}`, label: "獲得スター" },
      { value: `${state.badges.length}/${BADGES.length}`, label: "実績" },
      { value: state.totals.correct, label: "累計正解" },
      { value: state.totals.maxCombo, label: "最大連続正解" },
      { value: state.totals.perfects, label: "全問正解" },
    ];
    document.getElementById("home-stats").innerHTML = stats.map(s =>
      `<div class="stat"><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>`
    ).join("");
  }

  // ---------- 分野マップ描画 ----------

  function renderMap() {
    const list = document.getElementById("category-list");
    list.innerHTML = "";
    for (const cat of QUIZ_DATA) {
      const cleared = cat.stages.filter((_, i) => (state.stages[`${cat.id}-${i}`] || {}).stars >= 1).length;
      const stars = cat.stages.reduce((a, _, i) => a + ((state.stages[`${cat.id}-${i}`] || {}).stars || 0), 0);
      const btn = document.createElement("button");
      btn.className = "category-card";
      btn.style.setProperty("--cat-color", cat.color);
      btn.innerHTML = `
        <div class="category-name">${cat.name}</div>
        <div class="category-progress">${cleared}/${cat.stages.length} ステージ</div>
        <div class="category-stars">★ ${stars}/${cat.stages.length * 3}</div>`;
      btn.addEventListener("click", () => openStages(cat.id));
      list.appendChild(btn);
    }
  }

  // ---------- ステージ選択描画 ----------

  let currentCatId = null;

  function openStages(catId) {
    currentCatId = catId;
    renderStages();
    show("screen-stages");
  }

  function renderStages() {
    const cat = QUIZ_DATA.find(c => c.id === currentCatId);
    document.getElementById("stages-title").textContent = cat.name;
    const list = document.getElementById("stage-list");
    list.innerHTML = "";
    cat.stages.forEach((stage, i) => {
      const record = state.stages[`${cat.id}-${i}`] || { stars: 0, best: 0 };
      const unlocked = i === 0 || (state.stages[`${cat.id}-${i - 1}`] || {}).stars >= 1;
      const btn = document.createElement("button");
      btn.className = `stage-card${unlocked ? "" : " locked"}`;
      btn.style.setProperty("--cat-color", cat.color);
      const starsHtml = "★".repeat(record.stars) + "☆".repeat(3 - record.stars);
      btn.innerHTML = `
        <div class="stage-num">${unlocked ? i + 1 : "－"}</div>
        <div class="stage-main">
          <div class="stage-name">ステージ${i + 1}:${stage.name}</div>
          <div class="stage-sub">${unlocked ? `全${stage.questions.length}問 ・ ベスト ${record.best}問正解` : "前のステージをクリアで解放"}</div>
        </div>
        <div class="stage-stars">${unlocked ? starsHtml : ""}</div>`;
      if (unlocked) btn.addEventListener("click", () => startQuiz(cat.id, i));
      list.appendChild(btn);
    });
  }

  // ---------- クイズ本体 ----------

  let quiz = null; // { catId, stageIdx, order, index, correct, combo, maxCombo, xp }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startQuiz(catId, stageIdx) {
    const cat = QUIZ_DATA.find(c => c.id === catId);
    quiz = {
      catId, stageIdx,
      order: shuffle(cat.stages[stageIdx].questions.map((_, i) => i)),
      index: 0, correct: 0, combo: 0, maxCombo: 0, xp: 0,
    };
    show("screen-quiz");
    renderQuestion();
  }

  function currentQuestion() {
    const cat = QUIZ_DATA.find(c => c.id === quiz.catId);
    return cat.stages[quiz.stageIdx].questions[quiz.order[quiz.index]];
  }

  function renderQuestion() {
    const cat = QUIZ_DATA.find(c => c.id === quiz.catId);
    const stage = cat.stages[quiz.stageIdx];
    const q = currentQuestion();
    const total = quiz.order.length;

    document.getElementById("quiz-progress-fill").style.width = `${(quiz.index / total) * 100}%`;
    document.getElementById("quiz-meta").textContent =
      `${cat.name} ${stage.name} ・ 第${quiz.index + 1}問 / 全${total}問`;
    document.getElementById("question-text").textContent = q.q;

    const comboBadge = document.getElementById("combo-badge");
    if (quiz.combo >= 2) {
      comboBadge.classList.remove("hidden");
      document.getElementById("combo-count").textContent = quiz.combo;
    } else {
      comboBadge.classList.add("hidden");
    }

    document.getElementById("explanation").classList.add("hidden");

    const choicesEl = document.getElementById("choices");
    choicesEl.innerHTML = "";
    // 選択肢の並びも毎回シャッフル
    const order = shuffle(q.choices.map((_, i) => i));
    order.forEach(choiceIdx => {
      const btn = document.createElement("button");
      btn.className = "choice";
      btn.textContent = q.choices[choiceIdx];
      btn.addEventListener("click", () => answer(choiceIdx, btn));
      choicesEl.appendChild(btn);
    });
  }

  function answer(choiceIdx, clickedBtn) {
    const q = currentQuestion();
    const isCorrect = choiceIdx === q.answer;
    const buttons = document.querySelectorAll("#choices .choice");
    buttons.forEach(b => {
      b.disabled = true;
      if (b.textContent === q.choices[q.answer]) b.classList.add("correct");
      else if (b !== clickedBtn) b.classList.add("dim");
    });

    state.totals.answered++;
    if (isCorrect) {
      quiz.correct++;
      quiz.combo++;
      quiz.maxCombo = Math.max(quiz.maxCombo, quiz.combo);
      quiz.xp += XP_PER_CORRECT + (quiz.combo >= 2 ? (quiz.combo - 1) * COMBO_BONUS : 0);
      state.totals.correct++;
      state.totals.maxCombo = Math.max(state.totals.maxCombo, quiz.combo);
      ensureDaily();
      state.daily.correct++;
      state.daily.combo = Math.max(state.daily.combo, quiz.combo);
    } else {
      quiz.combo = 0;
      clickedBtn.classList.add("wrong");
      document.getElementById("question-card").classList.add("shake");
      setTimeout(() => document.getElementById("question-card").classList.remove("shake"), 450);
    }

    const verdict = document.getElementById("explanation-verdict");
    verdict.textContent = isCorrect
      ? (quiz.combo >= 2 ? `正解(${quiz.combo}問連続正解)` : "正解")
      : `不正解 — 正解は「${q.choices[q.answer]}」`;
    verdict.className = `explanation-verdict ${isCorrect ? "good" : "bad"}`;
    document.getElementById("explanation-text").textContent = q.exp;
    document.getElementById("btn-next").textContent =
      quiz.index + 1 < quiz.order.length ? "次へ" : "結果を見る";
    document.getElementById("explanation").classList.remove("hidden");

    document.getElementById("quiz-progress-fill").style.width =
      `${((quiz.index + 1) / quiz.order.length) * 100}%`;

    saveState();
  }

  document.getElementById("btn-next").addEventListener("click", () => {
    quiz.index++;
    if (quiz.index < quiz.order.length) renderQuestion();
    else finishQuiz();
  });

  // ---------- リザルト ----------

  function starsFor(correct, total) {
    if (correct >= total) return 3;
    if (correct >= total - 1) return 2;
    if (correct >= PASS_LINE) return 1;
    return 0;
  }

  function finishQuiz() {
    const total = quiz.order.length;
    const stars = starsFor(quiz.correct, total);
    const cleared = stars >= 1;
    const perfect = quiz.correct === total;
    let earnedXp = quiz.xp;
    if (cleared) earnedXp += CLEAR_BONUS;
    if (perfect) earnedXp += PERFECT_BONUS;

    // 記録更新
    const key = `${quiz.catId}-${quiz.stageIdx}`;
    const record = state.stages[key] || { stars: 0, best: 0 };
    record.stars = Math.max(record.stars, stars);
    record.best = Math.max(record.best, quiz.correct);
    state.stages[key] = record;

    if (cleared) {
      state.totals.clears++;
      if (perfect) state.totals.perfects++;
      ensureDaily();
      state.daily.clears++;
      touchStreak();
    }

    gainXp(earnedXp);
    checkMissions();
    checkCollectionBadges();
    saveState();

    // 画面描画
    document.getElementById("result-title").textContent =
      perfect ? "全問正解" : cleared ? "ステージクリア" : "クリアまであと一歩";
    document.getElementById("result-stars").innerHTML =
      [1, 2, 3].map(i => `<span class="star${i <= stars ? " earned" : ""}">★</span>`).join("");
    document.getElementById("result-score").textContent =
      `${total}問中 ${quiz.correct}問正解 ・ 最大${quiz.maxCombo}問連続正解` +
      (cleared ? "" : ` (${PASS_LINE}問正解でクリア)`);
    document.getElementById("result-xp").textContent = `+${earnedXp} XP`;

    const info = levelInfo(state.xp);
    document.getElementById("result-xp-fill").style.width = `${(info.current / info.needed) * 100}%`;
    document.getElementById("result-xp-text").textContent =
      `Lv.${info.level} ・ 次のレベルまで あと${info.needed - info.current}XP`;

    // 「つづける」ボタンの行き先:次ステージがあればそこへ
    const cat = QUIZ_DATA.find(c => c.id === quiz.catId);
    const nextIdx = quiz.stageIdx + 1;
    const hasNext = cleared && nextIdx < cat.stages.length;
    const btnContinue = document.getElementById("btn-continue");
    btnContinue.textContent = hasNext ? "次のステージへ" : "分野一覧へ";
    btnContinue.onclick = () => {
      if (hasNext) startQuiz(quiz.catId, nextIdx);
      else { renderStages(); show("screen-stages"); render(); }
    };

    show("screen-result");
  }

  document.getElementById("btn-retry").addEventListener("click", () => {
    startQuiz(quiz.catId, quiz.stageIdx);
  });

  // ---------- バッジ描画 ----------

  function renderBadges() {
    document.getElementById("badges-count").textContent =
      `${state.badges.length} / ${BADGES.length} 個 解除済み`;
    const list = document.getElementById("badge-list");
    list.innerHTML = "";
    for (const b of BADGES) {
      const owned = state.badges.includes(b.id);
      const el = document.createElement("div");
      el.className = `badge${owned ? "" : " locked"}`;
      el.innerHTML = `
        <div class="badge-status">${owned ? "達成" : "未達成"}</div>
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>`;
      list.appendChild(el);
    }
  }

  // ---------- 共通イベント ----------

  document.getElementById("btn-start").addEventListener("click", () => {
    renderMap();
    show("screen-map");
  });
  document.getElementById("btn-stages-back").addEventListener("click", () => {
    renderMap();
    show("screen-map");
  });
  document.getElementById("btn-quiz-quit").addEventListener("click", () => {
    if (confirm("クイズを中断しますか?(進行中の記録は保存されません)")) {
      renderStages();
      show("screen-stages");
    }
  });
  document.getElementById("btn-levelup-close").addEventListener("click", () => {
    document.getElementById("levelup-overlay").classList.add("hidden");
  });

  function render() {
    renderHome();
    renderMap();
    renderBadges();
  }

  // ---------- 起動 ----------

  ensureDaily();
  render();
  show("screen-home");
})();
