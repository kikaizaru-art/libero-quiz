// リベロクイズ — ゲームロジック
// XP・レベル・ストリーク・デイリーミッション・実績バッジ / localStorage永続化

(() => {
  "use strict";

  const STORAGE_KEY = "libero-quiz-save-v1";
  const XP_PER_CORRECT = 10;
  const COMBO_BONUS = 2;        // 2コンボ目以降、1問ごとに (コンボ数-1)×2 XP
  const CLEAR_BONUS = 20;
  const PERFECT_BONUS = 30;
  const PASS_RATE = 0.6;        // 出題数の6割(切り上げ)正解でクリア(8問なら5問)
  const REVIEW_SIZE = 5;        // 復習1回あたりの出題数
  const SRS_INTERVALS = [1, 3, 7]; // 復習正解ごとの次回出題までの間隔(日)。全区間を終えた次の正解で克服
  const REVIEW_PERFECT_BONUS = 15;
  const DAILY_SIZE = 5;         // 「今日の5問」の出題数
  const PRACTICE_SIZE = 5;      // 実践問題1回あたりの出題数
  const DAILY_BONUS = 20;       // 「今日の5問」を初回クリアしたときのボーナスXP
  const FREEZE_MAX = 2;         // ストリークフリーズの最大ストック数
  const FREEZE_EVERY = 7;       // 7日連続ごとにフリーズを1個獲得

  // 実力判定テスト:全分野から初級・中級・上級を5問ずつ、計15問を難易度順に出題して実力を評価
  const EXAM_SIZE_PER_STAGE = 5;              // 各難易度からの出題数
  const EXAM_MAX_PER_CAT = 3;                 // 同一分野の出題上限(偏り防止)
  const EXAM_POINTS = [1, 2, 3];              // 初級1点・中級2点・上級3点(満点30点)
  const EXAM_STAGE_NAMES = ["初級", "中級", "上級"];
  // 上から順に判定する(min はそのランクに必要な最低点)
  const EXAM_RANKS = [
    { rank: "S", min: 30, label: "全問正解。非の打ちどころのない実力です" },
    { rank: "A", min: 26, label: "上級レベルまで対応できる確かな実力です" },
    { rank: "B", min: 20, label: "中級までは安定。上級が伸びしろです" },
    { rank: "C", min: 13, label: "初級は着実。中級を固めていきましょう" },
    { rank: "D", min: 0,  label: "これからが伸びどき。初級から始めましょう" },
  ];
  const EXAM_RANK_BONUS = { S: 60, A: 40, B: 25, C: 10, D: 0 };
  const EXAM_BEST_BONUS = 30;                 // 自己ベスト更新ボーナスXP
  const EXAM_HISTORY_MAX = 10;                // 記録タブに残す挑戦履歴の件数

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
    { id: "streak14",    name: "14日連続学習", desc: "14日連続で学習" },
    { id: "streak30",    name: "30日連続学習", desc: "30日連続で学習" },
    { id: "streak50",    name: "50日連続学習", desc: "50日連続で学習" },
    { id: "streak100",   name: "100日連続学習", desc: "100日連続で学習" },
    { id: "days10",      name: "学習10日", desc: "累計10日学習する" },
    { id: "days30",      name: "学習30日", desc: "累計30日学習する" },
    { id: "days100",     name: "学習100日", desc: "累計100日学習する" },
    { id: "daily7",      name: "日課の芽", desc: "今日の5問を7回クリア" },
    { id: "daily30",     name: "日課の木", desc: "今日の5問を30回クリア" },
    { id: "level5",      name: "レベル5到達", desc: "レベル5に到達" },
    { id: "level10",     name: "レベル10到達", desc: "レベル10に到達" },
    { id: "exam_first",  name: "実力判定テスト初挑戦", desc: "実力判定テストに初めて挑戦" },
    { id: "exam_b",      name: "B評価到達", desc: "実力判定テストでB評価以上を獲得" },
    { id: "exam_a",      name: "A評価到達", desc: "実力判定テストでA評価以上を獲得" },
    { id: "exam_s",      name: "S評価獲得", desc: "実力判定テストでS評価を獲得" },
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
      streak: { count: 0, last: null, freezes: 0 },
      daily: { date: null, clears: 0, correct: 0, combo: 0, claimed: [], todayDone: false },
      badges: [],
      totals: { answered: 0, correct: 0, perfects: 0, maxCombo: 0, clears: 0, reviewMastered: 0, dailyClears: 0 },
      wrong: {},                                   // "catId:stageIdx:qIdx" -> { count, last, step, due }
      seen: {},                                    // "catId:stageIdx:qIdx" -> true(ライブラリ解放済み)
      practiceCleared: {},                         // シナリオのlibTitle -> true(実践問題のクリア済み管理)
      practiceStats: { answered: 0, correct: 0 },  // 実践問題の累計成績(記録画面用)
      catStats: {},                                // catId -> { answered, correct }
      activity: {},                                // "YYYY-MM-DD" -> その日の解答数
      lastStage: null,                             // { catId, stageIdx } 最後に挑戦したステージ
      exam: { best: null, history: [] },           // best: { rank, score, date } / history: 直近の挑戦記録
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
      merged.streak = Object.assign(defaultState().streak, saved.streak || {});
      merged.exam = Object.assign(defaultState().exam, saved.exam || {});
      merged.practiceStats = Object.assign(defaultState().practiceStats, saved.practiceStats || {});
      // 旧データ移行:復習リストにある問題は出会い済みなのでライブラリを解放。
      // SRS導入前のエントリには due / step を補完(今日から復習可能)
      for (const k of Object.keys(merged.wrong)) {
        merged.seen[k] = true;
        const e = merged.wrong[k];
        if (!e.due) { e.due = todayStr(); e.step = 0; }
      }
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
    return {
      theme: "system", // "system" | "light" | "dark"
      welcomed: false, // 初回オンボーディングを表示済みか
    };
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

  function addDaysStr(days) {
    return dateStr(new Date(Date.now() + days * 86400000));
  }

  function daysAgoLabel(dateKey) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const diff = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(y, m - 1, d).getTime()) / 86400000);
    return diff <= 0 ? "今日" : diff === 1 ? "昨日" : `${diff}日前`;
  }

  function ensureDaily() {
    const today = todayStr();
    if (state.daily.date !== today) {
      state.daily = { date: today, clears: 0, correct: 0, combo: 0, claimed: [], todayDone: false };
      saveState();
    }
  }

  function touchStreak() {
    const today = todayStr();
    if (state.streak.last === today) return;
    const yStr = dateStr(new Date(Date.now() - 86400000));
    const y2Str = dateStr(new Date(Date.now() - 2 * 86400000));
    if (state.streak.last === yStr) {
      state.streak.count++;
    } else if (state.streak.last === y2Str && state.streak.freezes > 0) {
      // 1日空いたが、フリーズを消費して連続記録を維持
      state.streak.freezes--;
      state.streak.count++;
      toast("フリーズが連続記録を守りました");
    } else {
      state.streak.count = 1;
    }
    state.streak.last = today;
    if (state.streak.count % FREEZE_EVERY === 0 && state.streak.freezes < FREEZE_MAX) {
      state.streak.freezes++;
      toast(`${state.streak.count}日連続達成!フリーズを1個獲得(1日休んでも記録が守られます)`);
    }
    if (state.streak.count >= 3) awardBadge("streak3");
    if (state.streak.count >= 7) awardBadge("streak7");
    if (state.streak.count >= 14) awardBadge("streak14");
    if (state.streak.count >= 30) awardBadge("streak30");
    if (state.streak.count >= 50) awardBadge("streak50");
    if (state.streak.count >= 100) awardBadge("streak100");
  }

  // 表示用の実効ストリーク。昨日まで続いている(またはフリーズで守れる)間は count を維持し、
  // 途切れが確定していれば 0 を返す
  function effectiveStreak() {
    const doneToday = state.streak.last === todayStr();
    const yStr = dateStr(new Date(Date.now() - 86400000));
    const y2Str = dateStr(new Date(Date.now() - 2 * 86400000));
    const alive = doneToday || state.streak.last === yStr ||
      (state.streak.last === y2Str && state.streak.freezes > 0);
    return { count: alive ? state.streak.count : 0, doneToday };
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

    const learnedDays = Object.keys(state.activity).length;
    if (learnedDays >= 10) awardBadge("days10");
    if (learnedDays >= 30) awardBadge("days30");
    if (learnedDays >= 100) awardBadge("days100");
    if (state.totals.dailyClears >= 7) awardBadge("daily7");
    if (state.totals.dailyClears >= 30) awardBadge("daily30");

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

  // 「学習を進める」の行き先を決める(今日の5問とは独立したステージ学習)
  // 1. 前回挑戦したステージが未クリアならその続き
  // 2. 同分野の次の未クリアステージ
  // 3. 全分野を順に見て最初の未クリアステージ
  // 4. すべてクリア済みなら null
  function pickLearnTarget() {
    if (state.lastStage) {
      const cat = QUIZ_DATA.find(c => c.id === state.lastStage.catId);
      if (cat) {
        const i = state.lastStage.stageIdx;
        if (i < cat.stages.length && stageRecord(cat.id, i).stars === 0 && isUnlocked(cat, i)) {
          return { catId: cat.id, stageIdx: i, resumed: true };
        }
        const next = nextStageIn(cat);
        if (next >= 0) return { catId: cat.id, stageIdx: next, resumed: false };
      }
    }
    for (const cat of QUIZ_DATA) {
      const i = nextStageIn(cat);
      if (i >= 0) return { catId: cat.id, stageIdx: i, resumed: false };
    }
    return null;
  }

  // ---------- 「今日の5問」(日替わり・全分野ミックス) ----------

  // 日付文字列から決まる乱数列。同じ日は何度開いても同じ問題セットになる
  function seededRandom(seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
      h ^= seedStr.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return () => {
      h += 0x6D2B79F5;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffleWith(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 今日の5問:日替わりで分野をシャッフルし、5分野から1問ずつ選ぶ
  // ステージ進捗や解放状況とは無関係に全問題から出題する
  // forDate を渡すと任意の日のセットを先読みできる(明日の予告に使用)
  function dailyItems(forDate = todayStr()) {
    const rnd = seededRandom(`daily-${forDate}`);
    const cats = shuffleWith(QUIZ_DATA, rnd).slice(0, DAILY_SIZE);
    const items = cats.map(cat => {
      const pool = [];
      cat.stages.forEach((stage, si) =>
        stage.questions.forEach((_, qi) => pool.push({ catId: cat.id, stageIdx: si, qIdx: qi }))
      );
      return pool[Math.floor(rnd() * pool.length)];
    });
    // 分野数が足りない場合は全問題から補充
    while (items.length < DAILY_SIZE) {
      const all = [];
      QUIZ_DATA.forEach(cat => cat.stages.forEach((stage, si) =>
        stage.questions.forEach((_, qi) => all.push({ catId: cat.id, stageIdx: si, qIdx: qi }))
      ));
      const pick = all[Math.floor(rnd() * all.length)];
      if (!items.some(it => it.catId === pick.catId && it.stageIdx === pick.stageIdx && it.qIdx === pick.qIdx)) {
        items.push(pick);
      }
    }
    return items;
  }

  // その日の「今日の5問」に含まれる分野名(重複除去)
  function dailyCatNames(forDate = todayStr()) {
    return [...new Set(dailyItems(forDate).map(it => QUIZ_DATA.find(c => c.id === it.catId).name))];
  }

  // ---------- 画面遷移 ----------

  const screens = document.querySelectorAll(".screen");
  const navItems = document.querySelectorAll(".nav-item");

  function show(screenId) {
    screens.forEach(s => s.classList.toggle("active", s.id === screenId));
    navItems.forEach(n => n.classList.toggle("active", n.dataset.screen === screenId));
    const navScreens = ["screen-home", "screen-map", "screen-stages", "screen-review", "screen-library", "screen-stats", "screen-settings"];
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
    ensureDaily();
    // 今日の5問クリア後は主CTAカードを小さな完了帯に畳み、
    // 一語りと学習メニューを画面の上へ繰り上げる
    const done = state.daily.todayDone;
    document.getElementById("home-today-card").classList.toggle("hidden", done);
    document.getElementById("today-done-card").classList.toggle("hidden", !done);

    if (done) {
      const names = dailyCatNames(dateStr(new Date(Date.now() + 86400000)));
      document.getElementById("today-done-sub").textContent =
        `タップでもう一度挑戦 ・ 明日は ${names.join("・")} から出題`;
      return;
    }

    document.getElementById("today-desc").textContent =
      `いろいろな分野から日替わりで5問出題(今日は ${dailyCatNames().join("・")})`;

    // 連続記録のフック:今日まだ学習していなければ「つなぐ」動機を見せる
    const hook = document.getElementById("today-hook");
    const s = effectiveStreak();
    if (!s.doneToday && s.count > 0) {
      hook.textContent = `今日学習すれば連続${s.count + 1}日目`;
      hook.classList.remove("hidden");
    } else {
      hook.classList.add("hidden");
    }
  }

  // 今週の学習ドット(日曜はじまり。記録タブのカレンダーと同じ並び)
  function renderWeekStrip() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const labels = ["日", "月", "火", "水", "木", "金", "土"];
    const todayKey = todayStr();
    let html = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = dateStr(d);
      const done = (state.activity[key] || 0) > 0;
      const cls = [
        "week-day",
        done ? "done" : "",
        key === todayKey ? "today" : "",
        d > now ? "future" : "",
      ].filter(Boolean).join(" ");
      html += `
        <div class="${cls}">
          <span class="week-day-label">${labels[i]}</span>
          <span class="week-day-dot">${done ? "✓" : ""}</span>
        </div>`;
    }
    document.getElementById("week-strip").innerHTML = html;
  }

  // 「学習メニュー」カード:次の行動(復習・続きのステージ・実践・実力判定)を1枚のリストに集約
  // 並びは優先度順。説明文は持たせず「ラベル+補足+シェブロン」の行で統一する
  function renderContinueCard() {
    const rows = [];

    const reviewCount = dueWrongKeys().length;
    if (reviewCount > 0) {
      rows.push({ label: "今日の復習", sub: `${reviewCount}問`, accent: true, onTap: () => startReview() });
    }

    const t = pickLearnTarget();
    if (t) {
      const cat = QUIZ_DATA.find(c => c.id === t.catId);
      rows.push({
        label: `${cat.name} ${cat.stages[t.stageIdx].name}`,
        sub: t.resumed ? "続きから" : "次のステージ",
        onTap: () => startQuiz(t.catId, t.stageIdx),
      });
    }

    const practiceCount = unlockedScenarios().length;
    if (practiceCount > 0) {
      const cleared = Math.min(Object.keys(state.practiceCleared).length, SCENARIO_DATA.length);
      rows.push({
        label: "実践問題",
        // 全問解放前は「挑戦できる数がまだ限られている」ことを見せる
        sub: practiceCount < SCENARIO_DATA.length
          ? `挑戦可能 ${practiceCount}/${SCENARIO_DATA.length}問`
          : cleared >= SCENARIO_DATA.length ? "全問クリア ・ 再挑戦" : `クリア ${cleared}/${SCENARIO_DATA.length}問`,
        onTap: startPractice,
      });
    }

    const lastExam = state.exam.history[0];
    rows.push({
      label: "実力判定テスト",
      sub: state.exam.best
        ? `最高評価 ${state.exam.best.rank}${lastExam ? ` ・ 前回 ${daysAgoLabel(lastExam.date)}` : ""}`
        : "未挑戦",
      onTap: startExam,
    });

    const list = document.getElementById("continue-list");
    list.innerHTML = "";
    for (const r of rows) {
      const btn = document.createElement("button");
      btn.className = "continue-item";
      btn.innerHTML = `
        <span class="continue-label">${r.label}</span>
        <span class="continue-sub${r.accent ? " accent" : ""}">${r.sub}</span>
        <span class="library-item-chev" aria-hidden="true">›</span>`;
      btn.addEventListener("click", r.onTap);
      list.appendChild(btn);
    }
  }

  function renderHome() {
    ensureDaily();
    const info = levelInfo(state.xp);
    document.getElementById("home-level").textContent = info.level;
    // ストリークピル:今日学習済みなら点灯、未学習ならグレー表示
    const s = effectiveStreak();
    const pill = document.getElementById("home-streak");
    pill.textContent = `連続 ${s.count}日` +
      (state.streak.freezes > 0 ? ` ・ フリーズ×${state.streak.freezes}` : "");
    pill.classList.toggle("lit", s.doneToday);
    document.getElementById("home-xp-fill").style.width = `${(info.current / info.needed) * 100}%`;
    document.getElementById("home-xp-text").textContent = `${info.current} / ${info.needed} XP`;

    renderWeekStrip();
    renderToday();
    renderContinueCard();

    // 本日の目標(1行サマリー+タップ展開)
    const doneCount = MISSIONS.filter(m => state.daily.claimed.includes(m.id)).length;
    document.getElementById("missions-count").textContent = `${doneCount}/${MISSIONS.length} 達成`;
    document.getElementById("missions-dots").innerHTML =
      MISSIONS.map(m => `<i class="m-dot${state.daily.claimed.includes(m.id) ? " done" : ""}"></i>`).join("");

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

    renderTalkCard();
  }

  // ---------- 「今日の一語り」(解放済みカードの日替わり再提示) ----------

  // 使いどころ付きで解放済みのカードから、日付で決まる1件を選ぶ
  function talkPick() {
    const pool = [];
    QUIZ_DATA.forEach(cat => cat.stages.forEach((stage, si) =>
      stage.questions.forEach((q, qi) => {
        if (state.seen[`${cat.id}:${si}:${qi}`] && q.lib.use) pool.push({ cat, q });
      })
    ));
    if (pool.length === 0) return null;
    const rnd = seededRandom(`talk-${todayStr()}`);
    return pool[Math.floor(rnd() * pool.length)];
  }

  function renderTalkCard() {
    const card = document.getElementById("home-talk-card");
    const pick = talkPick();
    card.classList.toggle("hidden", !pick);
    if (!pick) return;
    document.getElementById("talk-title").innerHTML =
      `<span class="library-item-cat" style="background:${pick.cat.color}">${pick.cat.name}</span>${pick.q.lib.title}`;
    document.getElementById("talk-use").textContent = pick.q.lib.use;
  }

  // カード全体がタップ領域(ライブラリ詳細を開く)
  document.getElementById("home-talk-card").addEventListener("click", () => {
    const pick = talkPick();
    if (pick) openLibEntry(pick.cat, pick.q);
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

  // mode: "stage"(通常) | "review"(復習) | "daily"(今日の5問) | "exam"(実力判定テスト) | "practice"(実践問題)
  // items: [{ catId, stageIdx, qIdx }] または実践問題の [{ scenarioIdx }]
  let quiz = null; // { mode, catId, stageIdx, items, index, correct, combo, maxCombo, xp, mastered, wrongList, score, stageCorrect, catLost }

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
      // 実力判定テスト用:難易度加重スコアと内訳(他モードでは未使用)
      score: 0, stageCorrect: [0, 0, 0], catLost: {},
    };
  }

  // ---------- 進行中クイズの自動保存 ----------
  // 解答のたびに保存し、終了・中断で消す。モバイルでタブがOSに落とされても
  // 「続きから再開」できるようにする(再開時は次の未解答の問題から)

  const PROGRESS_KEY = "libero-quiz-progress-v1";

  function saveQuizProgress(nextIndex) {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(Object.assign({}, quiz, { index: nextIndex })));
    } catch { /* プライベートモード等では保存不可 */ }
  }

  function clearQuizProgress() {
    try { localStorage.removeItem(PROGRESS_KEY); } catch { /* noop */ }
  }

  // 保存された進行を検証して返す。データ更新で問題が消えていたら破棄する
  function loadQuizProgress() {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      const valid = saved && Array.isArray(saved.items) && saved.items.length > 0 &&
        saved.items.every(it => {
          try { return !!questionAt(it); } catch { return false; }
        });
      if (!valid) clearQuizProgress();
      return valid ? saved : null;
    } catch {
      return null;
    }
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

  // 今日出題対象の復習キー(次回出題日 due が今日以前のもの)
  function dueWrongKeys(catId) {
    const today = todayStr();
    let keys = Object.keys(state.wrong).filter(k => (state.wrong[k].due || today) <= today);
    if (catId) keys = keys.filter(k => k.startsWith(catId + ":"));
    return keys;
  }

  // catId を渡すとその分野の復習待ちだけから出題する(復習画面の分野ピル用)
  function startReview(catId) {
    const keys = shuffle(dueWrongKeys(catId)).slice(0, REVIEW_SIZE);
    if (keys.length === 0) return;
    const items = keys.map(k => {
      const [catId, stageIdx, qIdx] = k.split(":");
      return { catId, stageIdx: Number(stageIdx), qIdx: Number(qIdx) };
    });
    quiz = newQuiz("review", null, null, items);
    show("screen-quiz");
    renderQuestion();
  }

  // 「今日の5問」開始:日替わりセットを毎回シャッフルして出題
  function startDaily() {
    quiz = newQuiz("daily", null, null, shuffle(dailyItems()));
    show("screen-quiz");
    renderQuestion();
  }

  // ---------- 実力判定テスト(全問ランダムの実力テスト) ----------

  // 初級→中級→上級の順に各5問。各層内はランダムで、同一分野は全体で最大3問まで
  function examItems() {
    const catCount = {};
    const items = [];
    for (let si = 0; si < EXAM_STAGE_NAMES.length; si++) {
      const pool = [];
      QUIZ_DATA.forEach(cat => {
        if (!cat.stages[si]) return;
        cat.stages[si].questions.forEach((_, qi) => pool.push({ catId: cat.id, stageIdx: si, qIdx: qi }));
      });
      const shuffled = shuffle(pool);
      let picked = 0;
      for (const it of shuffled) {
        if (picked >= EXAM_SIZE_PER_STAGE) break;
        if ((catCount[it.catId] || 0) >= EXAM_MAX_PER_CAT) continue;
        catCount[it.catId] = (catCount[it.catId] || 0) + 1;
        items.push(it);
        picked++;
      }
      // 保険:分野上限で埋まらない場合は制約なしで補充
      for (const it of shuffled) {
        if (picked >= EXAM_SIZE_PER_STAGE) break;
        if (items.includes(it)) continue;
        items.push(it);
        picked++;
      }
    }
    return items;
  }

  function examMaxScore() {
    return EXAM_POINTS.reduce((a, p) => a + p * EXAM_SIZE_PER_STAGE, 0);
  }

  function examRankFor(score) {
    return EXAM_RANKS.find(r => score >= r.min);
  }

  function startExam() {
    quiz = newQuiz("exam", null, null, examItems());
    show("screen-quiz");
    renderQuestion();
  }

  function questionAt(item) {
    if (item.scenarioIdx !== undefined) return SCENARIO_DATA[item.scenarioIdx];
    const cat = QUIZ_DATA.find(c => c.id === item.catId);
    return cat.stages[item.stageIdx].questions[item.qIdx];
  }

  // ---------- 実践問題(シナリオ問題) ----------

  // シナリオの解放判定:対応する知識カードを解放済み、または対応カードと同じ
  // 分野・ステージのカードを1枚でも解放していれば挑戦できる
  // (厳密に1問=1カード対応だと、学習初期は挑戦可能数が数問に留まり
  //  「毎回同じ問題しか出ない」状態になるため、難易度帯単位に緩和)
  function unlockedScenarios() {
    return SCENARIO_DATA
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => {
        const e = TITLE_INDEX[s.libTitle];
        if (!e) return false;
        if (state.seen[e.key]) return true;
        const [catId, si] = e.key.split(":");
        return e.cat.stages[Number(si)].questions
          .some((_, qi) => state.seen[`${catId}:${si}:${qi}`]);
      });
  }

  function startPractice() {
    const pool = unlockedScenarios();
    if (pool.length === 0) return;
    // 未クリアのシナリオを優先して出題し、消化が進むようにする
    const fresh = shuffle(pool.filter(({ s }) => !state.practiceCleared[s.libTitle]));
    const done = shuffle(pool.filter(({ s }) => state.practiceCleared[s.libTitle]));
    const items = shuffle(fresh.concat(done).slice(0, PRACTICE_SIZE)).map(({ i }) => ({ scenarioIdx: i }));
    quiz = newQuiz("practice", null, null, items);
    show("screen-quiz");
    renderQuestion();
  }

  function currentQuestion() {
    return questionAt(quiz.items[quiz.index]);
  }

  // 解説ボトムシート
  const sheet = document.getElementById("explanation");
  function openSheet() { sheet.classList.add("open"); }
  function closeSheet() { sheet.classList.remove("open"); }

  function renderQuestion() {
    saveQuizProgress(quiz.index); // 出題のたびに進行を保存(開始直後も含む)
    const item = quiz.items[quiz.index];
    const q = currentQuestion();
    const cat = QUIZ_DATA.find(c => c.id === (item.scenarioIdx !== undefined ? q.catId : item.catId));
    const total = quiz.items.length;

    closeSheet();

    document.getElementById("quiz-progress-fill").style.width = `${(quiz.index / total) * 100}%`;
    document.getElementById("quiz-progress-text").textContent = `${quiz.index + 1}/${total}`;
    const metaPrefix = quiz.mode === "review" ? `復習(${cat.name})`
      : quiz.mode === "daily" ? `今日の5問(${cat.name})`
      : quiz.mode === "exam" ? `実力判定テスト ${cat.stages[item.stageIdx].name}(${cat.name})`
      : quiz.mode === "practice" ? `実践問題(${cat.name})`
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
    const buildChoices = () => {
      choicesEl.innerHTML = "";
      order.forEach(choiceIdx => {
        const btn = document.createElement("button");
        btn.className = "choice";
        btn.dataset.index = choiceIdx;
        btn.textContent = q.choices[choiceIdx];
        btn.addEventListener("click", () => answer(choiceIdx, btn));
        choicesEl.appendChild(btn);
      });
    };
    if (quiz.mode === "review") {
      // 想起チェック:選択肢を見る前に自力で思い出す1クッション(テスト効果)
      const cover = document.createElement("button");
      cover.className = "recall-cover";
      cover.innerHTML = `
        <span class="recall-cover-title">まず、頭の中で答えてみましょう</span>
        <span class="recall-cover-sub">思い出せたらタップして選択肢を表示</span>`;
      cover.addEventListener("click", buildChoices);
      choicesEl.appendChild(cover);
    } else {
      buildChoices();
    }
  }

  function answer(choiceIdx, clickedBtn) {
    const q = currentQuestion();
    const item = quiz.items[quiz.index];
    // 実践問題は進捗キー(catId:stageIdx:qIdx)を持たないため、seen・復習リスト・分野別成績には触れない
    const isScenario = item.scenarioIdx !== undefined;
    const wrongKey = isScenario ? null : `${item.catId}:${item.stageIdx}:${item.qIdx}`;
    const isCorrect = choiceIdx === q.answer;
    const buttons = document.querySelectorAll("#choices .choice");
    buttons.forEach(b => {
      b.disabled = true;
      if (Number(b.dataset.index) === q.answer) b.classList.add("correct");
      else if (b !== clickedBtn) b.classList.add("dim");
    });

    state.totals.answered++;
    if (isScenario) {
      state.practiceStats.answered++;
      if (isCorrect) {
        state.practiceStats.correct++;
        state.practiceCleared[q.libTitle] = true; // クリア済み管理(進捗表示と未挑戦優先の出題に使う)
      }
    }
    if (!isScenario) {
      state.seen[wrongKey] = true; // 出会った問題はライブラリに解放

      // 分野別成績(記録画面用)
      const cs = state.catStats[item.catId] || (state.catStats[item.catId] = { answered: 0, correct: 0 });
      cs.answered++;
      if (isCorrect) cs.correct++;
    }
    const today = todayStr();
    state.activity[today] = (state.activity[today] || 0) + 1;

    // 実力判定テストの採点:難易度加重(初級1点・中級2点・上級3点)。失点は分野別に記録
    if (quiz.mode === "exam") {
      const pts = EXAM_POINTS[item.stageIdx] || 1;
      if (isCorrect) {
        quiz.score += pts;
        quiz.stageCorrect[item.stageIdx]++;
      } else {
        quiz.catLost[item.catId] = (quiz.catLost[item.catId] || 0) + pts;
      }
    }

    // 復習リストの更新(間隔反復):正解するたび次回出題を 1日→3日→7日後と延ばし、
    // 全区間を終えた次の正解で克服(除去)。間違えたら区間を最初に戻す(実践問題は対象外)
    if (isCorrect) {
      if (!isScenario && state.wrong[wrongKey]) {
        const entry = state.wrong[wrongKey];
        const step = entry.step || 0;
        if (step >= SRS_INTERVALS.length) {
          delete state.wrong[wrongKey];
          if (quiz.mode === "review") {
            quiz.mastered++;
            state.totals.reviewMastered++;
          }
        } else {
          entry.due = addDaysStr(SRS_INTERVALS[step]);
          entry.step = step + 1;
        }
      }
    } else {
      if (!isScenario) {
        const entry = state.wrong[wrongKey] || { count: 0, last: null };
        entry.count++;
        entry.last = today;
        entry.step = 0;
        entry.due = today;
        state.wrong[wrongKey] = entry;
      }
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

    // 使いどころ(この知識が活きる場面。データがある問題のみ表示)
    const useWrap = document.getElementById("explanation-use");
    if (q.lib && q.lib.use) {
      document.getElementById("explanation-use-text").textContent = q.lib.use;
      useWrap.classList.remove("hidden");
    } else {
      useWrap.classList.add("hidden");
    }

    // 「もっと知る」コラム(タップで展開。ライブラリにも収録)
    // 実践問題では元になった知識カード(libTitle)のコラムを出し、知識との紐づきを示す
    const lib = q.lib || (q.libTitle && TITLE_INDEX[q.libTitle] ? TITLE_INDEX[q.libTitle].q.lib : null);
    const moreWrap = document.getElementById("explanation-more");
    if (lib && lib.more) {
      document.getElementById("btn-more").textContent = `もっと知る:${lib.title}`;
      document.getElementById("explanation-more-text").textContent = lib.more;
      setMoreOpen(false);
      moreWrap.classList.remove("hidden");
    } else {
      moreWrap.classList.add("hidden");
    }

    document.getElementById("btn-next").textContent =
      quiz.index + 1 < quiz.items.length ? "次へ" : "結果を見る";
    openSheet();

    document.getElementById("quiz-progress-fill").style.width =
      `${((quiz.index + 1) / quiz.items.length) * 100}%`;

    saveState();
    // 解答済みとして保存。解説表示中に落ちても同じ問題を二重集計しない
    saveQuizProgress(quiz.index + 1);
  }

  // 「もっと知る」の開閉
  function setMoreOpen(open) {
    document.getElementById("explanation-more-text").classList.toggle("hidden", !open);
    const btn = document.getElementById("btn-more");
    btn.setAttribute("aria-expanded", String(open));
    btn.classList.toggle("open", open);
  }

  document.getElementById("btn-more").addEventListener("click", () => {
    setMoreOpen(document.getElementById("explanation-more-text").classList.contains("hidden"));
  });

  document.getElementById("btn-next").addEventListener("click", () => {
    quiz.index++;
    if (quiz.index < quiz.items.length) renderQuestion();
    else finishQuiz();
  });

  // ---------- リザルト ----------

  function passLineFor(total) {
    return Math.ceil(total * PASS_RATE);
  }

  function starsFor(correct, total) {
    if (correct >= total) return 3;
    if (correct >= total - 1) return 2;
    if (correct >= passLineFor(total)) return 1;
    return 0;
  }

  function renderResultXp(earnedXp) {
    document.getElementById("result-xp").textContent = `+${earnedXp} XP`;
    const info = levelInfo(state.xp);
    document.getElementById("result-xp-fill").style.width = `${(info.current / info.needed) * 100}%`;
    document.getElementById("result-xp-text").textContent =
      `Lv.${info.level} ・ 次のレベルまで あと${info.needed - info.current}XP`;
  }

  // その日最初の学習完了なら、連続日数を大きく見せて祝う
  function renderStreakResult(firstToday) {
    const el = document.getElementById("result-streak");
    el.classList.toggle("hidden", !firstToday);
    if (firstToday) el.textContent = `連続${state.streak.count}日目!`;
  }

  // 今日の5問のリザルトで明日の出題分野を予告する(明日また開く理由づくり)
  function renderTomorrow(showIt) {
    const el = document.getElementById("result-tomorrow");
    el.classList.toggle("hidden", !showIt);
    if (showIt) {
      const names = dailyCatNames(dateStr(new Date(Date.now() + 86400000)));
      el.textContent = `明日の5問は ${names.join("・")} から出題。また明日ここで会いましょう`;
    }
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
      : quiz.mode === "practice"
      ? "実践問題は復習リストには入りません。関連する知識カードをライブラリで見返しておきましょう。"
      : "間違えた問題は復習リストに追加しました。復習タブからいつでも挑戦できます。";
  }

  // 復習・今日の5問のリザルト(ステージ記録なし)
  function finishLight(mode) {
    const total = quiz.items.length;
    let earnedXp = quiz.xp;
    if (quiz.correct === total) earnedXp += REVIEW_PERFECT_BONUS;

    // 今日の5問:その日の初回クリアにボーナス
    let dailyFirst = false;
    if (mode === "daily") {
      ensureDaily();
      if (!state.daily.todayDone) {
        state.daily.todayDone = true;
        dailyFirst = true;
        state.totals.dailyClears++;
        earnedXp += DAILY_BONUS;
      }
    }

    const firstStudyToday = state.streak.last !== todayStr();
    touchStreak();
    gainXp(earnedXp);
    checkMissions();
    checkCollectionBadges();
    saveState();

    document.getElementById("result-title").textContent =
      mode === "review" ? "復習完了" : mode === "practice" ? "実践問題 完了" : "今日の5問 完了";
    document.getElementById("result-stars").classList.add("hidden");
    document.getElementById("result-rank").classList.add("hidden");
    document.getElementById("result-exam-detail").classList.add("hidden");
    document.getElementById("result-score").textContent =
      `${total}問中 ${quiz.correct}問正解` +
      (mode === "review" && quiz.mastered > 0 ? ` ・ ${quiz.mastered}問を克服` : "") +
      (mode === "practice" ? ` ・ 実践問題 ${Math.min(Object.keys(state.practiceCleared).length, SCENARIO_DATA.length)}/${SCENARIO_DATA.length}問クリア` +
        (unlockedScenarios().length < SCENARIO_DATA.length
          ? `(挑戦可能 ${unlockedScenarios().length}問 ・ 学習を進めると増えます)` : "") : "") +
      (dailyFirst ? ` ・ 初回クリアボーナス +${DAILY_BONUS}XP` : "");
    renderResultXp(earnedXp);
    renderStreakResult(firstStudyToday);
    renderTomorrow(mode === "daily");
    renderRecap();

    const btnRetry = document.getElementById("btn-retry");
    if (mode === "review") {
      const remaining = dueWrongKeys().length;
      btnRetry.classList.toggle("hidden", remaining === 0);
      btnRetry.textContent = "続けて復習";
      btnRetry.onclick = () => startReview();
    } else if (mode === "practice") {
      btnRetry.classList.remove("hidden");
      btnRetry.textContent = "もう一度挑戦";
      btnRetry.onclick = () => startPractice();
    } else {
      btnRetry.classList.remove("hidden");
      btnRetry.textContent = "もう一度挑戦";
      btnRetry.onclick = () => startDaily();
    }
    const btnContinue = document.getElementById("btn-continue");
    btnContinue.textContent = "ホームへ";
    btnContinue.onclick = () => { show("screen-home"); render(); };

    show("screen-result");
  }

  // 実力判定テストのリザルト:評価(ランク)・内訳・次の評価までの距離を表示
  function finishExam() {
    const total = quiz.items.length;
    const maxScore = examMaxScore();
    const rankDef = examRankFor(quiz.score);
    const rank = rankDef.rank;
    let earnedXp = quiz.xp + EXAM_RANK_BONUS[rank];

    // 自己ベスト更新(評価が上、または同評価でスコアが上なら更新)
    const rankIdx = r => EXAM_RANKS.findIndex(d => d.rank === r); // 小さいほど上位
    const prev = state.exam.best;
    const improved = !prev || rankIdx(rank) < rankIdx(prev.rank) ||
      (rank === prev.rank && quiz.score > prev.score);
    const bestUpdated = improved && !!prev;
    if (improved) state.exam.best = { rank, score: quiz.score, date: todayStr() };
    if (bestUpdated) {
      earnedXp += EXAM_BEST_BONUS;
      toast(`自己ベスト更新:${rank}評価 +${EXAM_BEST_BONUS}XP`);
    }

    state.exam.history.unshift({ rank, score: quiz.score, date: todayStr() });
    state.exam.history = state.exam.history.slice(0, EXAM_HISTORY_MAX);

    awardBadge("exam_first");
    if (rankIdx(rank) <= rankIdx("B")) awardBadge("exam_b");
    if (rankIdx(rank) <= rankIdx("A")) awardBadge("exam_a");
    if (rank === "S") awardBadge("exam_s");

    const firstStudyToday = state.streak.last !== todayStr();
    touchStreak();
    gainXp(earnedXp);
    checkMissions();
    checkCollectionBadges();
    saveState();

    // 画面描画
    document.getElementById("result-title").textContent = "実力判定テスト 結果";
    document.getElementById("result-stars").classList.add("hidden");
    const rankEl = document.getElementById("result-rank");
    rankEl.classList.remove("hidden");
    const letter = document.getElementById("result-rank-letter");
    letter.textContent = rank;
    letter.className = `result-rank-letter rank-${rank.toLowerCase()}`;
    document.getElementById("result-rank-label").textContent = rankDef.label;
    document.getElementById("result-score").textContent =
      `${maxScore}点満点中 ${quiz.score}点(${total}問中${quiz.correct}問正解)`;
    renderResultXp(earnedXp);
    renderStreakResult(firstStudyToday);
    renderTomorrow(false);

    // 内訳(難易度別の正解数)と、次の評価に向けたヒント
    document.getElementById("result-exam-detail").classList.remove("hidden");
    document.getElementById("exam-stage-breakdown").innerHTML =
      EXAM_STAGE_NAMES.map((name, si) => {
        const stageTotal = quiz.items.filter(it => it.stageIdx === si).length;
        return `
          <div class="exam-stage-row">
            <span class="exam-stage-name">${name}(1問${EXAM_POINTS[si]}点)</span>
            <span class="exam-stage-count">${quiz.stageCorrect[si]}/${stageTotal}問正解</span>
          </div>`;
      }).join("");
    let hint;
    if (rank === "S") {
      hint = "最高評価です。この実力を維持できるか、また挑戦してみましょう。";
    } else {
      const next = EXAM_RANKS[EXAM_RANKS.indexOf(rankDef) - 1];
      hint = `${next.rank}評価まであと${next.min - quiz.score}点。`;
      const worst = Object.entries(quiz.catLost).sort((a, b) => b[1] - a[1])[0];
      if (worst) {
        const catName = QUIZ_DATA.find(c => c.id === worst[0]).name;
        hint += `今回は「${catName}」での失点が最多でした。ステージ学習と復習で鍛えて再挑戦しましょう。`;
      }
    }
    document.getElementById("exam-next-hint").textContent = hint;
    renderRecap();

    const btnRetry = document.getElementById("btn-retry");
    btnRetry.classList.remove("hidden");
    btnRetry.textContent = "もう一度挑戦";
    btnRetry.onclick = () => startExam();
    const btnContinue = document.getElementById("btn-continue");
    btnContinue.textContent = "ホームへ";
    btnContinue.onclick = () => { show("screen-home"); render(); };

    show("screen-result");
  }

  function finishQuiz() {
    closeSheet();
    clearQuizProgress();
    if (quiz.mode === "exam") { finishExam(); return; }
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

    let firstStudyToday = false;
    if (cleared) {
      state.totals.clears++;
      if (perfect) state.totals.perfects++;
      ensureDaily();
      state.daily.clears++;
      firstStudyToday = state.streak.last !== todayStr();
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
    document.getElementById("result-rank").classList.add("hidden");
    document.getElementById("result-exam-detail").classList.add("hidden");
    starsEl.innerHTML =
      [1, 2, 3].map(i => `<span class="star${i <= stars ? " earned" : ""}">★</span>`).join("");
    document.getElementById("result-score").textContent =
      `${total}問中 ${quiz.correct}問正解 ・ 最大${quiz.maxCombo}問連続正解` +
      (cleared ? "" : ` (${passLineFor(total)}問正解でクリア)`);
    renderResultXp(earnedXp);
    renderStreakResult(firstStudyToday);
    renderTomorrow(false);
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

  let reviewListOpen = false; // 苦手リストの展開状態(セッション内のみ)

  // 明日以降に控えている復習の、いちばん近い日付と件数
  function nextReviewInfo() {
    const today = todayStr();
    let best = null;
    for (const k of Object.keys(state.wrong)) {
      const due = state.wrong[k].due || today;
      if (due <= today) continue;
      if (!best || due < best.date) best = { date: due, count: 1 };
      else if (due === best.date) best.count++;
    }
    return best;
  }

  function formatDateKey(key) {
    const [, m, d] = key.split("-").map(Number);
    return `${m}月${d}日`;
  }

  function renderReview() {
    const keys = Object.keys(state.wrong);
    const total = keys.length;
    const due = dueWrongKeys();
    const n = due.length;

    document.getElementById("review-sub").textContent = total > 0
      ? "正解するたび次の復習が先に延び、繰り返し正解で克服です"
      : "苦手をなくして知識を定着させましょう";

    const card = document.getElementById("review-card");
    const emptyCard = document.getElementById("review-empty-card");
    card.classList.toggle("hidden", total === 0);
    emptyCard.classList.toggle("hidden", total > 0);

    if (total === 0) {
      // 空状態:今日の5問が未クリアなら、そのまま始められる導線を出す
      document.getElementById("review-goto-daily").classList.toggle("hidden", state.daily.todayDone);
    } else {
      const btn = document.getElementById("btn-review-start");
      const nextEl = document.getElementById("review-next");
      const pillsEl = document.getElementById("review-cats");
      pillsEl.innerHTML = "";

      if (n > 0) {
        document.getElementById("review-count").textContent = `今日の復習 ${n}問`;
        btn.classList.remove("hidden");
        btn.textContent = `復習する(${Math.min(n, REVIEW_SIZE)}問)`;
        // 後日に回っている分の予告
        nextEl.classList.toggle("hidden", total === n);
        nextEl.textContent = `残り${total - n}問は間隔をあけて後日出題されます`;

        // 分野別の内訳ピル(タップでその分野だけ復習)
        const counts = {};
        due.forEach(k => {
          const catId = k.split(":")[0];
          counts[catId] = (counts[catId] || 0) + 1;
        });
        for (const c of QUIZ_DATA.filter(c => counts[c.id])) {
          const pill = document.createElement("button");
          pill.className = "review-cat-pill";
          pill.innerHTML = `
            <i class="review-cat-dot" style="background:${c.color}" aria-hidden="true"></i>
            <span>${c.name}</span>
            <span class="review-cat-pill-count">${counts[c.id]}</span>`;
          pill.addEventListener("click", () => startReview(c.id));
          pillsEl.appendChild(pill);
        }
      } else {
        // すべて後日に回っている:今日はやることなし
        document.getElementById("review-count").textContent = "今日の復習はありません";
        btn.classList.add("hidden");
        const next = nextReviewInfo();
        nextEl.classList.toggle("hidden", !next);
        if (next) nextEl.textContent =
          `次の復習は ${formatDateKey(next.date)} に ${next.count}問(全${total}問)`;
      }
    }

    // 間違えた回数が多い問題(上位3件+展開。正解はネタバレしない)
    const listCard = document.getElementById("review-list-card");
    listCard.classList.toggle("hidden", total === 0);
    if (total > 0) {
      const entries = keys.map(k => {
        const [catId, si, qi] = k.split(":");
        const cat = QUIZ_DATA.find(c => c.id === catId);
        const q = cat.stages[Number(si)].questions[Number(qi)];
        return { catName: cat.name, text: q.q, count: state.wrong[k].count };
      }).sort((a, b) => b.count - a.count);
      const shown = reviewListOpen ? entries : entries.slice(0, 3);
      document.getElementById("review-list").innerHTML = shown.map(e => `
        <div class="review-item">
          <div class="review-item-q">${e.text.length > 42 ? e.text.slice(0, 42) + "…" : e.text}</div>
          <div class="review-item-meta">${e.catName} ・ ${e.count}回 間違えました</div>
        </div>`).join("");
      const more = document.getElementById("review-list-more");
      more.classList.toggle("hidden", reviewListOpen || entries.length <= 3);
      more.textContent = `すべて見る(${entries.length}問)`;
    }
  }

  // ---------- ライブラリ ----------

  // 使う場面タグ(lib.scenes)の定義。目的起点でカードを逆引きするフィルタに使う
  const LIB_SCENES = [
    { id: "talk",  name: "会話で使う" },
    { id: "idea",  name: "発想に使う" },
    { id: "art",   name: "鑑賞が深まる" },
    { id: "quote", name: "引用できる" },
  ];

  // lib.title から問題を引く索引(related の解決用。title はデータ全体で一意)
  const TITLE_INDEX = {};
  QUIZ_DATA.forEach(cat => cat.stages.forEach((stage, si) =>
    stage.questions.forEach((q, qi) => { TITLE_INDEX[q.lib.title] = { cat, q, key: `${cat.id}:${si}:${qi}` }; })
  ));

  let libSelected = QUIZ_DATA[0].id; // 表示中の分野タブ
  let libScene = "all";              // 表示中の場面フィルタ
  let libQuery = "";                 // 検索文字列(入力中は横断検索を表示)
  const libOpen = {};                // catId → 展開中ステージ番号のSet(セッション内のみ保持)

  // 分野の初期展開ステージ:カードが増える余地のある最初のステージ(全解放なら初級)
  function libOpenFor(cat) {
    if (!libOpen[cat.id]) {
      let idx = cat.stages.findIndex((stage, si) =>
        stage.questions.some((_, qi) => !state.seen[`${cat.id}:${si}:${qi}`]));
      if (idx < 0) idx = 0;
      libOpen[cat.id] = new Set([idx]);
    }
    return libOpen[cat.id];
  }

  // 分野内の各問題の解放状況を集計する
  function libRowsFor(cat) {
    const rows = [];
    cat.stages.forEach((stage, si) => {
      stage.questions.forEach((q, qi) => {
        rows.push({ seen: !!state.seen[`${cat.id}:${si}:${qi}`], q, stageName: stage.name });
      });
    });
    return rows;
  }

  // 出題形式を問わず、一度解答した問題の知識カードが解放される
  function renderLibrary() {
    let total = 0, found = 0;

    // 分野タブ
    const tabsEl = document.getElementById("library-tabs");
    tabsEl.innerHTML = "";
    for (const cat of QUIZ_DATA) {
      const rows = libRowsFor(cat);
      total += rows.length;
      found += rows.filter(r => r.seen).length;
      const btn = document.createElement("button");
      btn.className = `library-tab${cat.id === libSelected ? " active" : ""}`;
      btn.style.setProperty("--cat-color", cat.color);
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(cat.id === libSelected));
      btn.textContent = cat.name;
      btn.addEventListener("click", () => {
        libSelected = cat.id;
        renderLibrary();
      });
      tabsEl.appendChild(btn);
    }

    document.getElementById("library-sub").textContent =
      `集めた知識カード ${found} / ${total}`;

    // 案内文はカードが1枚もないときだけ(空状態の説明として)
    document.getElementById("library-note").classList.toggle("hidden", found > 0);

    // 場面ごとの解放済み件数(ピルに併記して空振りタップを防ぐ)
    const sceneCounts = {};
    QUIZ_DATA.forEach(cat => cat.stages.forEach((stage, si) =>
      stage.questions.forEach((q, qi) => {
        if (!state.seen[`${cat.id}:${si}:${qi}`]) return;
        (q.lib.scenes || []).forEach(s => { sceneCounts[s] = (sceneCounts[s] || 0) + 1; });
      })
    ));

    // 場面フィルタピル(「明日は会食」など目的からカードを逆引きする導線)
    const scenesEl = document.getElementById("library-scenes");
    scenesEl.innerHTML = "";
    for (const sc of [{ id: "all", name: "すべて" }, ...LIB_SCENES]) {
      const btn = document.createElement("button");
      btn.className = `scene-pill${sc.id === libScene ? " active" : ""}`;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(sc.id === libScene));
      btn.textContent = sc.name;
      if (sc.id !== "all") {
        const count = document.createElement("span");
        count.className = "scene-pill-count";
        count.textContent = sceneCounts[sc.id] || 0;
        btn.appendChild(count);
      }
      btn.addEventListener("click", () => {
        libScene = sc.id;
        renderLibrary();
      });
      scenesEl.appendChild(btn);
    }

    // 検索中は場面ピル・分野タブを隠し、解放済みカードの横断検索を出す
    const query = libQuery.trim().toLowerCase();
    scenesEl.classList.toggle("hidden", query.length > 0);
    if (query) {
      tabsEl.classList.add("hidden");
      renderSearchList(query);
      return;
    }

    // 場面で絞り込み中は分野タブを隠し、全分野横断の一覧を出す
    tabsEl.classList.toggle("hidden", libScene !== "all");
    if (libScene !== "all") {
      renderSceneList();
      return;
    }

    // 選択中の分野のみ表示(ステージ別アコーディオン)
    const cat = QUIZ_DATA.find(c => c.id === libSelected) || QUIZ_DATA[0];
    const rows = libRowsFor(cat);
    const list = document.getElementById("library-list");
    list.innerHTML = "";

    const card = document.createElement("div");
    card.className = "card library-cat";
    card.style.setProperty("--cat-color", cat.color);
    card.innerHTML = `
      <div class="library-cat-head">
        <span class="library-cat-name">${cat.name}</span>
        <span class="library-cat-count">${rows.filter(r => r.seen).length}/${rows.length}</span>
      </div>`;

    const open = libOpenFor(cat);
    cat.stages.forEach((stage, si) => {
      const seenQs = [];
      let lockedCount = 0;
      stage.questions.forEach((q, qi) => {
        if (state.seen[`${cat.id}:${si}:${qi}`]) seenQs.push(q); else lockedCount++;
      });

      const isOpen = open.has(si);
      const head = document.createElement("button");
      head.className = "library-stage-head";
      head.setAttribute("aria-expanded", String(isOpen));
      head.innerHTML = `
        <span class="library-stage-name">${stage.name}</span>
        <span class="library-stage-count">${seenQs.length}/${stage.questions.length}</span>
        <span class="library-stage-chev" aria-hidden="true">${isOpen ? "▾" : "›"}</span>`;
      head.addEventListener("click", () => {
        if (isOpen) open.delete(si); else open.add(si);
        renderLibrary();
      });
      card.appendChild(head);
      if (!isOpen) return;

      for (const q of seenQs) {
        const btn = document.createElement("button");
        btn.className = "library-item in-stage";
        btn.innerHTML = `
          <span class="library-item-title">${q.lib.title}</span>
          <span class="library-item-chev" aria-hidden="true">›</span>`;
        btn.addEventListener("click", () => openLibEntry(cat, q));
        card.appendChild(btn);
      }
      // 未解放分は1行に集約(枚数はステージヘッダーの n/8 でも読める)
      if (lockedCount > 0) {
        const div = document.createElement("div");
        div.className = "library-locked-row";
        div.textContent = `未解放 ${lockedCount}枚 — クイズに正解すると集まります`;
        card.appendChild(div);
      }
    });
    list.appendChild(card);
  }

  // 検索結果(全分野横断・解放済みカードのみ。タイトル・問題文・正解に部分一致)
  function renderSearchList(query) {
    const list = document.getElementById("library-list");
    list.innerHTML = "";
    const hits = [];
    QUIZ_DATA.forEach(cat => cat.stages.forEach((stage, si) =>
      stage.questions.forEach((q, qi) => {
        if (!state.seen[`${cat.id}:${si}:${qi}`]) return;
        const haystack = `${q.lib.title} ${q.q} ${q.choices[q.answer]}`.toLowerCase();
        if (haystack.includes(query)) hits.push({ cat, q });
      })
    ));
    const card = document.createElement("div");
    card.className = "card library-cat";
    card.innerHTML = `
      <div class="library-cat-head">
        <span class="library-cat-name">検索結果</span>
        <span class="library-cat-count">${hits.length}件</span>
      </div>`;
    if (hits.length === 0) {
      const p = document.createElement("p");
      p.className = "library-empty";
      p.textContent = "一致する知識カードはありません(解放済みのカードから検索します)";
      card.appendChild(p);
    }
    for (const h of hits) {
      const btn = document.createElement("button");
      btn.className = "library-item";
      btn.innerHTML = `
        <span class="library-item-cat" style="background:${h.cat.color}">${h.cat.name}</span>
        <span class="library-item-title">${h.q.lib.title}</span>
        <span class="library-item-chev" aria-hidden="true">›</span>`;
      btn.addEventListener("click", () => openLibEntry(h.cat, h.q));
      card.appendChild(btn);
    }
    list.appendChild(card);
  }

  document.getElementById("library-search").addEventListener("input", (e) => {
    libQuery = e.target.value;
    renderLibrary();
  });

  // 場面で絞り込んだ一覧(全分野横断・解放済みカードのみ)
  function renderSceneList() {
    const list = document.getElementById("library-list");
    list.innerHTML = "";
    const hits = [];
    QUIZ_DATA.forEach(cat => cat.stages.forEach((stage, si) =>
      stage.questions.forEach((q, qi) => {
        if (state.seen[`${cat.id}:${si}:${qi}`] && q.lib.scenes && q.lib.scenes.includes(libScene)) {
          hits.push({ cat, q });
        }
      })
    ));
    const card = document.createElement("div");
    card.className = "card library-cat";
    card.innerHTML = `
      <div class="library-cat-head">
        <span class="library-cat-name">${LIB_SCENES.find(s => s.id === libScene).name}</span>
        <span class="library-cat-count">${hits.length}件</span>
      </div>`;
    if (hits.length === 0) {
      const p = document.createElement("p");
      p.className = "library-empty";
      p.textContent = "この場面で使えるカードはまだありません。クイズで知識カードを集めましょう。";
      card.appendChild(p);
    }
    for (const h of hits) {
      const btn = document.createElement("button");
      btn.className = "library-item";
      btn.innerHTML = `
        <span class="library-item-cat" style="background:${h.cat.color}">${h.cat.name}</span>
        <span class="library-item-title">${h.q.lib.title}</span>
        <span class="library-item-chev" aria-hidden="true">›</span>`;
      btn.addEventListener("click", () => openLibEntry(h.cat, h.q));
      card.appendChild(btn);
    }
    list.appendChild(card);
  }

  // ライブラリ詳細(問題・正解・解説・関連リンク)
  const libOverlay = document.getElementById("lib-overlay");

  function openLibEntry(cat, q) {
    const catEl = document.getElementById("lib-cat");
    catEl.textContent = cat.name;
    catEl.style.background = cat.color;
    document.getElementById("lib-title").textContent = q.lib.title;
    document.getElementById("lib-q").textContent = q.q;
    document.getElementById("lib-answer").textContent = q.choices[q.answer];
    document.getElementById("lib-exp").textContent = q.exp;
    document.getElementById("lib-more").textContent = q.lib.more;
    const hasUse = !!q.lib.use;
    document.getElementById("lib-use-label").classList.toggle("hidden", !hasUse);
    const useEl = document.getElementById("lib-use");
    useEl.classList.toggle("hidden", !hasUse);
    useEl.textContent = q.lib.use || "";

    // 関連項目(分野横断の「あわせて語ると深い」。解放済みのカードだけリンクを出す)
    const relList = document.getElementById("lib-related-list");
    relList.innerHTML = "";
    const rels = (q.lib.related || [])
      .map(t => TITLE_INDEX[t])
      .filter(e => e && state.seen[e.key]);
    document.getElementById("lib-related").classList.toggle("hidden", rels.length === 0);
    for (const e of rels) {
      const btn = document.createElement("button");
      btn.className = "lib-related-item";
      btn.innerHTML = `
        <span class="library-item-cat" style="background:${e.cat.color}">${e.cat.name}</span>
        <span>${e.q.lib.title}</span>`;
      btn.addEventListener("click", () => openLibEntry(e.cat, e.q));
      relList.appendChild(btn);
    }

    document.querySelector(".lib-box").scrollTop = 0; // 関連リンクで移動したとき先頭から読めるように
    libOverlay.classList.remove("hidden");
  }

  document.getElementById("btn-lib-close").addEventListener("click", () => {
    libOverlay.classList.add("hidden");
  });
  libOverlay.addEventListener("click", (e) => {
    if (e.target === libOverlay) libOverlay.classList.add("hidden");
  });

  function updateNavBadge() {
    const n = dueWrongKeys().length;
    const badge = document.getElementById("nav-review-badge");
    badge.textContent = n;
    badge.classList.toggle("hidden", n === 0);
  }

  // ---------- バッジ描画 ----------

  let badgesLockedOpen = false; // 未達成バッジの展開状態(セッション内のみ)

  function renderBadges() {
    document.getElementById("badges-count").textContent =
      `${state.badges.length} / ${BADGES.length} 個 解除済み`;
    const owned = BADGES.filter(b => state.badges.includes(b.id));
    const locked = BADGES.filter(b => !state.badges.includes(b.id));
    // 解除済みが主役。未達成は「見る」を選んだときだけ(1個もなければ最初から一覧)
    const showLocked = badgesLockedOpen || owned.length === 0;

    const list = document.getElementById("badge-list");
    list.innerHTML = "";
    for (const b of [...owned, ...(showLocked ? locked : [])]) {
      const isOwned = state.badges.includes(b.id);
      const el = document.createElement("div");
      el.className = `badge${isOwned ? "" : " locked"}`;
      el.innerHTML = `
        <div class="badge-status">${isOwned ? "達成" : "未達成"}</div>
        <div class="badge-name">${b.name}</div>
        <div class="badge-desc">${b.desc}</div>`;
      list.appendChild(el);
    }
    const more = document.getElementById("badges-more");
    more.classList.toggle("hidden", showLocked || locked.length === 0);
    more.textContent = `未達成のバッジを見る(${locked.length}個)`;
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
    // サマリー(1段4タイル。累計解答・正解は正答率タイルの下段に吸収)
    const learnedDays = Object.keys(state.activity).length;
    const rate = state.totals.answered > 0
      ? Math.round((state.totals.correct / state.totals.answered) * 100) : 0;
    const summary = [
      { value: `${effectiveStreak().count}日`, label: "連続学習" },
      { value: learnedDays, label: "学習日数" },
      { value: `${rate}%`, label: "正答率", sub: `${state.totals.correct}/${state.totals.answered}問` },
      { value: dueWrongKeys().length, label: "今日の復習 ›", tap: true },
    ];
    const summaryEl = document.getElementById("stats-summary");
    summaryEl.innerHTML = "";
    for (const s of summary) {
      const el = document.createElement(s.tap ? "button" : "div");
      el.className = `stat${s.tap ? " stat-tap" : ""}`;
      el.innerHTML = `
        <div class="stat-value">${s.value}</div>
        <div class="stat-label">${s.label}</div>
        ${s.sub ? `<div class="stat-sub">${s.sub}</div>` : ""}`;
      if (s.tap) el.addEventListener("click", () => {
        show("screen-review");
        renderReview();
      });
      summaryEl.appendChild(el);
    }

    renderCalendar();

    // 分野別正答率
    renderCatRates();

    // 実践問題の記録
    renderPracticeStats();

    // 実力判定テストの記録
    renderExamHistory();
  }

  // 実践問題の記録:分野別のクリア状況と累計成績。未挑戦なら非表示
  function renderPracticeStats() {
    const card = document.getElementById("practice-stats-card");
    const ps = state.practiceStats;
    const clearedTotal = SCENARIO_DATA.filter(s => state.practiceCleared[s.libTitle]).length;
    const show = ps.answered > 0 || clearedTotal > 0;
    card.classList.toggle("hidden", !show);
    if (!show) return;

    document.getElementById("practice-stats-sub").textContent =
      `クリア ${clearedTotal}/${SCENARIO_DATA.length}問`;

    const el = document.getElementById("practice-cats");
    el.innerHTML = "";
    for (const cat of QUIZ_DATA) {
      const scenarios = SCENARIO_DATA.filter(s => s.catId === cat.id);
      if (scenarios.length === 0) continue;
      const cleared = scenarios.filter(s => state.practiceCleared[s.libTitle]).length;
      const pct = Math.round((cleared / scenarios.length) * 100);
      const row = document.createElement("div");
      row.className = "practice-cat";
      row.innerHTML = `
        <div class="cat-rate-head">
          <span class="cat-rate-name">${cat.name}</span>
          <span class="cat-rate-value">${cleared}/${scenarios.length}問</span>
        </div>
        <div class="cat-rate-bar"><div class="cat-rate-fill" style="width:${pct}%;background:${cat.color}"></div></div>`;
      el.appendChild(row);
    }

    const rate = ps.answered > 0 ? Math.round((ps.correct / ps.answered) * 100) : 0;
    document.getElementById("practice-stats-note").textContent = ps.answered > 0
      ? `累計 ${ps.answered}回 解答 ・ 正答率 ${rate}%`
      : "";
  }

  // 実力判定テストの挑戦履歴(直近5件+展開)。未挑戦なら非表示
  const EXAM_HISTORY_SHOWN = 5;
  let examHistoryOpen = false; // 展開状態(セッション内のみ)

  function renderExamHistory() {
    const card = document.getElementById("exam-history-card");
    const h = state.exam.history;
    card.classList.toggle("hidden", h.length === 0);
    if (h.length === 0) return;
    const best = state.exam.best;
    document.getElementById("exam-history-best").textContent =
      best ? `最高評価 ${best.rank}(${best.score}/${examMaxScore()}点)` : "";
    const shown = examHistoryOpen ? h : h.slice(0, EXAM_HISTORY_SHOWN);
    document.getElementById("exam-history").innerHTML = shown.map(e => `
      <div class="exam-history-item">
        <span class="exam-history-rank rank-${e.rank.toLowerCase()}">${e.rank}</span>
        <span class="exam-history-score">${e.score}/${examMaxScore()}点</span>
        <span class="exam-history-date">${e.date}</span>
      </div>`).join("");
    const more = document.getElementById("exam-history-more");
    more.classList.toggle("hidden", examHistoryOpen || h.length <= EXAM_HISTORY_SHOWN);
    more.textContent = `すべて見る(${h.length}件)`;
  }

  // ---------- 学習カレンダー(月別) ----------

  const CAL_MONTHS = 6;          // タブに出す月数(当月含む直近6ヶ月)
  let calSelected = null;        // "YYYY-M"(月は0始まり)。nullなら当月
  let calPicked = null;          // タップで選択中の日付キー("YYYY-MM-DD")。nullなら今日

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
        calPicked = null; // 月をまたいだ選択は持ち越さない
        renderCalendar();
      })
    );

    // カレンダー本体(問数はセルに書かず濃淡のみ。学習日はタップで詳細)
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
        key === (calPicked || todayKey) ? "picked" : "",
        key === todayKey ? "today" : "",
        date > now ? "future" : "",
      ].filter(Boolean).join(" ");
      cells += n > 0
        ? `<button class="${cls}" data-date="${key}" data-count="${n}" data-label="${m + 1}月${day}日"><span class="cal-day">${day}</span></button>`
        : `<div class="${cls}"><span class="cal-day">${day}</span></div>`;
    }
    const grid = document.getElementById("cal-grid");
    grid.innerHTML = cells;
    grid.querySelectorAll("[data-date]").forEach(btn =>
      btn.addEventListener("click", () => {
        calPicked = btn.dataset.date;
        renderCalendar();
      })
    );

    // フッター:選択日(既定は今日)の学習量をひとことで
    const noteEl = document.getElementById("cal-today-note");
    if (calPicked && calPicked !== todayKey) {
      const pickedBtn = grid.querySelector(`[data-date="${calPicked}"]`);
      noteEl.textContent = pickedBtn
        ? `${pickedBtn.dataset.label} ・ ${pickedBtn.dataset.count}問 解答`
        : "";
    } else {
      const todayN = state.activity[todayKey] || 0;
      noteEl.textContent =
        todayN > 0 ? `今日は ${todayN}問 解答しました` : "今日はまだ解答していません";
    }
  }

  // 分野別正答率:行タップでその分野の学習(ステージ選択)へ。弱点から行動に繋げる
  function renderCatRates() {
    const el = document.getElementById("stats-cats");
    el.innerHTML = "";
    for (const cat of QUIZ_DATA) {
      const cs = state.catStats[cat.id] || { answered: 0, correct: 0 };
      const pct = cs.answered > 0 ? Math.round((cs.correct / cs.answered) * 100) : 0;
      const detail = cs.answered > 0 ? `${pct}%(${cs.correct}/${cs.answered})` : "未学習";
      const btn = document.createElement("button");
      btn.className = "cat-rate";
      btn.innerHTML = `
        <div class="cat-rate-head">
          <span class="cat-rate-name">${cat.name}</span>
          <span class="cat-rate-value">${detail}<span class="cat-rate-chev" aria-hidden="true">›</span></span>
        </div>
        <div class="cat-rate-bar"><div class="cat-rate-fill" style="width:${pct}%;background:${cat.color}"></div></div>`;
      btn.addEventListener("click", () => openStages(cat.id));
      el.appendChild(btn);
    }
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

  function confirmReset(title, desc, action, confirmLabel = "リセットする") {
    document.getElementById("reset-title").textContent = title;
    document.getElementById("reset-desc").textContent = desc;
    document.getElementById("btn-reset-confirm").textContent = confirmLabel;
    resetAction = action;
    resetOverlay.classList.remove("hidden");
  }

  // ---------- バックアップ(書き出し/読み込み) ----------

  document.getElementById("btn-export").addEventListener("click", () => {
    const backup = {
      app: "libero-quiz", v: 1, exportedAt: todayStr(),
      state, settings,
    };
    try {
      const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `libero-quiz-backup-${todayStr()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("バックアップを書き出しました");
    } catch {
      toast("書き出しに失敗しました");
    }
  });

  const importFile = document.getElementById("import-file");
  document.getElementById("btn-import").addEventListener("click", () => {
    importFile.value = ""; // 同じファイルを選び直しても change が発火するように
    importFile.click();
  });
  importFile.addEventListener("change", () => {
    const file = importFile.files && importFile.files[0];
    if (!file) return;
    file.text().then(text => {
      let backup;
      try { backup = JSON.parse(text); } catch { backup = null; }
      if (!backup || backup.app !== "libero-quiz" || !backup.state ||
          typeof backup.state.xp !== "number") {
        toast("バックアップファイルとして読み込めませんでした");
        return;
      }
      confirmReset(
        "データを読み込みますか?",
        `現在の学習データは、このバックアップ(${backup.exportedAt || "日付不明"} 書き出し)の内容で上書きされます。`,
        () => {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(backup.state));
            if (backup.settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(backup.settings));
            location.reload(); // loadState のマージで新旧フィールドを補完して再起動
          } catch {
            toast("読み込みに失敗しました");
          }
        },
        "読み込む"
      );
    }).catch(() => toast("ファイルを読み込めませんでした"));
  });

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

  // 本日の目標の開閉(展開状態はセッション内のみ保持)
  document.getElementById("missions-toggle").addEventListener("click", () => {
    const toggle = document.getElementById("missions-toggle");
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    document.getElementById("mission-list").classList.toggle("hidden", !open);
  });

  document.getElementById("btn-start").addEventListener("click", () => startDaily());
  document.getElementById("today-done-card").addEventListener("click", () => startDaily());
  document.getElementById("btn-review-start").addEventListener("click", () => startReview());
  document.getElementById("review-list-more").addEventListener("click", () => {
    reviewListOpen = true;
    renderReview();
  });
  document.getElementById("review-goto-daily").addEventListener("click", () => startDaily());
  document.getElementById("exam-history-more").addEventListener("click", () => {
    examHistoryOpen = true;
    renderExamHistory();
  });
  document.getElementById("badges-more").addEventListener("click", () => {
    badgesLockedOpen = true;
    renderBadges();
  });
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
    clearQuizProgress();
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
    renderLibrary();
    renderStats();
    renderBadges();
    updateNavBadge();
  }

  // ---------- 起動 ----------

  applyTheme();
  ensureDaily();
  render();
  show("screen-home");

  // 途中で閉じた(またはOSに落とされた)クイズがあれば再開を提案
  const MODE_LABELS = {
    stage: "ステージ学習", review: "復習", daily: "今日の5問",
    exam: "実力判定テスト", practice: "実践問題",
  };
  const savedQuiz = loadQuizProgress();
  if (savedQuiz) {
    const qNo = Math.min(savedQuiz.index + 1, savedQuiz.items.length);
    document.getElementById("resume-desc").textContent =
      `${MODE_LABELS[savedQuiz.mode] || "クイズ"} を 第${qNo}問/全${savedQuiz.items.length}問 で中断しています。`;
    document.getElementById("resume-overlay").classList.remove("hidden");
  }
  document.getElementById("btn-resume-continue").addEventListener("click", () => {
    document.getElementById("resume-overlay").classList.add("hidden");
    const saved = loadQuizProgress();
    if (!saved) return;
    quiz = saved;
    if (saved.mode === "stage") currentCatId = saved.catId; // 中断時の戻り先を復元
    show("screen-quiz");
    if (quiz.index >= quiz.items.length) finishQuiz(); // 最終問解答後に落ちていた場合は結果へ
    else renderQuestion();
  });
  document.getElementById("btn-resume-discard").addEventListener("click", () => {
    document.getElementById("resume-overlay").classList.add("hidden");
    clearQuizProgress();
  });

  // 初回オンボーディング(学習済みの既存ユーザーには出さない)
  if (!settings.welcomed && state.totals.answered > 0) {
    settings.welcomed = true;
    saveSettings();
  }
  if (!settings.welcomed && !savedQuiz) {
    document.getElementById("welcome-overlay").classList.remove("hidden");
  }
  function closeWelcome() {
    document.getElementById("welcome-overlay").classList.add("hidden");
    settings.welcomed = true;
    saveSettings();
  }
  document.getElementById("btn-welcome-close").addEventListener("click", closeWelcome);
  document.getElementById("btn-welcome-start").addEventListener("click", () => {
    closeWelcome();
    startDaily();
  });

  // リザルトの共有(Web Share API。未対応環境ではクリップボードにコピー)
  document.getElementById("btn-share").addEventListener("click", () => {
    const rankHidden = document.getElementById("result-rank").classList.contains("hidden");
    const rank = rankHidden ? "" : ` ${document.getElementById("result-rank-letter").textContent}評価`;
    const s = effectiveStreak();
    const text = `リベロクイズ ${document.getElementById("result-title").textContent}${rank} — ` +
      document.getElementById("result-score").textContent +
      (s.count > 1 ? ` ・ 連続学習${s.count}日` : "");
    if (navigator.share) {
      navigator.share({ text }).catch(() => { /* 共有シートのキャンセルは無視 */ });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(() => toast("結果をコピーしました"))
        .catch(() => toast("コピーできませんでした"));
    } else {
      toast("この環境では共有できません");
    }
  });

  // PWA: Service Worker登録(http(s)配信時のみ)
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* 登録失敗時は通常動作 */ });
  }
})();
