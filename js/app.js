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
  const REVIEW_SIZE = 5;        // 復習1回あたりの出題数
  const REVIEW_PERFECT_BONUS = 15;
  const FREE_SIZE = 5;          // ランダム出題(全ステージ制覇後)の出題数

  const MISSIONS = [
    { id: "clear",   name: "ステージを1回クリアする", goal: 1,  reward: 30, key: "clears" },
    { id: "correct", name: "10問正解する",           goal: 10, reward: 30, key: "correct" },
    { id: "combo",   name: "3問連続で正解する",       goal: 3,  reward: 20, key: "combo" },
  ];

  const BADGES = [
    { id: "first_clear", name: "はじめの一歩", desc: "初めてステージをクリア" },
    { id: "perfect",     name: "全問正解", desc: "1ステージを全問正解でクリア" },
    { id: "combo5",      name: "5問連続正解", desc: "5問連続で正解" },
    { id: "review10",    name: "弱点克服", desc: "復習で10問を克服" },
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
      totals: { answered: 0, correct: 0, perfects: 0, maxCombo: 0, clears: 0, reviewMastered: 0 },
      wrong: {},                                   // "catId:stageIdx:qIdx" -> { count, last }
      catStats: {},                                // catId -> { answered, correct }
      activity: {},                                // "YYYY-MM-DD" -> その日の解答数
      lastStage: null,                             // { catId, stageIdx } 最後に挑戦したステージ
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const base = defaultState();
      const saved = JSON.parse(raw);
      const merged = Object.assign(base, saved);
      // 旧バージョンのセーブデータに新フィールドを補完
      merged.totals = Object.assign(defaultState().totals, saved.totals || {});
      return merged;
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

  // ---------- 設定(学習データとは別キーで保存。学習リセット後も維持) ----------

  const SETTINGS_KEY = "libero-quiz-settings-v1";

  function defaultSettings() {
    return { theme: "system" }; // "system" | "light" | "dark"
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? Object.assign(defaultSettings(), JSON.parse(raw)) : defaultSettings();
    } catch {
      return defaultSettings();
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch { /* プライベートモード等では保存不可 */ }
  }

  let settings = loadSettings();

  function applyTheme() {
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
  }

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

  function dateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function todayStr() {
    return dateStr(new Date());
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
    const yStr = dateStr(new Date(Date.now() - 86400000));
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
    if (state.totals.reviewMastered >= 10) awardBadge("review10");

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

  // ---------- ステージ進捗ヘルパー ----------

  function stageRecord(catId, i) {
    return state.stages[`${catId}-${i}`] || { stars: 0, best: 0 };
  }

  function isUnlocked(cat, i) {
    return i === 0 || stageRecord(cat.id, i - 1).stars >= 1;
  }

  // 分野内で次に挑戦すべきステージ(未クリアかつ解放済み)。なければ -1
  function nextStageIn(cat) {
    return cat.stages.findIndex((_, i) => stageRecord(cat.id, i).stars === 0 && isUnlocked(cat, i));
  }

  // 「今日の5問」の出題先を決める
  // 1. 前回挑戦したステージが未クリアならその続き
  // 2. 同分野の次の未クリアステージ
  // 3. 全分野を順に見て最初の未クリアステージ
  // 4. すべてクリア済み → 復習待ちがあれば復習、なければランダム5問
  function pickTodayTarget() {
    if (state.lastStage) {
      const cat = QUIZ_DATA.find(c => c.id === state.lastStage.catId);
      if (cat) {
        const i = state.lastStage.stageIdx;
        if (i < cat.stages.length && stageRecord(cat.id, i).stars === 0 && isUnlocked(cat, i)) {
          return { type: "stage", catId: cat.id, stageIdx: i, resumed: true };
        }
        const next = nextStageIn(cat);
        if (next >= 0) return { type: "stage", catId: cat.id, stageIdx: next, resumed: false };
      }
    }
    for (const cat of QUIZ_DATA) {
      const i = nextStageIn(cat);
      if (i >= 0) return { type: "stage", catId: cat.id, stageIdx: i, resumed: false };
    }
    if (Object.keys(state.wrong).length > 0) return { type: "review" };
    return { type: "free" };
  }

  // ---------- 画面遷移 ----------

  const screens = document.querySelectorAll(".screen");
  const navItems = document.querySelectorAll(".nav-item");

  function show(screenId) {
    screens.forEach(s => s.classList.toggle("active", s.id === screenId));
    navItems.forEach(n => n.classList.toggle("active", n.dataset.screen === screenId));
    const navScreens = ["screen-home", "screen-map", "screen-stages", "screen-review", "screen-stats", "screen-settings"];
    document.getElementById("bottom-nav").style.display =
      navScreens.includes(screenId) ? "flex" : "none";
    window.scrollTo(0, 0);
  }

  navItems.forEach(n => n.addEventListener("click", () => {
    show(n.dataset.screen);
    render();
  }));

  // ---------- ホーム描画 ----------

  function renderToday() {
    const t = pickTodayTarget();
    const desc = document.getElementById("today-desc");
    const btn = document.getElementById("btn-start");
    if (t.type === "stage") {
      const cat = QUIZ_DATA.find(c => c.id === t.catId);
      const stage = cat.stages[t.stageIdx];
      desc.textContent = `${cat.name} ステージ${t.stageIdx + 1}(${stage.name})${t.resumed ? "の続きから" : "に挑戦"}`;
      btn.textContent = "始める";
    } else if (t.type === "review") {
      const n = Math.min(Object.keys(state.wrong).length, REVIEW_SIZE);
      desc.textContent = `未クリアのステージはありません。復習${n}問で弱点を克服しましょう`;
      btn.textContent = "復習を始める";
    } else {
      desc.textContent = "全ステージクリア済み。全分野からランダムに5問出題します";
      btn.textContent = "始める";
    }
  }

  function renderHome() {
    ensureDaily();
    const info = levelInfo(state.xp);
    document.getElementById("home-level").textContent = info.level;
    document.getElementById("home-streak").textContent = `連続 ${state.streak.count}日`;
    document.getElementById("home-xp-fill").style.width = `${(info.current / info.needed) * 100}%`;
    document.getElementById("home-xp-text").textContent = `${info.current} / ${info.needed} XP`;

    renderToday();

    // 本日の目標(1行サマリー+展開)
    const doneCount = MISSIONS.filter(m => state.daily.claimed.includes(m.id)).length;
    document.getElementById("missions-dots").innerHTML = MISSIONS.map(m =>
      `<i class="${state.daily.claimed.includes(m.id) ? "done" : ""}"></i>`
    ).join("");
    document.getElementById("missions-count").textContent = `${doneCount}/${MISSIONS.length} 達成`;

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

    // 復習カード(待ちがあるときだけ表示)
    const reviewCount = Object.keys(state.wrong).length;
    const card = document.getElementById("home-review-card");
    card.classList.toggle("hidden", reviewCount === 0);
    if (reviewCount > 0) {
      document.getElementById("review-desc").textContent =
        `間違えた問題が ${reviewCount}問 あります。正解すればリストから消えます。`;
      document.getElementById("btn-review").textContent =
        `復習する(${Math.min(reviewCount, REVIEW_SIZE)}問)`;
    }
  }

  // 本日の目標の展開/折りたたみ
  document.getElementById("missions-toggle").addEventListener("click", () => {
    const card = document.getElementById("missions-card");
    const open = card.classList.toggle("open");
    document.getElementById("mission-list").classList.toggle("hidden", !open);
    document.getElementById("missions-toggle").setAttribute("aria-expanded", String(open));
  });

  // ---------- 学習(分野一覧)描画 ----------

  function renderMap() {
    const list = document.getElementById("category-list");
    list.innerHTML = "";
    for (const cat of QUIZ_DATA) {
      const cleared = cat.stages.filter((_, i) => stageRecord(cat.id, i).stars >= 1).length;
      const stars = cat.stages.reduce((a, _, i) => a + stageRecord(cat.id, i).stars, 0);
      const maxStars = cat.stages.length * 3;
      const nextIdx = nextStageIn(cat);
      const el = document.createElement("div");
      el.className = "category-card";
      el.style.setProperty("--cat-color", cat.color);
      el.style.setProperty("--ring-pct", `${(stars / maxStars) * 100}%`);
      el.innerHTML = `
        <button class="category-open">
          <span class="category-ring"><span class="category-ring-inner">★${stars}</span></span>
          <span class="category-info">
            <span class="category-name">${cat.name}</span>
            <span class="category-progress">${cleared}/${cat.stages.length} ステージ ・ ★${stars}/${maxStars}</span>
          </span>
          <span class="category-chev" aria-hidden="true">›</span>
        </button>
        ${nextIdx >= 0 ? `<button class="category-continue">${cleared > 0 ? "続きから" : "始める"}</button>` : ""}`;
      el.querySelector(".category-open").addEventListener("click", () => openStages(cat.id));
      const cont = el.querySelector(".category-continue");
      if (cont) cont.addEventListener("click", () => startQuiz(cat.id, nextIdx));
      list.appendChild(el);
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
      const record = stageRecord(cat.id, i);
      const unlocked = isUnlocked(cat, i);
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

  // mode: "stage"(通常) | "review"(復習) | "free"(ランダム出題)
  // items: [{ catId, stageIdx, qIdx }]
  let quiz = null; // { mode, catId, stageIdx, items, index, correct, combo, maxCombo, xp, mastered, wrongList }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newQuiz(mode, catId, stageIdx, items) {
    return {
      mode, catId, stageIdx, items,
      index: 0, correct: 0, combo: 0, maxCombo: 0, xp: 0, mastered: 0,
      wrongList: [],
    };
  }

  function startQuiz(catId, stageIdx) {
    const cat = QUIZ_DATA.find(c => c.id === catId);
    const items = shuffle(cat.stages[stageIdx].questions.map((_, i) => ({ catId, stageIdx, qIdx: i })));
    quiz = newQuiz("stage", catId, stageIdx, items);
    currentCatId = catId; // 中断時にステージ一覧へ戻れるように
    state.lastStage = { catId, stageIdx };
    saveState();
    show("screen-quiz");
    renderQuestion();
  }

  function startReview() {
    const keys = shuffle(Object.keys(state.wrong)).slice(0, REVIEW_SIZE);
    if (keys.length === 0) return;
    const items = keys.map(k => {
      const [catId, stageIdx, qIdx] = k.split(":");
      return { catId, stageIdx: Number(stageIdx), qIdx: Number(qIdx) };
    });
    quiz = newQuiz("review", null, null, items);
    show("screen-quiz");
    renderQuestion();
  }

  function startFree() {
    const all = [];
    QUIZ_DATA.forEach(cat => cat.stages.forEach((stage, si) =>
      stage.questions.forEach((_, qi) => all.push({ catId: cat.id, stageIdx: si, qIdx: qi }))
    ));
    quiz = newQuiz("free", null, null, shuffle(all).slice(0, FREE_SIZE));
    show("screen-quiz");
    renderQuestion();
  }

  // 「今日の5問」開始
  function startToday() {
    const t = pickTodayTarget();
    if (t.type === "stage") startQuiz(t.catId, t.stageIdx);
    else if (t.type === "review") startReview();
    else startFree();
  }

  function questionAt(item) {
    const cat = QUIZ_DATA.find(c => c.id === item.catId);
    return cat.stages[item.stageIdx].questions[item.qIdx];
  }

  function currentQuestion() {
    return questionAt(quiz.items[quiz.index]);
  }

  // 解説ボトムシート
  const sheet = document.getElementById("explanation");
  function openSheet() { sheet.classList.add("open"); }
  function closeSheet() { sheet.classList.remove("open"); }

  function renderQuestion() {
    const item = quiz.items[quiz.index];
    const cat = QUIZ_DATA.find(c => c.id === item.catId);
    const q = currentQuestion();
    const total = quiz.items.length;

    closeSheet();

    document.getElementById("quiz-progress-fill").style.width = `${(quiz.index / total) * 100}%`;
    document.getElementById("quiz-progress-text").textContent = `${quiz.index + 1}/${total}`;
    const metaPrefix = quiz.mode === "review" ? `復習(${cat.name})`
      : quiz.mode === "free" ? `ランダム出題(${cat.name})`
      : `${cat.name} ${cat.stages[item.stageIdx].name}`;
    document.getElementById("quiz-meta").textContent =
      `${metaPrefix} ・ 第${quiz.index + 1}問 / 全${total}問`;
    document.getElementById("question-text").textContent = q.q;

    const comboBadge = document.getElementById("combo-badge");
    if (quiz.combo >= 2) {
      comboBadge.classList.remove("hidden");
      document.getElementById("combo-count").textContent = quiz.combo;
    } else {
      comboBadge.classList.add("hidden");
    }

    const choicesEl = document.getElementById("choices");
    choicesEl.innerHTML = "";
    // 選択肢の並びも毎回シャッフル
    const order = shuffle(q.choices.map((_, i) => i));
    order.forEach(choiceIdx => {
      const btn = document.createElement("button");
      btn.className = "choice";
      btn.dataset.index = choiceIdx;
      btn.textContent = q.choices[choiceIdx];
      btn.addEventListener("click", () => answer(choiceIdx, btn));
      choicesEl.appendChild(btn);
    });
  }

  function answer(choiceIdx, clickedBtn) {
    const q = currentQuestion();
    const item = quiz.items[quiz.index];
    const wrongKey = `${item.catId}:${item.stageIdx}:${item.qIdx}`;
    const isCorrect = choiceIdx === q.answer;
    const buttons = document.querySelectorAll("#choices .choice");
    buttons.forEach(b => {
      b.disabled = true;
      if (Number(b.dataset.index) === q.answer) b.classList.add("correct");
      else if (b !== clickedBtn) b.classList.add("dim");
    });

    state.totals.answered++;

    // 分野別成績・日別解答数(記録画面用)
    const cs = state.catStats[item.catId] || (state.catStats[item.catId] = { answered: 0, correct: 0 });
    cs.answered++;
    if (isCorrect) cs.correct++;
    const today = todayStr();
    state.activity[today] = (state.activity[today] || 0) + 1;

    // 復習リストの更新:間違えたら追加、正解したら除去
    if (isCorrect) {
      if (state.wrong[wrongKey]) {
        delete state.wrong[wrongKey];
        if (quiz.mode === "review") {
          quiz.mastered++;
          state.totals.reviewMastered++;
        }
      }
    } else {
      const entry = state.wrong[wrongKey] || { count: 0, last: null };
      entry.count++;
      entry.last = today;
      state.wrong[wrongKey] = entry;
      quiz.wrongList.push({ q: q.q, correct: q.choices[q.answer] });
    }

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
      quiz.index + 1 < quiz.items.length ? "次へ" : "結果を見る";
    openSheet();

    document.getElementById("quiz-progress-fill").style.width =
      `${((quiz.index + 1) / quiz.items.length) * 100}%`;

    saveState();
  }

  document.getElementById("btn-next").addEventListener("click", () => {
    quiz.index++;
    if (quiz.index < quiz.items.length) renderQuestion();
    else finishQuiz();
  });

  // ---------- リザルト ----------

  function starsFor(correct, total) {
    if (correct >= total) return 3;
    if (correct >= total - 1) return 2;
    if (correct >= PASS_LINE) return 1;
    return 0;
  }

  function renderResultXp(earnedXp) {
    document.getElementById("result-xp").textContent = `+${earnedXp} XP`;
    const info = levelInfo(state.xp);
    document.getElementById("result-xp-fill").style.width = `${(info.current / info.needed) * 100}%`;
    document.getElementById("result-xp-text").textContent =
      `Lv.${info.level} ・ 次のレベルまで あと${info.needed - info.current}XP`;
  }

  // 間違えた問題のふりかえり
  function renderRecap() {
    const card = document.getElementById("result-recap");
    if (quiz.wrongList.length === 0) {
      card.classList.add("hidden");
      return;
    }
    card.classList.remove("hidden");
    document.getElementById("recap-list").innerHTML = quiz.wrongList.map(w => `
      <div class="recap-item">
        <div class="recap-q">${w.q}</div>
        <div class="recap-a">正解:${w.correct}</div>
      </div>`).join("");
    document.getElementById("recap-note").textContent = quiz.mode === "review"
      ? "この問題は復習リストに残っています。復習タブからいつでも再挑戦できます。"
      : "間違えた問題は復習リストに追加しました。復習タブからいつでも挑戦できます。";
  }

  // 復習・ランダム出題のリザルト(ステージ記録なし)
  function finishLight(mode) {
    const total = quiz.items.length;
    let earnedXp = quiz.xp;
    if (quiz.correct === total) earnedXp += REVIEW_PERFECT_BONUS;

    touchStreak();
    gainXp(earnedXp);
    checkMissions();
    checkCollectionBadges();
    saveState();

    document.getElementById("result-title").textContent =
      mode === "review" ? "復習完了" : "5問チャレンジ完了";
    document.getElementById("result-stars").classList.add("hidden");
    document.getElementById("result-score").textContent =
      `${total}問中 ${quiz.correct}問正解` +
      (mode === "review" && quiz.mastered > 0 ? ` ・ ${quiz.mastered}問を克服` : "");
    renderResultXp(earnedXp);
    renderRecap();

    const btnRetry = document.getElementById("btn-retry");
    if (mode === "review") {
      const remaining = Object.keys(state.wrong).length;
      btnRetry.classList.toggle("hidden", remaining === 0);
      btnRetry.textContent = "続けて復習";
      btnRetry.onclick = () => startReview();
    } else {
      btnRetry.classList.remove("hidden");
      btnRetry.textContent = "もう5問";
      btnRetry.onclick = () => startFree();
    }
    const btnContinue = document.getElementById("btn-continue");
    btnContinue.textContent = "ホームへ";
    btnContinue.onclick = () => { show("screen-home"); render(); };

    show("screen-result");
  }

  function finishQuiz() {
    closeSheet();
    if (quiz.mode !== "stage") { finishLight(quiz.mode); return; }

    const total = quiz.items.length;
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
    const starsEl = document.getElementById("result-stars");
    starsEl.classList.remove("hidden");
    starsEl.innerHTML =
      [1, 2, 3].map(i => `<span class="star${i <= stars ? " earned" : ""}">★</span>`).join("");
    document.getElementById("result-score").textContent =
      `${total}問中 ${quiz.correct}問正解 ・ 最大${quiz.maxCombo}問連続正解` +
      (cleared ? "" : ` (${PASS_LINE}問正解でクリア)`);
    renderResultXp(earnedXp);
    renderRecap();

    const btnRetry = document.getElementById("btn-retry");
    btnRetry.classList.remove("hidden");
    btnRetry.textContent = "再挑戦";
    btnRetry.onclick = () => startQuiz(quiz.catId, quiz.stageIdx);

    // 「つづける」ボタンの行き先:次ステージがあればそこへ
    const cat = QUIZ_DATA.find(c => c.id === quiz.catId);
    const nextIdx = quiz.stageIdx + 1;
    const hasNext = cleared && nextIdx < cat.stages.length;
    const btnContinue = document.getElementById("btn-continue");
    btnContinue.textContent = hasNext ? "次のステージへ" : "分野一覧へ";
    btnContinue.onclick = () => {
      if (hasNext) startQuiz(quiz.catId, nextIdx);
      else { renderMap(); show("screen-map"); render(); }
    };

    show("screen-result");
  }

  // ---------- 復習画面 ----------

  function renderReview() {
    const keys = Object.keys(state.wrong);
    const n = keys.length;

    document.getElementById("review-sub").textContent =
      n > 0 ? `復習待ちが ${n}問 あります` : "復習待ちはありません";

    const desc = document.getElementById("review-screen-desc");
    const btn = document.getElementById("btn-review-start");
    if (n > 0) {
      desc.textContent = "間違えた問題から最大5問を出題します。正解するとリストから消えます(克服)。";
      btn.textContent = `復習する(${Math.min(n, REVIEW_SIZE)}問)`;
      btn.disabled = false;
    } else {
      desc.textContent = "間違えた問題がここに溜まります。今は復習する問題がありません。";
      btn.textContent = "復習する";
      btn.disabled = true;
    }

    // 分野別の内訳
    const catsCard = document.getElementById("review-cats-card");
    catsCard.classList.toggle("hidden", n === 0);
    if (n > 0) {
      const counts = {};
      keys.forEach(k => {
        const catId = k.split(":")[0];
        counts[catId] = (counts[catId] || 0) + 1;
      });
      document.getElementById("review-cats").innerHTML = QUIZ_DATA
        .filter(c => counts[c.id])
        .map(c => `
          <div class="review-cat">
            <span class="review-cat-name">${c.name}</span>
            <span class="review-cat-count">${counts[c.id]}問</span>
          </div>`).join("");
    }

    // 間違えた回数が多い問題(正解はネタバレしない)
    const listCard = document.getElementById("review-list-card");
    listCard.classList.toggle("hidden", n === 0);
    if (n > 0) {
      const entries = keys.map(k => {
        const [catId, si, qi] = k.split(":");
        const cat = QUIZ_DATA.find(c => c.id === catId);
        const q = cat.stages[Number(si)].questions[Number(qi)];
        return { catName: cat.name, text: q.q, count: state.wrong[k].count };
      }).sort((a, b) => b.count - a.count).slice(0, 8);
      document.getElementById("review-list").innerHTML = entries.map(e => `
        <div class="review-item">
          <div class="review-item-q">${e.text.length > 42 ? e.text.slice(0, 42) + "…" : e.text}</div>
          <div class="review-item-meta">${e.catName} ・ ${e.count}回 間違えました</div>
        </div>`).join("");
    }
  }

  function updateNavBadge() {
    const n = Object.keys(state.wrong).length;
    const badge = document.getElementById("nav-review-badge");
    badge.textContent = n;
    badge.classList.toggle("hidden", n === 0);
  }

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

  // ---------- 記録画面 ----------

  // セグメント切替(学習記録 / 実績)
  document.querySelectorAll(".segment-btn").forEach(btn =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".segment-btn").forEach(b => {
        const active = b === btn;
        b.classList.toggle("active", active);
        b.setAttribute("aria-selected", String(active));
      });
      document.getElementById("panel-stats").classList.toggle("hidden", btn.dataset.panel !== "panel-stats");
      document.getElementById("panel-badges").classList.toggle("hidden", btn.dataset.panel !== "panel-badges");
    })
  );

  function renderStats() {
    // サマリー
    const learnedDays = Object.keys(state.activity).length;
    const rate = state.totals.answered > 0
      ? Math.round((state.totals.correct / state.totals.answered) * 100) : 0;
    const summary = [
      { value: learnedDays, label: "学習日数" },
      { value: `${state.streak.count}日`, label: "連続学習" },
      { value: state.totals.answered, label: "累計解答" },
      { value: state.totals.correct, label: "累計正解" },
      { value: `${rate}%`, label: "正答率" },
      { value: Object.keys(state.wrong).length, label: "復習待ち" },
    ];
    document.getElementById("stats-summary").innerHTML = summary.map(s =>
      `<div class="stat"><div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div></div>`
    ).join("");

    renderCalendar();

    // 分野別正答率
    renderCatRates();
  }

  // ---------- 学習カレンダー(月別) ----------

  const CAL_MONTHS = 6;          // タブに出す月数(当月含む直近6ヶ月)
  let calSelected = null;        // "YYYY-M"(月は0始まり)。nullなら当月

  function activityLevel(n) {
    return n === 0 ? 0 : n < 5 ? 1 : n < 10 ? 2 : n < 20 ? 3 : 4;
  }

  function renderCalendar() {
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${now.getMonth()}`;
    if (calSelected === null) calSelected = currentKey;

    // 月タブ(当月含む直近6ヶ月)
    const tabsEl = document.getElementById("cal-tabs");
    let tabs = "";
    for (let i = CAL_MONTHS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      tabs += `<button class="cal-tab${key === calSelected ? " active" : ""}" data-key="${key}">${d.getMonth() + 1}月</button>`;
    }
    tabsEl.innerHTML = tabs;
    tabsEl.querySelectorAll(".cal-tab").forEach(btn =>
      btn.addEventListener("click", () => {
        calSelected = btn.dataset.key;
        renderCalendar();
      })
    );

    // カレンダー本体
    const [y, m] = calSelected.split("-").map(Number);
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayKey = todayStr();
    let cells = "";
    for (let i = 0; i < firstDay; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(y, m, day);
      const key = dateStr(date);
      const n = state.activity[key] || 0;
      const cls = [
        "cal-cell", `l${activityLevel(n)}`,
        key === todayKey ? "today" : "",
        date > now ? "future" : "",
      ].filter(Boolean).join(" ");
      cells += `
        <div class="${cls}">
          <span class="cal-day">${day}</span>
          ${n > 0 ? `<span class="cal-count">${n}問</span>` : ""}
        </div>`;
    }
    document.getElementById("cal-grid").innerHTML = cells;

    // 今日の学習量をひとことで
    const todayN = state.activity[todayKey] || 0;
    document.getElementById("cal-today-note").textContent =
      todayN > 0 ? `今日は ${todayN}問 解答しました` : "今日はまだ解答していません";
  }

  function renderCatRates() {
    document.getElementById("stats-cats").innerHTML = QUIZ_DATA.map(cat => {
      const cs = state.catStats[cat.id] || { answered: 0, correct: 0 };
      const pct = cs.answered > 0 ? Math.round((cs.correct / cs.answered) * 100) : 0;
      const detail = cs.answered > 0 ? `${pct}%(${cs.correct}/${cs.answered})` : "未学習";
      return `
        <div class="cat-rate">
          <div class="cat-rate-head">
            <span class="cat-rate-name">${cat.name}</span>
            <span class="cat-rate-value">${detail}</span>
          </div>
          <div class="cat-rate-bar"><div class="cat-rate-fill" style="width:${pct}%;background:${cat.color}"></div></div>
        </div>`;
    }).join("");
  }

  // ---------- 設定画面 ----------

  function renderSettings() {
    document.querySelectorAll("#theme-segment .segment-btn").forEach(b => {
      const active = b.dataset.theme === settings.theme;
      b.classList.toggle("active", active);
      b.setAttribute("aria-checked", String(active));
    });

    const n = Object.keys(state.wrong).length;
    document.getElementById("settings-review-desc").textContent = n > 0
      ? `復習待ちの ${n}問 を空にします。ステージ進捗や記録は残ります。`
      : "復習待ちはありません。";
    document.getElementById("btn-reset-review").disabled = n === 0;
  }

  document.getElementById("btn-settings").addEventListener("click", () => {
    renderSettings();
    show("screen-settings");
  });
  document.getElementById("btn-settings-back").addEventListener("click", () => {
    show("screen-home");
    render();
  });

  document.querySelectorAll("#theme-segment .segment-btn").forEach(btn =>
    btn.addEventListener("click", () => {
      settings.theme = btn.dataset.theme;
      saveSettings();
      applyTheme();
      renderSettings();
    })
  );

  // リセット確認モーダル(実行内容を差し替えて共用)
  const resetOverlay = document.getElementById("reset-overlay");
  let resetAction = null;

  function confirmReset(title, desc, action) {
    document.getElementById("reset-title").textContent = title;
    document.getElementById("reset-desc").textContent = desc;
    resetAction = action;
    resetOverlay.classList.remove("hidden");
  }

  document.getElementById("btn-reset-cancel").addEventListener("click", () => {
    resetOverlay.classList.add("hidden");
    resetAction = null;
  });
  document.getElementById("btn-reset-confirm").addEventListener("click", () => {
    resetOverlay.classList.add("hidden");
    const action = resetAction;
    resetAction = null;
    if (action) action();
  });

  document.getElementById("btn-reset-review").addEventListener("click", () =>
    confirmReset(
      "復習リストをリセットしますか?",
      "復習待ちの問題がすべて消えます。この操作は取り消せません。",
      () => {
        state.wrong = {};
        saveState();
        render();
        renderSettings();
        toast("復習リストをリセットしました");
      }
    )
  );

  document.getElementById("btn-reset-all").addEventListener("click", () =>
    confirmReset(
      "学習状況をすべてリセットしますか?",
      "レベル・進捗・実績・学習記録などすべてのデータが消えます。この操作は取り消せません。",
      () => {
        state = defaultState();
        saveState();
        ensureDaily();
        render();
        renderSettings();
        toast("学習状況をリセットしました");
      }
    )
  );

  // ---------- 共通イベント ----------

  document.getElementById("btn-start").addEventListener("click", () => startToday());
  document.getElementById("btn-review").addEventListener("click", () => startReview());
  document.getElementById("btn-review-start").addEventListener("click", () => startReview());
  document.getElementById("btn-stages-back").addEventListener("click", () => {
    renderMap();
    show("screen-map");
  });

  // クイズ中断(アプリ内モーダル)
  const quitOverlay = document.getElementById("quit-overlay");
  document.getElementById("btn-quiz-quit").addEventListener("click", () => {
    quitOverlay.classList.remove("hidden");
  });
  document.getElementById("btn-quit-cancel").addEventListener("click", () => {
    quitOverlay.classList.add("hidden");
  });
  document.getElementById("btn-quit-confirm").addEventListener("click", () => {
    quitOverlay.classList.add("hidden");
    closeSheet();
    if (quiz && quiz.mode !== "stage") {
      show("screen-home");
      render();
    } else {
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
    renderReview();
    renderStats();
    renderBadges();
    updateNavBadge();
  }

  // ---------- 起動 ----------

  applyTheme();
  ensureDaily();
  render();
  show("screen-home");

  // PWA: Service Worker登録(http(s)配信時のみ)
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* 登録失敗時は通常動作 */ });
  }
})();
