// ==UserScript==
// @name         GM API 補丁（讓 Tampermonkey 專用腳本可以在 Snippets/書籤 環境執行）
// @namespace    gm-api-polyfill-for-snippets
// @version      1.0
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  if (typeof window.GM_setValue === 'function') {
    console.log('[GM補丁] 偵測到真正的 Tampermonkey 環境，不需要補丁，已跳過。');
    return;
  }
  const STORE_PREFIX = '__gm_snippet_polyfill__:';
  window.GM_setValue = function (key, value) {
    try { localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value)); } catch (e) { console.warn('[GM補丁] GM_setValue 寫入失敗：', key, e); }
  };
  window.GM_getValue = function (key, defaultValue) {
    try {
      const raw = localStorage.getItem(STORE_PREFIX + key);
      if (raw === null || raw === undefined) return defaultValue;
      return JSON.parse(raw);
    } catch (e) { return defaultValue; }
  };
  window.GM_deleteValue = function (key) {
    try { localStorage.removeItem(STORE_PREFIX + key); } catch (e) { /* 忽略 */ }
  };
  window.GM_addStyle = function (css) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return style;
  };
  window.GM_registerMenuCommand = function (name) {
    console.log('[GM補丁] 選單指令「' + name + '」已註冊，但此環境無法顯示選單（此為正常現象，不影響其他功能）。');
    return Math.random().toString(36).slice(2);
  };
  window.GM_unregisterMenuCommand = function () { /* no-op */ };
  console.log('[GM補丁] 已補上 GM_setValue / GM_getValue / GM_deleteValue / GM_addStyle / GM_registerMenuCommand。');
})();

;

// ==UserScript==
// @name         討論版娛樂 MOD 合輯：鬥技場 + 天堂賭場 + 潘朵拉商城與龍鑽
// @version      17.6
// @match        https://shines871.github.io/idle-lineage-class/*
// @match        https://pp771007.github.io/idle-lineage-class/*
// @match        https://aquamarineserver.com/Lineage/*
// @match        file:///*
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// ==/UserScript==
// ===== 討論版娛樂 MOD 合輯：鬥技場 + 天堂賭場 + 潘朵拉商城與龍鑽 =====
// 三個功能各自獨立、互不依賴，各自的按鈕會自動出現在遊戲介面上。
// 按鈕順序：黑市 → 商城 → 骰子賭場 → 鬥技賭場 → 瞬移 → 回村（依序插在黑市後面，鎖定固定目標，順序穩定不會亂跑）。
// 停用單一功能：刪掉對應那一段整個 (function(){...})(); 區塊即可，其餘不受影響。

(function () {
    'use strict';

    if (window.__gmArenaApplied) {
        console.warn('[103_鬥技場] 偵測到已套用過，本次略過。');
        return;
    }
    if (typeof CLASS_ANIM_SETS === 'undefined' || typeof CLASS_ANIM_WPN_KEY === 'undefined' || typeof CLASS_BATTLE_ANIM === 'undefined') {
        console.warn('[103_鬥技場] 缺少必要的本體資料表，請確認載入順序在 js/09-vfx-render.js 之後');
        return;
    }
    if (typeof pandoraAdjustSharedDiamonds !== 'function' || typeof pandoraGetSharedDiamonds !== 'function' || typeof _lsGet !== 'function' || typeof _lsSet !== 'function') {
        console.warn('[103_鬥技場] 缺少龍之鑽石存取函式，請確認載入順序在 js/24-pandora-relic-market.js、js/00-data.js 之後');
        return;
    }

    // ================================================================

    const CANVAS_W = 800, CANVAS_H = 450;
    const ARENA_BG = 'assets/area/1920x1080/決鬥競技場.jpg';
    const POS_L = { left: 46, bottom: 35 };
    const POS_R = { left: 54, top: 40 };
    const CHAR_SCALE = 1;
    const FRAME_MS = 60;
    const ATTACK_CYCLE_MS = 200;

    const HUD_L = { left: 46, bottom: 60 };
    const HUD_R = { left: 54, top: 25 };
    const HP_BAR_WIDTH = 80;
    const HP_BAR_HEIGHT = 7;
    const SHOW_HP_TEXT = false;
    const HP_TEXT_SIZE = 8;
    const NAME_TEXT_SIZE = 11;
    const HUD_WIDTH = 300;

    const PANEL_BOTTOM = 3;
    const BET_PANEL_WIDTH = 220;
    const BROADCAST_LEFT = 6;
    const BROADCAST_RIGHT = 27;
    const BROADCAST_LINES = 6;
    const BROADCAST_LINE_HEIGHT = 17;
    const BROADCAST_MAX = 50;

    const BET_MS = 15000;
    const PAUSE_MS = 0;
    const SETTLE_MS = 5000;

    const HP_MIN = 200, HP_MAX = 300;
    const DMG_FLOOR = 10, DMG_CEIL = 20;
    const DMG_SPAN_MIN = 2, DMG_SPAN_MAX = 8;

    const COMBO_CHANCE = 0.30;
    const COMBO_INTERVAL_MS = 300;
    const DODGE_CHANCE = 0.15;
    const DMG_TICK_MS = 900;

    const MAX_PROBE_FRAMES = 10;
    const ROUND_STORAGE_KEY = 'arenaVisRoundState_v1';

    const ODDS_FLOOR = 2.0;
    const ODDS_UNDERDOG_MAX = 6.0;
    const POWER_RATIO_CAP = 3;
    const BET_STORAGE_KEY = 'arenaVisBet_v1';

    const AUDIENCE_MIN = 20, AUDIENCE_MAX = 50;
    const AUDIENCE_BET_MIN = 1, AUDIENCE_BET_MAX = 1000;
    const INSPIRE_BASE_CHANCE = 0.10;
    const INSPIRE_MAX_CHANCE = 0.35;
    const INSPIRE_RATIO_CAP = 5;
    const INSPIRE_DMG_BONUS = 0.15;

    const AVATAR_POOL = Array.from(CLASS_BATTLE_ANIM);

    // ---------- 🆕 種子亂數（跟賭場/骰寶同一份寫法：同一個 round 永遠算出同一組結果） ----------
    function hashSeed(str) {
        let h = 1779033703 ^ str.length;
        for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
        return h >>> 0;
    }
    function mulberry32(seed) {
        let s = seed >>> 0;
        return function () {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function seededRand(str) { return mulberry32(hashSeed(str)); }

    // ---------- 幀探測（自己的一份，不碰本體 _morphBattleCache／_battleSpriteProbe） ----------
    const _frameCache = {};
    function probeAction(folder, wpnKey, action) {
        const cacheKey = folder + '|' + wpnKey + '|' + action;
        if (_frameCache[cacheKey]) return _frameCache[cacheKey];
        const base = 'assets/classanim/' + encodeURIComponent(folder) + '/';
        const tasks = [];
        for (let i = 0; i < MAX_PROBE_FRAMES; i++) {
            const url = base + wpnKey + '_' + action + '_' + i + '.png';
            tasks.push(new Promise(resolve => {
                const img = new Image();
                img.onload = () => resolve({ i, url, ok: true });
                img.onerror = () => resolve({ i, url, ok: false });
                img.src = url;
            }));
        }
        const p = Promise.all(tasks).then(results => results.filter(r => r.ok).sort((a, b) => a.i - b.i).map(r => r.url));
        _frameCache[cacheKey] = p;
        return p;
    }
    async function probeActionWithFallback(avatar, dirSuffix, wpnKey, action, fbKey) {
        const folder = avatar + dirSuffix;
        let frames = await probeAction(folder, wpnKey, action);
        if (frames.length) return frames;
        if (fbKey && fbKey !== wpnKey) { frames = await probeAction(folder, fbKey, action); if (frames.length) return frames; }
        if (wpnKey !== 'unarmed' && fbKey !== 'unarmed') frames = await probeAction(folder, 'unarmed', action);
        return frames;
    }
    function probeDeathFrames(folder) {
        const cacheKey = folder + '|death';
        if (_frameCache[cacheKey]) return _frameCache[cacheKey];
        const base = 'assets/classanim/' + encodeURIComponent(folder) + '/';
        const tasks = [];
        for (let i = 0; i < MAX_PROBE_FRAMES; i++) {
            const url = base + 'death_' + i + '.png';
            tasks.push(new Promise(resolve => {
                const img = new Image();
                img.onload = () => resolve({ i, url, ok: true });
                img.onerror = () => resolve({ i, url, ok: false });
                img.src = url;
            }));
        }
        const p = Promise.all(tasks).then(results => results.filter(r => r.ok).sort((a, b) => a.i - b.i).map(r => r.url));
        _frameCache[cacheKey] = p;
        return p;
    }

    // ---------- ② 🆕 純函式：一次算完「這一局」整場戰鬥（不碰 DOM、不碰計時器、同一 round 結果恆定） ----------
    function simulateFight(round) {
        const rand = seededRand('arena|' + round);
        function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }
        function ri(min, max) { return min + Math.floor(rand() * (max - min + 1)); }
        function makeSide(side) {
            const avatar = pick(AVATAR_POOL);
            const set = CLASS_ANIM_SETS[avatar];
            const wpnKey = pick(set.w);
            const maxHp = ri(HP_MIN, HP_MAX);
            const dmgLo = ri(DMG_FLOOR, DMG_CEIL - DMG_SPAN_MIN);
            const dmgHi = Math.min(DMG_CEIL, dmgLo + ri(DMG_SPAN_MIN, DMG_SPAN_MAX));
            const power = Math.round(maxHp * (dmgLo + dmgHi) / 2);   // 綜合戰力（先算好放著，下一步接賠率用）
            const dirSuffix = side === 'L' ? '' : 'd6';   // 東北／西南對角，跟真正決鬥競技場站位算出來的角度一致
            let name = 'NPC' + ri(100, 999);
            try { if (typeof pvpRandomNameWith === 'function') name = pvpRandomNameWith(rand); } catch (e) {}
            return { side, avatar, wpnKey, dirSuffix, maxHp, dmgLo, dmgHi, power, name };
        }
        const L = makeSide('L'), R = makeSide('R');

        // 🆕 觀眾虛擬下注（純模擬，不是真的錢）：決定「誰的觀眾比較多」，差距越大鼓舞觸發機率越高。
        const audienceCount = ri(AUDIENCE_MIN, AUDIENCE_MAX);
        const audienceBets = [];
        let totalL = 0, totalR = 0;
        for (let i = 0; i < audienceCount; i++) {
            const side = rand() < 0.5 ? 'L' : 'R';
            const amount = ri(AUDIENCE_BET_MIN, AUDIENCE_BET_MAX);
            const t = Math.floor(rand() * BET_MS);   // 在下注階段(30秒)內隨機出現的時間點，用來排時間軸播報
            let name = 'NPC' + ri(100, 999);
            try { if (typeof pvpRandomNameWith === 'function') name = pvpRandomNameWith(rand); } catch (e) {}
            audienceBets.push({ t, name, side, amount });
            if (side === 'L') totalL += amount; else totalR += amount;
        }
        audienceBets.sort((a, b) => a.t - b.t);
        let inspiredSide = null;
        if (totalL !== totalR) {
            const leadSide = totalL > totalR ? 'L' : 'R';
            const leadTotal = Math.max(totalL, totalR), lagTotal = Math.min(totalL, totalR);
            const ratio = lagTotal > 0 ? leadTotal / lagTotal : INSPIRE_RATIO_CAP;
            const tt = Math.min(1, Math.max(0, (ratio - 1) / (INSPIRE_RATIO_CAP - 1)));
            const chance = INSPIRE_BASE_CHANCE + (INSPIRE_MAX_CHANCE - INSPIRE_BASE_CHANCE) * tt;
            if (rand() < chance) inspiredSide = leadSide;
        }
        // effDmgLo/effDmgHi＝實際戰鬥用的傷害區間；dmgLo/dmgHi 保持原樣不變，確保賠率(power)不受鼓舞影響。
        L.effDmgLo = L.dmgLo; L.effDmgHi = L.dmgHi;
        R.effDmgLo = R.dmgLo; R.effDmgHi = R.dmgHi;
        if (inspiredSide) {
            const s = inspiredSide === 'L' ? L : R;
            s.effDmgLo = Math.round(s.dmgLo * (1 + INSPIRE_DMG_BONUS));
            s.effDmgHi = Math.round(s.dmgHi * (1 + INSPIRE_DMG_BONUS));
        }
        let hpL = L.maxHp, hpR = R.maxHp;
        const log = [];   // { t, atkSide, defSide, dodge, dmg, hpL, hpR, kill }
        let t = 0;
        while (hpL > 0 && hpR > 0) {
            const attackerSide = rand() < 0.5 ? 'L' : 'R';
            let comboGoing = true;
            while (comboGoing) {
                const targetSide = attackerSide === 'L' ? 'R' : 'L';
                const atk = attackerSide === 'L' ? L : R;
                const dodge = rand() < DODGE_CHANCE;
                let dmg = 0;
                if (!dodge) {
                    dmg = ri(atk.effDmgLo, atk.effDmgHi);
                    if (targetSide === 'L') hpL = Math.max(0, hpL - dmg); else hpR = Math.max(0, hpR - dmg);
                }
                const kill = (targetSide === 'L' ? hpL : hpR) <= 0;
                log.push({ t, atkSide: attackerSide, defSide: targetSide, dodge, dmg, hpL, hpR, kill });
                if (kill) { comboGoing = false; break; }
                if (rand() < COMBO_CHANCE) { t += COMBO_INTERVAL_MS; continue; }
                comboGoing = false;
            }
            if (hpL <= 0 || hpR <= 0) break;
            t += DMG_TICK_MS;
        }
        const winner = hpL <= 0 ? 'R' : 'L';
        const totalMs = log.length ? log[log.length - 1].t : 0;
        return { L, R, log, winner, totalMs, audience: { bets: audienceBets, totalL, totalR, inspiredSide } };
    }
    const _simCache = {};   // round -> sim 結果（純記憶體快取，重整頁面就清空，不持久化）
    const SIM_CACHE_KEEP = 50;   // 只保留最近 50 局，避免分頁開很久記憶體一直長大
    let _maxSeenRound = -1;
    function getSim(round) {
        if (!_simCache[round]) _simCache[round] = simulateFight(round);
        if (round > _maxSeenRound) {
            _maxSeenRound = round;
            for (const k in _simCache) { if (_maxSeenRound - Number(k) > SIM_CACHE_KEEP) delete _simCache[k]; }
        }
        return _simCache[round];
    }
    // 🆕 賠率：純函式，只讀 sim.L.power/sim.R.power，不影響模擬本身。
    function calcOdds(sim) {
        const strongSide = sim.L.power >= sim.R.power ? 'L' : 'R';
        const weakSide = strongSide === 'L' ? 'R' : 'L';
        const strongPower = sim[strongSide].power, weakPower = sim[weakSide].power;
        const ratio = weakPower > 0 ? strongPower / weakPower : POWER_RATIO_CAP;
        const t = Math.min(1, Math.max(0, (ratio - 1) / (POWER_RATIO_CAP - 1)));
        const weakOdds = Math.round((ODDS_FLOOR + (ODDS_UNDERDOG_MAX - ODDS_FLOOR) * t) * 10) / 10;
        const odds = {}; odds[strongSide] = ODDS_FLOOR; odds[weakSide] = weakOdds;
        return odds;
    }

    // ---------- ③ 🆕 局面狀態機（bet→fight→pause→settle→下一局），存 localStorage、具備補算能力 ----------
    function loadRoundState() {
        try { const raw = _lsGet(ROUND_STORAGE_KEY); const st = raw ? JSON.parse(raw) : null; return (st && typeof st.round === 'number') ? st : null; } catch (e) { return null; }
    }
    function saveRoundState(st) {
        try { _lsSet(ROUND_STORAGE_KEY, JSON.stringify(st)); } catch (e) {}
    }
    function phaseDurationFor(st) {
        if (st.phase === 'bet') return BET_MS;
        if (st.phase === 'fight') return Math.max(1, getSim(st.round).totalMs);   // 至少1ms，避免長度0造成無窮迴圈
        if (st.phase === 'pause') return PAUSE_MS;
        return SETTLE_MS;   // 'settle'
    }
    function nextPhaseState(st) {
        if (st.phase === 'bet') return { round: st.round, phase: 'fight', phaseStart: st.phaseStart };
        if (st.phase === 'fight') return { round: st.round, phase: 'pause', phaseStart: st.phaseStart };
        if (st.phase === 'pause') return { round: st.round, phase: 'settle', phaseStart: st.phaseStart };
        return { round: st.round + 1, phase: 'bet', phaseStart: st.phaseStart };   // settle結束→下一局的bet
    }
    // 拿現在時間跟存的狀態比對，該推進幾階段就推進幾階段（分頁關很久沒開，這裡會一次補算到正確的局/階段）。
    // ⚠️ guard 上限只是防呆：萬一分頁關了非常久（例如幾千局的量），單次補算不完也沒關係，
    //    畫面每 300ms 會再呼叫一次，之後幾次呼叫會繼續補，最終還是會追上，只是要多等幾秒。
    function computeRoundState() {
        let st = loadRoundState();
        if (!st) st = { round: 0, phase: 'bet', phaseStart: Date.now() };
        let guard = 0;
        while (guard++ < 5000) {
            const dur = phaseDurationFor(st);
            if (Date.now() - st.phaseStart < dur) break;
            st = Object.assign({}, st, { phaseStart: st.phaseStart + dur });
            st = nextPhaseState(st);
        }
        saveRoundState(st);
        return st;
    }

    // ---------- 🆕 下注紀錄（一局只能下一次）：{round, side, amount, odds, settled} ----------
    function loadBetState() {
        try { const raw = _lsGet(BET_STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    }
    function saveBetState(bet) {
        try { _lsSet(BET_STORAGE_KEY, JSON.stringify(bet)); } catch (e) {}
    }
    // 下注：只在「下注階段」且「這局還沒下過」才會生效；時間到/已下過→什麼都不做（不給反應，符合你的要求）。
    function placeBet(round, side, amount) {
        const cur = loadBetState();
        if (cur && cur.round === round) return false;   // 這局已經下過了
        if (!(amount > 0)) return false;
        const balance = pandoraGetSharedDiamonds();
        if (amount > balance) return false;   // 超過餘額，不給下注
        const result = pandoraAdjustSharedDiamonds(-amount);
        if (!result || !result.ok) return false;
        const sim = getSim(round);
        const odds = calcOdds(sim);
        saveBetState({ round, side, amount, odds: odds[side], settled: false });
        return true;
    }
    // 結算：贏了才補付；輸了本來就已經預扣，不用再做什麼。settled 旗標避免重複結算。
    function settleBetIfNeeded(round) {
        const bet = loadBetState();
        if (!bet || bet.round !== round || bet.settled) return null;
        const sim = getSim(round);
        const win = bet.side === sim.winner;
        if (win) {
            const payout = Math.round(bet.amount * bet.odds);
            pandoraAdjustSharedDiamonds(payout);
            bet.payout = payout;
        }
        bet.win = win;
        bet.settled = true;
        saveBetState(bet);
        return bet;
    }

    // ---------- 視窗＋拖曳（照抄 js/20-warehouse-window.js） ----------
    let drag = null;
    let visTicker = null, animTicker = null, refreshTimer = null;
    let scheduled = [];   // 排程中、還沒觸發的 setTimeout id（進新階段/關視窗要清掉）
    let fighters = null;  // { L: {avatar,wpnKey,dirSuffix,idle,attack,death,act,frameIdx,hp,maxHp,name}, R: {...} }
    let curRoundKey = null;   // `${round}|${phase}`，用來偵測「有沒有換階段」
    let curRound = null;      // 用來偵測「有沒有換局」（換局才需要重新載入雙方動畫素材）

    function injectStyle() {
        if (document.getElementById('arena-vis-style')) return;
        const style = document.createElement('style');
        style.id = 'arena-vis-style';
        style.textContent = `
#arena-vis-window { position:fixed; left:calc(50% - 400px); top:calc(50% - 245px); z-index:9000; }
#arena-vis-window.hidden { display:none; }
#arena-vis-frame { width:min(${CANVAS_W}px,92vw); background:#0d0c0a; border:1px solid #57534e; border-radius:8px; box-shadow:0 12px 40px rgba(0,0,0,.6); overflow:hidden; }
#arena-vis-drag { display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:#1c1917; border-bottom:1px solid #3f3a34; cursor:move; user-select:none; }
#arena-vis-drag .title { color:#facc15; font-weight:700; font-size:.85rem; }
#arena-vis-phase { color:#93c5fd; font-weight:700; font-size:.78rem; }
#arena-vis-close { background:#3f2d13; color:#f5deb3; border:1px solid #78350f; border-radius:4px; padding:2px 8px; font-size:.8rem; cursor:pointer; }
#arena-vis-canvas { position:relative; width:100%; aspect-ratio:${CANVAS_W}/${CANVAS_H}; background:url('${ARENA_BG}') center/cover no-repeat; }
.arena-vis-fighter { position:absolute; image-rendering:pixelated; pointer-events:none; z-index:1; }
.arena-vis-fighter.anchor-bottom { transform:translateX(-50%) scale(${CHAR_SCALE}); transform-origin:bottom center; }
.arena-vis-fighter.anchor-center { transform:translate(-50%,-50%) scale(${CHAR_SCALE}); transform-origin:center center; }
.arena-vis-hud { position:absolute; transform:translateX(-50%); width:${HUD_WIDTH}px; z-index:2; display:flex; flex-direction:column; gap:2px; pointer-events:none; }
.arena-vis-hud .compact-vital-bar { width:${HP_BAR_WIDTH}px; height:${HP_BAR_HEIGHT}px; margin:0 auto; }
.arena-vis-hud .bar-text { font-size:${HP_TEXT_SIZE}px; ${SHOW_HP_TEXT ? '' : 'display:none;'} }
.arena-vis-hud .arena-vis-namerow { text-align:center; font-size:${NAME_TEXT_SIZE}px; line-height:1.2; color:#e7e2d8; text-shadow:0 1px 2px #000,0 0 4px #000; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.arena-vis-miss { position:absolute; left:50%; top:-4px; transform:translate(-50%,-100%); font-size:11px; font-weight:700; color:#9ca3af; text-shadow:0 1px 2px #000; pointer-events:none; animation:arena-vis-miss-float .5s ease-out forwards; }
@keyframes arena-vis-miss-float { 0%{opacity:1; transform:translate(-50%,-100%);} 100%{opacity:0; transform:translate(-50%,-160%);} }
/* 🆕 下注面板：畫布右下角，按鈕配色照抄倉庫「存入／取出」的漸層。 */
/* 🆕 下注面板：外層容器只負責定位，本身無底圖；按鈕列浮在場景上，金額/狀態區才保留底圖（唯一內容會變動、需要可讀性的地方）。 */
.arena-vis-bet { position:absolute; right:2%; bottom:${PANEL_BOTTOM}%; width:${BET_PANEL_WIDTH}px; z-index:5; display:flex; flex-direction:column; gap:6px; }
.arena-vis-bet-btns { display:flex; gap:6px; }
.arena-vis-bet-btn { flex:1; min-width:0; border-radius:6px; border-width:1px; border-style:solid; padding:5px 4px; cursor:pointer; text-align:center; overflow:hidden; }   /* 🩹 min-width:0 修正長ID把按鈕撐變形的flexbox bug */
.arena-vis-bet-btn.side-l { background:linear-gradient(135deg,#0c4a5e 0%,#0e7490 28%,#0a3d4d 52%,#11657e 76%,#093440 100%); color:#a5f3fc; border-color:#0891b2; }
.arena-vis-bet-btn.side-r { background:linear-gradient(135deg,#6b2a10 0%,#b3490e 28%,#5a230e 52%,#9a3e0c 76%,#4a1d0c 100%); color:#fed7aa; border-color:#c2410c; }
.arena-vis-bet-btn:disabled { opacity:.4; cursor:not-allowed; filter:grayscale(.4); }
.arena-vis-bet-btn .bn-name { font-size:11px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }   /* 超寬名字截斷省略號，title屬性另外顯示完整名字 */
.arena-vis-bet-btn .bn-odds { font-size:13px; font-weight:800; }
.arena-vis-bet-panel { background:rgba(13,12,10,.88); border:1px solid #57534e; border-radius:8px; padding:6px 8px; }
.arena-vis-bet-panel input { width:100%; box-sizing:border-box; background:#1c1917; border:1px solid #57534e; color:#e7e2d8; border-radius:4px; padding:3px 6px; font-size:12px; text-align:center; }
.arena-vis-bet-panel input:disabled { opacity:.5; }
.arena-vis-bet-msg { margin-top:4px; font-size:11px; text-align:center; min-height:14px; color:#facc15; }
/* 🆕 播報區：無底圖，純文字＋text-shadow撐可讀性，位置抓在畫布下方偏左，寬度避開右下角下注面板。 */
.arena-vis-broadcast { position:absolute; left:${BROADCAST_LEFT}%; right:${BROADCAST_RIGHT}%; bottom:${PANEL_BOTTOM}%; height:${BROADCAST_LINES * BROADCAST_LINE_HEIGHT}px; overflow-y:auto; z-index:4; scrollbar-width:none; -ms-overflow-style:none; display:flex; flex-direction:column; gap:1px; }
.arena-vis-broadcast::-webkit-scrollbar { display:none; width:0; height:0; }   /* 🩹 Chrome/Safari 隱藏捲軸；Firefox 用上面的 scrollbar-width:none */
.arena-vis-broadcast div { font-size:12px; font-weight:700; line-height:${BROADCAST_LINE_HEIGHT}px; text-shadow:0 1px 3px #000,0 0 6px #000; flex-shrink:0; }
.arena-vis-broadcast div.row-announce { color:#fde68a; }
.arena-vis-broadcast div.row-audience { color:#d4d4d8; }
`;
        document.head.appendChild(style);
    }

    function hudHtml(side) {
        return `
            <div class="bar-bg compact-vital-bar" title="HP">
                <div class="bar-fill bg-red-600" id="arena-vis-hpfill-${side}" style="width:100%"></div>
                <div class="bar-text text-white" id="arena-vis-hptxt-${side}">--/--</div>
            </div>
            <div class="arena-vis-namerow" id="arena-vis-namerow-${side}"></div>`;
    }

    function buildWindowDom() {
        if (document.getElementById('arena-vis-window')) return;
        injectStyle();
        const win = document.createElement('div');
        win.id = 'arena-vis-window';
        win.className = 'hidden';
        win.innerHTML = `
            <div id="arena-vis-frame">
                <div id="arena-vis-drag">
                    <span class="title">鬥技賭場</span>
                    <span id="arena-vis-phase"></span>
                    <button type="button" id="arena-vis-close">關閉</button>
                </div>
                <div id="arena-vis-canvas">
                    <img class="arena-vis-fighter anchor-bottom" id="arena-vis-img-L" style="left:${POS_L.left}%;bottom:${POS_L.bottom}%;" alt="">
                    <img class="arena-vis-fighter anchor-center" id="arena-vis-img-R" style="left:${POS_R.left}%;top:${POS_R.top}%;" alt="">
                    <div class="arena-vis-hud" id="arena-vis-hud-L" style="left:${HUD_L.left}%;bottom:${HUD_L.bottom}%;">${hudHtml('L')}</div>
                    <div class="arena-vis-hud" id="arena-vis-hud-R" style="left:${HUD_R.left}%;top:${HUD_R.top}%;">${hudHtml('R')}</div>
                    <div class="arena-vis-broadcast" id="arena-vis-broadcast"></div>
                    <div class="arena-vis-bet" id="arena-vis-bet">
                        <div class="arena-vis-bet-btns">
                            <button type="button" class="arena-vis-bet-btn side-l" id="arena-vis-bet-L">
                                <div class="bn-name" id="arena-vis-betname-L"></div>
                                <div class="bn-odds" id="arena-vis-betodds-L"></div>
                            </button>
                            <button type="button" class="arena-vis-bet-btn side-r" id="arena-vis-bet-R">
                                <div class="bn-name" id="arena-vis-betname-R"></div>
                                <div class="bn-odds" id="arena-vis-betodds-R"></div>
                            </button>
                        </div>
                        <div class="arena-vis-bet-panel">
                            <input type="number" id="arena-vis-bet-amt" min="1" placeholder="下注數量">
                            <div class="arena-vis-bet-msg" id="arena-vis-bet-msg"></div>
                        </div>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(win);

        const handle = document.getElementById('arena-vis-drag');
        document.getElementById('arena-vis-close').onclick = closeArenaVis;
        handle.addEventListener('pointerdown', event => {
            if (event.target.closest('button')) return;
            const rect = win.getBoundingClientRect();
            drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
            handle.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        handle.addEventListener('pointermove', event => {
            if (!drag || drag.id !== event.pointerId) return;
            const maxX = Math.max(0, innerWidth - win.offsetWidth);
            const maxY = Math.max(0, innerHeight - win.offsetHeight);
            win.style.left = Math.max(0, Math.min(maxX, event.clientX - drag.dx)) + 'px';
            win.style.top = Math.max(0, Math.min(maxY, event.clientY - drag.dy)) + 'px';
        });
        function stop(event) { if (drag && drag.id === event.pointerId) drag = null; }
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);

        document.getElementById('arena-vis-bet-L').onclick = () => onBetClick('L');
        document.getElementById('arena-vis-bet-R').onclick = () => onBetClick('R');
    }

    // ---------- ① 畫面動畫（8fps ticker：只負責「現在該顯示哪一幀」，完全不知道血量/時間軸）----------
    function currentFrames(f) {
        if (f.act === 'death') return f.death.length ? f.death : f.idle;
        return f.act === 'attack' && f.attack.length ? f.attack : f.idle;
    }
    function applyFrame(f) {
        const frames = currentFrames(f);
        const img = document.getElementById('arena-vis-img-' + f.side);
        if (img && frames.length) img.src = frames[f.frameIdx % frames.length];
    }
    function animTick() {
        if (!fighters) return;
        ['L', 'R'].forEach(side => {
            const f = fighters[side];
            if (f.act === 'death') { if (f.death.length && f.frameIdx < f.death.length - 1) { f.frameIdx++; applyFrame(f); } return; }
            f.frameIdx++;
            if (f.act === 'attack' && f.frameIdx >= f.attack.length) { f.act = 'idle'; f.frameIdx = 0; }
            applyFrame(f);
        });
    }
    function poseIdle(side) { const f = fighters[side]; if (f.act !== 'death') { f.act = 'idle'; f.frameIdx = 0; applyFrame(f); } }
    function poseAttack(side) { const f = fighters[side]; if (f.act === 'death') return; if (f.attack.length) { f.act = 'attack'; f.frameIdx = 0; applyFrame(f); } }
    function poseDeath(side) { const f = fighters[side]; if (f.act === 'death') return; f.act = 'death'; f.frameIdx = 0; applyFrame(f); }   // 🩹 冪等：pause→settle 換階段時會再呼叫一次，已經死過就不要重播

    // ---------- HUD 顯示 ----------
    function updateHpDisplay(side, hp, maxHp) {
        const pct = Math.max(0, Math.min(100, Math.round(hp / maxHp * 100)));
        const fill = document.getElementById('arena-vis-hpfill-' + side);
        const txt = document.getElementById('arena-vis-hptxt-' + side);
        if (fill) fill.style.width = pct + '%';
        if (txt) txt.textContent = Math.max(0, Math.round(hp)) + '/' + maxHp;
    }
    function updateNameRow(side, name) {
        const el = document.getElementById('arena-vis-namerow-' + side);
        if (el) el.textContent = name;
    }
    function showMiss(side) {
        const hud = document.getElementById('arena-vis-hud-' + side);
        if (!hud) return;
        const tag = document.createElement('div');
        tag.className = 'arena-vis-miss';
        tag.textContent = 'MISS';
        hud.appendChild(tag);
        setTimeout(() => { try { tag.remove(); } catch (e) {} }, 500);
    }
    // 🆕 播報區（無底圖對話框）：先做「本局結果公告」，之後要加觀眾NPC下注/嘲諷都往這裡加就好。
    // 🎨 場上角色的名字在對話框裡上色：左邊(L)藍色、右邊(R)紅色，跟下注按鈕的配色對應（side-l/side-r 同一組顏色）。
    function sideNameHtml(sim, side) {
        const color = side === 'L' ? '#7dd3fc' : '#f87171';
        return `<span style="color:${color}">${sim[side].name}</span>`;
    }
    let broadcastLog = [];
    function pushBroadcast(text, cls) {
        broadcastLog.push({ text, cls: cls || 'row-announce' });
        if (broadcastLog.length > BROADCAST_MAX) broadcastLog.shift();
        const el = document.getElementById('arena-vis-broadcast');
        if (!el) return;
        const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10;   // 使用者往上滾看歷史時，新訊息不會把畫面拉回底部
        el.innerHTML = broadcastLog.map(e => `<div class="${e.cls}">${e.text}</div>`).join('');
        if (wasAtBottom) el.scrollTop = el.scrollHeight;
    }
    function announceRoundResult(round) {
        const sim = getSim(round);
        const bet = loadBetState();
        let msg = `【公告】${sideNameHtml(sim, sim.winner)} 獲勝！`;
        if (bet && bet.round === round && bet.settled) {
            msg += bet.win ? `　你贏得 ${(bet.payout || 0).toLocaleString()} 龍鑽` : `　你輸掉 ${bet.amount.toLocaleString()} 龍鑽`;
        }
        pushBroadcast(msg);   // 公告類，走預設 row-announce（金色）
    }

    function setPhaseLabel(text) { const el = document.getElementById('arena-vis-phase'); if (el) el.textContent = text; }

    // ---------- 🆕 下注面板：按鈕文字/開關狀態/訊息 ----------
    function setBetMsg(text) { const el = document.getElementById('arena-vis-bet-msg'); if (el) el.textContent = text || ''; }
    function updateBetButtonLabels(sim) {
        const odds = calcOdds(sim);
        ['L', 'R'].forEach(side => {
            const nameEl = document.getElementById('arena-vis-betname-' + side);
            const oddsEl = document.getElementById('arena-vis-betodds-' + side);
            const btnEl = document.getElementById('arena-vis-bet-' + side);
            if (nameEl) nameEl.textContent = sim[side].name;
            if (btnEl) btnEl.title = sim[side].name;   // 🆕 名字太長被截斷時，滑鼠移上去看完整名字
            if (oddsEl) oddsEl.textContent = odds[side].toFixed(1) + ' 倍';
        });
    }
    function setBetControlsEnabled(enabled) {
        const btnL = document.getElementById('arena-vis-bet-L');
        const btnR = document.getElementById('arena-vis-bet-R');
        const amt = document.getElementById('arena-vis-bet-amt');
        if (btnL) btnL.disabled = !enabled;
        if (btnR) btnR.disabled = !enabled;
        if (amt) amt.disabled = !enabled;
    }
    // 🆕 還沒下注（不管在哪個階段、或這局選擇不下）一律顯示即時龍鑽餘額，不再顯示「本局未下注」。
    function balanceText() { return `目前龍鑽餘額：${pandoraGetSharedDiamonds().toLocaleString()}`; }
    function refreshBetPanel(st, sim) {
        updateBetButtonLabels(sim);
        const bet = loadBetState();
        const hasBet = bet && bet.round === st.round;
        if (st.phase === 'bet' && !hasBet) { setBetControlsEnabled(true); setBetMsg(balanceText()); return; }
        setBetControlsEnabled(false);
        if (!hasBet) { setBetMsg(balanceText()); return; }
        if (!bet.settled) { setBetMsg(`已下注 ${bet.amount.toLocaleString()}（${bet.odds}倍），等待結算`); return; }
        setBetMsg(bet.win ? `🏆 贏得 ${(bet.payout || 0).toLocaleString()} 龍鑽` : `💀 沒中，虧損 ${bet.amount.toLocaleString()} 龍鑽`);
    }
    // 點下注按鈕：下注時間到（不是 bet 階段）→ 完全不給反應；已下過這局的→同樣不給反應（避免重複扣款）。
    function onBetClick(side) {
        const st = computeRoundState();
        if (st.phase !== 'bet') return;
        const amtEl = document.getElementById('arena-vis-bet-amt');
        const amount = Math.floor(Number(amtEl && amtEl.value) || 0);
        if (placeBet(st.round, side, amount)) {
            refreshBetPanel(st, getSim(st.round));
        } else {
            setBetMsg('下注失敗（金額不足、已下注過，或還沒輸入數量）');
        }
    }

    // ---------- ④ 依 sim.log 的時間軸播放：只負責血量／MISS文字／死亡，完全不碰「誰現在擺攻擊姿勢」----------
    //    🩹 這裡刻意不觸發 poseAttack：攻擊姿勢是純裝飾性的獨立循環（見下方 cosmeticAttackTick），
    //    跟血量/命中結果沒有任何關聯——這樣「扣血」才不會反過來牽動畫面動畫，兩邊真正互相獨立。
    function clearScheduled() { scheduled.forEach(id => clearTimeout(id)); scheduled = []; }
    function playLogEvent(sim, e) {
        if (!fighters) return;
        updateHpDisplay('L', e.hpL, sim.L.maxHp);
        updateHpDisplay('R', e.hpR, sim.R.maxHp);
        if (e.dodge) showMiss(e.defSide);
        if (e.kill) poseDeath(e.defSide);   // 死亡是真正的終結狀態，不是「攻擊動畫」，這個例外要保留
    }
    // 🆕 下注階段播放：依 sim.audience.bets 的時間軸，逐一把「誰押了誰」播進播報區（純模擬，跟玩家真實下注無關）。
    function enterBetPlayback(sim, msIntoBet) {
        clearScheduled();
        sim.audience.bets.forEach(b => {
            const line = () => pushBroadcast(`${b.name}　壓 ${sideNameHtml(sim, b.side)}　${b.amount.toLocaleString()}個龍鑽`, 'row-audience');
            if (b.t <= msIntoBet) line();   // 已經錯過的直接補上，不逐一重播
            else scheduled.push(setTimeout(line, b.t - msIntoBet));
        });
    }
    function enterFightPlayback(sim, msIntoFight) {
        clearScheduled();
        let lastPassed = -1;
        for (let i = 0; i < sim.log.length; i++) { if (sim.log[i].t <= msIntoFight) lastPassed = i; else break; }
        if (lastPassed >= 0) {
            const e = sim.log[lastPassed];
            updateHpDisplay('L', e.hpL, sim.L.maxHp); updateHpDisplay('R', e.hpR, sim.R.maxHp);
            if (e.kill) poseDeath(e.defSide);
        } else {
            updateHpDisplay('L', sim.L.maxHp, sim.L.maxHp); updateHpDisplay('R', sim.R.maxHp, sim.R.maxHp);
        }
        for (let i = lastPassed + 1; i < sim.log.length; i++) {
            const e = sim.log[i];
            const delay = Math.max(0, e.t - msIntoFight);
            scheduled.push(setTimeout(() => playLogEvent(sim, e), delay));
        }
    }
    // ---------- 🆕 攻擊姿勢：純裝飾性的獨立循環，只在「戰鬥中」跑，跟血量/log完全無關（誰現在看起來在揮擊是隨機的，不代表真的打中）----------
    let cosmeticTimer = null, cosmeticSide = 'L';
    let lastAnnouncedRound = -1;   // 🆕 上次已經結算＋公告過的局號，用來做「每次tick都核對」的補救機制
    function cosmeticAttackTick() {
        if (!fighters) return;
        cosmeticSide = cosmeticSide === 'L' ? 'R' : 'L';
        poseAttack(cosmeticSide);
    }
    function startCosmeticAttack() { stopCosmeticAttack(); cosmeticTimer = setInterval(cosmeticAttackTick, ATTACK_CYCLE_MS); }
    function stopCosmeticAttack() { if (cosmeticTimer) { clearInterval(cosmeticTimer); cosmeticTimer = null; } }

    // 🩹 補救機制：不依賴「剛好抓到某個階段開始的那一瞬間」，改成每次 tick 都主動核對現況，不對就修正。
    //    這樣就算分頁在背景被瀏覽器降頻、漏看了某個階段的轉換瞬間，下一次 tick 還是會自己修正回來，
    //    不會出現「裝飾性攻擊循環忘了關掉」或「結算/公告漏觸發」這種問題。
    function reconcileCosmeticAttack(st) {
        if (st.phase === 'fight') { if (!cosmeticTimer) startCosmeticAttack(); }
        else if (cosmeticTimer) { stopCosmeticAttack(); }
    }
    function reconcileSettleAndAnnounce(st) {
        // 保險①：不管公告追蹤有沒有漏看，只要「玩家實際下注的那一局」已經過了、還沒結算，就直接結算——
        //        這個判斷只看玩家自己那筆下注的局號，不依賴 doneRound 推算，確保錢不會漏結算。
        const bet = loadBetState();
        if (bet && !bet.settled && bet.round < st.round) settleBetIfNeeded(bet.round);
        // 保險②：公告文字（純資訊性，漏了也不影響錢）——判定「上一局」已經結束的局號，還沒公告過就補公告一次。
        const doneRound = st.phase === 'bet' ? st.round - 1 : (st.phase === 'fight' ? -1 : st.round);
        if (doneRound >= 0 && doneRound > lastAnnouncedRound) {
            settleBetIfNeeded(doneRound);
            announceRoundResult(doneRound);
            lastAnnouncedRound = doneRound;
        }
    }
    function applyFinalState(sim) {   // pause/settle 階段：定格在最終結果
        clearScheduled();
        updateHpDisplay('L', sim.log.length ? sim.log[sim.log.length - 1].hpL : sim.L.maxHp, sim.L.maxHp);
        updateHpDisplay('R', sim.log.length ? sim.log[sim.log.length - 1].hpR : sim.R.maxHp, sim.R.maxHp);
        const loser = sim.winner === 'L' ? 'R' : 'L';
        poseDeath(loser);
        poseIdle(sim.winner);
    }

    // ---------- 依 sim 載入雙方動畫素材（換局才需要重新探測，同一局內重複呼叫免重載） ----------
    async function loadFightersFromSim(sim) {
        async function make(side) {
            const s = sim[side];
            const [idle, attack, death] = await Promise.all([
                probeActionWithFallback(s.avatar, s.dirSuffix, s.wpnKey, 'idle', CLASS_ANIM_SETS[s.avatar].fb),
                probeActionWithFallback(s.avatar, s.dirSuffix, s.wpnKey, 'attack', CLASS_ANIM_SETS[s.avatar].fb),
                probeDeathFrames(s.avatar + s.dirSuffix)
            ]);
            return { side, avatar: s.avatar, wpnKey: s.wpnKey, idle, attack, death, act: 'idle', frameIdx: 0, name: s.name };
        }
        const [L, R] = await Promise.all([make('L'), make('R')]);
        fighters = { L, R };
        updateNameRow('L', L.name); updateNameRow('R', R.name);
        applyFrame(L); applyFrame(R);
    }

    // ---------- ⑤ 主循環：每 300ms 檢查一次目前局/階段，換了才重新佈置畫面；倒數文字每次都更新 ----------
    const PHASE_LABEL = { bet: '下注中', fight: '戰鬥進行中', pause: '本局結束，準備結算', settle: '結算中' };
    async function refreshView() {
        const st = computeRoundState();
        const sim = getSim(st.round);
        if (curRound !== st.round) {
            curRound = st.round;
            await loadFightersFromSim(sim);   // 只有真的換局才需要重新探測動畫素材（同一局內反覆呼叫不用重載）
        }
        const key = st.round + '|' + st.phase;
        if (key !== curRoundKey) {
            curRoundKey = key;
            if (st.phase === 'bet') { poseIdle('L'); poseIdle('R'); updateHpDisplay('L', sim.L.maxHp, sim.L.maxHp); updateHpDisplay('R', sim.R.maxHp, sim.R.maxHp); enterBetPlayback(sim, Date.now() - st.phaseStart); }
            else if (st.phase === 'fight') {
                enterFightPlayback(sim, Date.now() - st.phaseStart);
                if (sim.audience.inspiredSide) pushBroadcast(`【公告】觀眾一面倒力挺 ${sideNameHtml(sim, sim.audience.inspiredSide)}，士氣大振！`);
            }
            else { applyFinalState(sim); }   // pause／settle 共用：定格在最終結果的畫面
        }
        reconcileCosmeticAttack(st);       // 🩹 每次tick都核對：現在是不是該演攻擊循環，不對就修正
        reconcileSettleAndAnnounce(st);    // 🩹 每次tick都核對：有沒有漏掉哪一局的結算/公告，有就補做
        refreshBetPanel(st, sim);
        // 🩹 戰鬥階段不顯示倒數：戰鬥實際長度是打到死亡才結束，顯示倒數等於提前洩漏「這局死得快不快」，
        //    等於變相破梗——只有下注/停頓/結算這種「固定長度、跟戰鬥結果無關」的階段才顯示倒數。
        if (st.phase === 'fight') {
            setPhaseLabel(`第 ${st.round} 局・${PHASE_LABEL[st.phase]}`);
        } else {
            const remain = Math.max(0, Math.ceil((phaseDurationFor(st) - (Date.now() - st.phaseStart)) / 1000));
            setPhaseLabel(`第 ${st.round} 局・${PHASE_LABEL[st.phase]}（${remain}秒）`);
        }
    }

    function stopAll() {
        if (visTicker) { clearInterval(visTicker); visTicker = null; }
        if (animTicker) { clearInterval(animTicker); animTicker = null; }
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        stopCosmeticAttack();
        clearScheduled();
    }

    async function openArenaVis() {
        buildWindowDom();
        const win = document.getElementById('arena-vis-window');
        win.classList.remove('hidden');
        stopAll();
        curRoundKey = null; curRound = null;   // 強制下一次 refreshView() 重新載入素材＋佈置畫面
        await refreshView();
        animTicker = setInterval(animTick, FRAME_MS);
        refreshTimer = setInterval(refreshView, 300);   // 每 300ms 檢查一次局/階段有沒有換
    }
    function closeArenaVis() {
        const win = document.getElementById('arena-vis-window');
        if (win) win.classList.add('hidden');
        stopAll();
    }
    window.openArenaVis = openArenaVis;

    // ---------- 按鈕注入 ----------
    function injectButton() {
        const ref = document.getElementById('btn-casino2');
        if (!ref || document.getElementById('btn-arena')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-arena';
        btn.className = 'bg-red-950 hover:bg-red-900 px-3 py-1 text-red-200 font-bold border border-red-700 rounded text-sm shadow-md whitespace-nowrap min-w-[3.25rem] text-center';
        btn.title = '鬥技場：下注觀戰，兩位角色隨機對決';
        btn.textContent = '鬥技賭場';
        btn.onclick = openArenaVis;
        ref.insertAdjacentElement('afterend', btn);
    }
    function init() {
        injectButton();
        setInterval(injectButton, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.__gmArenaApplied = true;
})();

(function () {
    'use strict';

    if (window.__gmCasinoV2Applied) {
        console.warn('[102_天堂賭場v2] 偵測到已套用過，本次略過。');
        return;
    }
    if (typeof pandoraAdjustSharedDiamonds !== 'function' || typeof pandoraGetSharedDiamonds !== 'function' || typeof _lsGet !== 'function' || typeof _lsSet !== 'function') {
        console.warn('[102_天堂賭場v2] 缺少龍之鑽石存取函式，請確認載入順序在 js/24-pandora-relic-market.js、js/00-data.js 之後');
        return;
    }

    // ================================================================

    const CANVAS_W = 800, CANVAS_H = 450;
    const ARENA_BG = 'assets/area/img/賭桌.jpg';

    const BID_MS = 15000;
    const BET_MS = 15000;
    const PREP_MS = 5000;
    const ROUND_MS = BID_MS + BET_MS + PREP_MS;
    const ROUND_EPOCH = 1735689600000;
    const STATE_KEY = 'casinoV2PlayerState_v1';

    const NPC_BID_MIN = 100, NPC_BID_MAX = 10000;
    const NPC_BET_MIN = 1, NPC_BET_MAX = 10000;

    const PANEL_BOTTOM = 3;
    const BET_PANEL_WIDTH = 260;
    const DICE_TOP = 42;
    const DICE_SIZE = 60;
    const TOTALS_TOP = 3;
    const TOTALS_WIDTH = 460;
    const BROADCAST_LEFT = 6;
    const BROADCAST_RIGHT = 27;
    const BROADCAST_LINES = 6;
    const BROADCAST_LINE_HEIGHT = 20;
    const BROADCAST_MAX = 50;

    // ---------- 種子亂數（跟鬥技場同一份寫法：同一個 round 永遠算出同一組結果） ----------
    function hashSeed(str) {
        let h = 1779033703 ^ str.length;
        for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
        return h >>> 0;
    }
    function mulberry32(seed) {
        let s = seed >>> 0;
        return function () {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function seededRand(str) { return mulberry32(hashSeed(str)); }
    function riWith(rand, min, max) { return min + Math.floor(rand() * (max - min + 1)); }

    // ---------- 骰子點位 ----------
    const DICE_DOTS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
    function dotsGridHTML(n) {
        const lit = DICE_DOTS[n] || [];
        let cells = '';
        for (let i = 0; i < 9; i++) cells += `<span class="casino2-dot${lit.includes(i) ? ' lit' : ''}"></span>`;
        return cells;
    }

    // ---------- 純函式：一次算完「這一局」的 NPC 喊價／NPC 下注／骰子（不碰 DOM、不碰計時器，同一 round 結果恆定） ----------
    function simulateRound(round) {
        const rand = seededRand('casino2|' + round);

        // 搶莊事件：時間排好後，讓金額嚴格遞增，確保畫面上喊價順序＝金額大小順序。
        const bidCount = 1 + Math.floor(rand() * 20);
        let bidTimes = [];
        for (let i = 0; i < bidCount; i++) bidTimes.push(Math.round(rand() * BID_MS));
        bidTimes.sort((a, b) => a - b);
        let bidEvents = [];
        let cur = NPC_BID_MIN + rand() * (NPC_BID_MAX - NPC_BID_MIN) * 0.12;
        for (let i = 0; i < bidCount; i++) {
            cur = Math.min(NPC_BID_MAX, Math.round(cur * (1.08 + rand() * 0.35)));
            let name = 'NPC' + riWith(rand, 100, 999);
            try { if (typeof pvpRandomNameWith === 'function') name = pvpRandomNameWith(rand); } catch (e) {}
            bidEvents.push({ t: bidTimes[i], name, amount: cur });
        }
        const finalNpcBid = bidEvents.length ? bidEvents[bidEvents.length - 1].amount : NPC_BID_MIN;
        const finalNpcBidName = bidEvents.length ? bidEvents[bidEvents.length - 1].name : 'NPC' + riWith(rand, 100, 999);

        // 下注事件
        const betCount = 10 + Math.floor(rand() * 50);
        let betEvents = [];
        for (let i = 0; i < betCount; i++) {
            const t = Math.round(rand() * BET_MS);
            const side = rand() < 0.5 ? 'big' : 'small';
            const amount = Math.round((NPC_BET_MIN + rand() * (NPC_BET_MAX - NPC_BET_MIN)) / 10) * 10;
            let name = 'NPC' + riWith(rand, 100, 999);
            try { if (typeof pvpRandomNameWith === 'function') name = pvpRandomNameWith(rand); } catch (e) {}
            betEvents.push({ t, side, amount, name });
        }
        betEvents.sort((a, b) => a.t - b.t);

        const dice = [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)];
        return { bidEvents, finalNpcBid, finalNpcBidName, betEvents, dice };
    }
    const _simCache = {};   // round -> sim 結果（純記憶體快取，重整頁面就清空，不持久化）
    const SIM_CACHE_KEEP = 50;   // 只保留最近 50 局，避免分頁開很久記憶體一直長大
    let _maxSeenRound = -1;
    function getSim(round) {
        if (!_simCache[round]) _simCache[round] = simulateRound(round);
        if (round > _maxSeenRound) {
            _maxSeenRound = round;
            for (const k in _simCache) { if (_maxSeenRound - Number(k) > SIM_CACHE_KEEP) delete _simCache[k]; }
        }
        return _simCache[round];
    }

    // ---------- 局面推算（固定局長度，直接對時間取餘數） ----------
    function phaseInfo() {
        let mod = (Date.now() - ROUND_EPOCH) % ROUND_MS;
        if (mod < 0) mod += ROUND_MS;
        const round = Math.floor((Date.now() - ROUND_EPOCH) / ROUND_MS);
        if (mod < BID_MS) return { round, phase: 'bid', t: mod, remain: BID_MS - mod };
        if (mod < BID_MS + BET_MS) return { round, phase: 'bet', t: mod - BID_MS, remain: BID_MS + BET_MS - mod };
        return { round, phase: 'prep', t: mod - BID_MS - BET_MS, remain: ROUND_MS - mod };
    }
    function betPhaseEndTime(round) { return ROUND_EPOCH + round * ROUND_MS + BID_MS + BET_MS; }

    // 搶莊階段「到目前為止，誰喊得最高」
    function currentLeadingBid(sim, uptoMs, myBid) {
        let leader = null;
        for (const e of sim.bidEvents) {
            if (e.t > uptoMs) break;
            leader = { amount: e.amount, name: e.name };
        }
        if (myBid && myBid.atMs <= uptoMs && (!leader || myBid.amount > leader.amount)) leader = { amount: myBid.amount, name: '你' };
        return leader;
    }
    // 依時間軸重播下注事件，算出「到目前為止」雙方總額（每邊被莊家本錢+對面總額封頂）
    function replayBets(sim, bankerCapital, uptoMs, playerEvent) {
        let events = sim.betEvents.slice();
        if (playerEvent) events = events.concat([playerEvent]);
        events.sort((a, b) => a.t - b.t);
        let totals = { big: 0, small: 0 }, playerApplied = 0;
        for (const ev of events) {
            if (ev.t > uptoMs) break;
            const oppo = ev.side === 'big' ? 'small' : 'big';
            const room = Math.max(0, bankerCapital + totals[oppo] - totals[ev.side]);
            const amt = Math.max(0, Math.min(ev.amount, room));
            if (amt <= 0) continue;
            totals[ev.side] += amt;
            if (ev.isPlayer) playerApplied = amt;
        }
        return { totals, playerApplied };
    }

    // ---------- 玩家自己的搶莊/下注狀態 ----------
    function readState() {
        try { const raw = _lsGet(STATE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    }
    function writeState(st) { try { _lsSet(STATE_KEY, JSON.stringify(st)); } catch (e) {} }
    function clearState() { writeState(null); }

    // 結算：贏了才派彩，輸了本來就已經先扣款。settled 旗標避免重複結算。
    function settleIfNeeded() {
        const st = readState();
        if (!st || st.settled) return;
        if (Date.now() < betPhaseEndTime(st.round)) return;   // 這局下注還沒結束，不結算

        const sim = getSim(st.round);
        let bankerCapital = sim.finalNpcBid, playerIsBanker = false, bidRefund = 0;
        if (st.bid) {
            if (st.bid.amount > sim.finalNpcBid) { playerIsBanker = true; bankerCapital = st.bid.amount; }
            else bidRefund = st.bid.amount;
        }
        const playerEvent = st.bet ? { t: st.bet.atMs, side: st.bet.side, amount: st.bet.amount, isPlayer: true } : null;
        const replay = replayBets(sim, bankerCapital, BET_MS, playerEvent);
        const sum = sim.dice[0] + sim.dice[1] + sim.dice[2];
        const isTriple = sim.dice[0] === sim.dice[1] && sim.dice[1] === sim.dice[2];
        const outcome = isTriple ? 'triple' : (sum <= 10 ? 'small' : 'big');

        let betDelta = 0, betWon = false;
        if (st.bet) {
            betWon = !isTriple && outcome === st.bet.side && replay.playerApplied > 0;
            betDelta = betWon ? replay.playerApplied * 2 : 0;
        }
        let bankDelta = 0;
        if (playerIsBanker) {
            bankDelta = bankerCapital;
            if (isTriple) bankDelta += replay.totals.big + replay.totals.small;
            else {
                const winSide = outcome, loseSide = outcome === 'big' ? 'small' : 'big';
                bankDelta += replay.totals[loseSide] - replay.totals[winSide];
            }
        }
        const total = bidRefund + betDelta + bankDelta;
        if (total) pandoraAdjustSharedDiamonds(total);

        const pnl = playerIsBanker ? (bankDelta - bankerCapital) : (st.bet ? (betWon ? st.bet.amount : -st.bet.amount) : 0);
        const diceStr = sim.dice.join('、');
        const resultTag = isTriple ? '全豹' : (outcome === 'big' ? '大' : '小');
        let text = null;
        if (playerIsBanker) {
            if (pnl > 0) text = `【公告】本局開 ${diceStr}【${resultTag}】，莊家本局收益 ${pnl.toLocaleString()} 龍鑽`;
            else if (pnl < 0) text = `【公告】本局開 ${diceStr}【${resultTag}】，莊家本局虧損 ${Math.abs(pnl).toLocaleString()} 龍鑽`;
            else text = `【公告】本局開 ${diceStr}【${resultTag}】，莊家本局打平`;
        } else if (st.bet) {
            if (pnl > 0) text = `【公告】本局開 ${diceStr}【${resultTag}】，恭喜你獲得 ${pnl.toLocaleString()} 龍鑽`;
            else if (pnl < 0) text = `【公告】本局開 ${diceStr}【${resultTag}】，本局沒中，虧損 ${Math.abs(pnl).toLocaleString()} 龍鑽`;
            else text = `【公告】本局開 ${diceStr}【${resultTag}】，本局沒有輸贏`;
        } else if (st.bid) {
            text = `【公告】搶莊未搶贏，本金已全額退回`;
        }
        if (text) _lastResult = { round: st.round, text, pushed: false };

        st.settled = true;
        writeState(st);
    }

    // 搶莊：只在搶莊階段、比目前最高出價更高才生效
    function playerBid(amount) {
        amount = Math.floor(Number(String(amount).replace(/[^0-9.]/g, '')));
        if (!amount || amount <= 0) return { ok: false, error: '請輸入有效的搶莊金額。' };
        settleIfNeeded();
        const info = phaseInfo();
        if (info.phase !== 'bid') return { ok: false, error: '目前不是搶莊時間。' };
        let st = readState();
        const myPrevBid = (st && st.round === info.round) ? st.bid : null;
        const sim = getSim(info.round);
        const leader = currentLeadingBid(sim, info.t, null);
        if (leader && amount <= leader.amount) return { ok: false, error: `出價必須高於目前最高出價（${leader.amount.toLocaleString()}）。` };
        if (myPrevBid && amount <= myPrevBid.amount) return { ok: false, error: `出價必須比你上次出的（${myPrevBid.amount.toLocaleString()}）更高。` };
        const refund = myPrevBid ? myPrevBid.amount : 0;
        const balance = pandoraGetSharedDiamonds();
        if (balance + refund < amount) return { ok: false, error: '龍鑽不足。' };
        if (refund > 0) pandoraAdjustSharedDiamonds(refund);
        const adj = pandoraAdjustSharedDiamonds(-amount);
        if (!adj || !adj.ok) { if (refund > 0) pandoraAdjustSharedDiamonds(-refund); return { ok: false, error: '龍鑽不足。' }; }
        if (!st || st.round !== info.round) st = { round: info.round, bid: null, bet: null, settled: false };
        st.bid = { amount, atMs: info.t };
        writeState(st);
        pushBroadcast(`你　${myPrevBid ? '加碼出價' : '出價'}　${amount.toLocaleString()}`, 'word-me');
        return { ok: true };
    }
    // 下注：只在下注階段、還沒下過這局才生效
    function playerBet(side, amount) {
        amount = Math.floor(Number(String(amount).replace(/[^0-9.]/g, '')));
        if (!amount || amount <= 0) return { ok: false, error: '請輸入有效的下注金額。' };
        settleIfNeeded();
        const info = phaseInfo();
        if (info.phase !== 'bet') return { ok: false, error: '目前不是下注時間。' };
        let st = readState();
        if (st && st.round === info.round && st.bet) return { ok: false, error: '本局已經下過注了。' };
        const sim = getSim(info.round);
        if (st && st.round === info.round && st.bid && st.bid.amount > sim.finalNpcBid) return { ok: false, error: '你這局是莊家，不能再下注。' };
        const balance = pandoraGetSharedDiamonds();
        if (balance < amount) return { ok: false, error: '龍鑽不足。' };
        let bankerCapital = sim.finalNpcBid;
        if (st && st.bid && st.bid.amount > sim.finalNpcBid) bankerCapital = st.bid.amount;
        const replay = replayBets(sim, bankerCapital, info.t, null);
        const oppo = side === 'big' ? 'small' : 'big';
        const room = Math.max(0, bankerCapital + replay.totals[oppo] - replay.totals[side]);
        if (room <= 0) return { ok: false, error: '這一側目前額度已滿，無法再下注。' };
        const finalAmt = Math.min(amount, room);
        const adj = pandoraAdjustSharedDiamonds(-finalAmt);
        if (!adj || !adj.ok) return { ok: false, error: '龍鑽不足。' };
        if (!st || st.round !== info.round) st = { round: info.round, bid: st && st.round === info.round ? st.bid : null, bet: null, settled: false };
        st.bet = { side, amount: finalAmt, atMs: info.t };
        writeState(st);
        pushBroadcast(`你　${side === 'big' ? '<span class="word-big">壓大</span>' : '<span class="word-small">壓小</span>'}　${finalAmt.toLocaleString()}`, 'word-me');
        return { ok: true, amount: finalAmt, clamped: finalAmt < amount };
    }

    // ---------- 視窗＋拖曳（照抄鬥技場／js/20-warehouse-window.js） ----------
    let drag = null;
    let refreshTimer = null;
    let scheduled = [];   // 排程中、還沒觸發的 setTimeout id（換局/關視窗要清掉）
    let curRoundKey = null;   // `${round}|${phase}`，用來偵測「有沒有換階段」
    let lastAnnouncedRound = -1;   // 上次已經公告過的局號
    let _lastResult = null;   // 這局結算摘要（settleIfNeeded 寫入，refreshView 推播）
    let _diceShownForRound = null;   // 骰子已經揭曉過的局號

    function injectStyle() {
        if (document.getElementById('casino2-style')) return;
        const style = document.createElement('style');
        style.id = 'casino2-style';
        style.textContent = `
#casino2-window { position:fixed; left:calc(50% - 400px); top:calc(50% - 245px); z-index:9000; }
#casino2-window.hidden { display:none; }
#casino2-frame { width:min(${CANVAS_W}px,92vw); background:#0d0c0a; border:1px solid #57534e; border-radius:8px; box-shadow:0 12px 40px rgba(0,0,0,.6); overflow:hidden; }
#casino2-drag { display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:#1c1917; border-bottom:1px solid #3f3a34; cursor:move; user-select:none; }
#casino2-drag .title { color:#facc15; font-weight:700; font-size:.85rem; }
#casino2-phase { color:#93c5fd; font-weight:700; font-size:.78rem; }
#casino2-close { background:#3f2d13; color:#f5deb3; border:1px solid #78350f; border-radius:4px; padding:2px 8px; font-size:.8rem; cursor:pointer; }
#casino2-canvas { position:relative; width:100%; aspect-ratio:${CANVAS_W}/${CANVAS_H}; background:url('${ARENA_BG}') center/cover no-repeat; }
.casino2-dice-row { position:absolute; left:50%; top:${DICE_TOP}%; transform:translateX(-50%); z-index:4; display:flex; gap:14px; }
.casino2-die { width:${DICE_SIZE}px; height:${DICE_SIZE}px; border-radius:${Math.round(DICE_SIZE * 0.19)}px; background:linear-gradient(135deg,#fdf6e3,#f5deb3); border:2px solid #4a2c0f; box-shadow:0 3px 8px rgba(0,0,0,.5); position:relative; display:grid; grid-template-columns:repeat(3,1fr); grid-template-rows:repeat(3,1fr); padding:${Math.round(DICE_SIZE * 0.135)}px; box-sizing:border-box; transition:box-shadow .2s ease; }
.casino2-die.hl { animation:casino2-blink .18s ease-in-out 3; }
@keyframes casino2-blink { 0%,100% { box-shadow:none; } 50% { box-shadow:0 0 0 3px #facc15, 0 0 14px 4px rgba(250,204,21,.8); } }
.casino2-dot { border-radius:50%; background:transparent; margin:auto; width:70%; height:70%; }
.casino2-dot.lit { background:#3f2d13; }
.casino2-broadcast { position:absolute; left:${BROADCAST_LEFT}%; right:${BROADCAST_RIGHT}%; bottom:${PANEL_BOTTOM}%; height:${BROADCAST_LINES * BROADCAST_LINE_HEIGHT}px; overflow-y:auto; z-index:4; scrollbar-width:none; -ms-overflow-style:none; display:flex; flex-direction:column; gap:1px; }
.casino2-broadcast::-webkit-scrollbar { display:none; width:0; height:0; }
.casino2-broadcast div { font-size:12px; font-weight:700; line-height:${BROADCAST_LINE_HEIGHT}px; text-shadow:0 1px 3px #000,0 0 6px #000; flex-shrink:0; color:#d4d4d8; }
.casino2-broadcast div.row-announce { color:#fde68a; }
.casino2-broadcast .word-big { color:#7dd3fc; font-weight:800; }
.casino2-broadcast .word-small { color:#f87171; font-weight:800; }
.casino2-broadcast .word-bid { color:#fb923c; font-weight:800; }
.casino2-broadcast .word-me { color:#93c5fd; font-weight:800; }
.casino2-bet { position:absolute; right:2%; bottom:${PANEL_BOTTOM}%; z-index:5; width:${BET_PANEL_WIDTH}px; display:flex; flex-direction:column; gap:6px; }
.casino2-bet-btns { display:flex; gap:6px; }
.casino2-bet-btn { flex:1; min-width:0; border-radius:6px; border-width:1px; border-style:solid; padding:8px 4px; cursor:pointer; text-align:center; font-weight:800; font-size:.8rem; }
.casino2-bet-btn:disabled { opacity:.4; cursor:not-allowed; filter:grayscale(.4); }
.casino2-bet-btn.bid { background:linear-gradient(135deg,#78350f 0%,#b45309 28%,#5c2f0a 52%,#92400e 76%,#451a03 100%); color:#fde68a; border-color:#d97706; }
.casino2-bet-btn.big { background:linear-gradient(135deg,#0c4a5e 0%,#0e7490 28%,#0a3d4d 52%,#11657e 76%,#093440 100%); color:#7dd3fc; border-color:#0891b2; }
.casino2-bet-btn.small { background:linear-gradient(135deg,#6b1010 0%,#b91c1c 28%,#450a0a 52%,#991b1b 76%,#3f0d0d 100%); color:#fca5a5; border-color:#dc2626; }
.casino2-totals { position:absolute; left:50%; top:${TOTALS_TOP}%; transform:translateX(-50%); z-index:4; text-align:center; width:${TOTALS_WIDTH}px; display:flex; flex-direction:column; gap:8px; }
.casino2-banker-box { border:2px solid #d97706; border-radius:8px; padding:8px 16px; background:rgba(13,12,10,.75); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.casino2-banker-box b { color:#facc15; font-weight:800; }
.casino2-totals-row { display:flex; gap:10px; }
.casino2-totals-box { flex:1; border:2px solid #57534e; border-radius:8px; padding:8px 12px; background:rgba(13,12,10,.75); }
.casino2-totals-box.big { border-color:#0891b2; }
.casino2-totals-box.small { border-color:#dc2626; }
.casino2-totals-line1 { font-weight:900; font-size:24px; color:#e7e2d8; text-shadow:0 1px 3px #000; }
.casino2-totals-line2 { font-size:12px; color:#e7e2d8; margin-top:2px; text-shadow:0 1px 3px #000; }
.casino2-totals-line2 b { color:#facc15; font-weight:800; }
.casino2-bet-panel { background:rgba(13,12,10,.88); border:1px solid #57534e; border-radius:8px; padding:8px; }
.casino2-bet-panel input { width:100%; box-sizing:border-box; background:#1c1917; border:1px solid #57534e; color:#fde68a; border-radius:4px; padding:5px 8px; font-size:12px; text-align:center; }
.casino2-bet-panel input:disabled { opacity:.5; }
.casino2-balance { margin-top:4px; font-size:11px; text-align:center; color:#facc15; text-shadow:0 1px 3px #000; }
.casino2-bet-msg { margin-top:2px; font-size:11px; text-align:center; min-height:0; line-height:1.3; color:#facc15; text-shadow:0 1px 3px #000; }
`;
        document.head.appendChild(style);
    }

    function buildWindowDom() {
        if (document.getElementById('casino2-window')) return;
        injectStyle();
        const win = document.createElement('div');
        win.id = 'casino2-window';
        win.className = 'hidden';
        win.innerHTML = `
            <div id="casino2-frame">
                <div id="casino2-drag">
                    <span class="title">骰子賭場</span>
                    <span id="casino2-phase"></span>
                    <button type="button" id="casino2-close">關閉</button>
                </div>
                <div id="casino2-canvas">
                    <div class="casino2-dice-row">
                        <div class="casino2-die" id="casino2-die-0"></div>
                        <div class="casino2-die" id="casino2-die-1"></div>
                        <div class="casino2-die" id="casino2-die-2"></div>
                    </div>
                    <div class="casino2-totals" id="casino2-totals">
                        <div class="casino2-banker-box">當前莊家：<b id="casino2-banker-name">尚未決定</b>　莊家本錢：<b id="casino2-banker-capital">－</b></div>
                        <div class="casino2-totals-row">
                            <div class="casino2-totals-box big">
                                <div class="casino2-totals-line1" id="casino2-total-big">－</div>
                                <div class="casino2-totals-line2">還能壓大上限：<b id="casino2-limit-big">－</b></div>
                            </div>
                            <div class="casino2-totals-box small">
                                <div class="casino2-totals-line1" id="casino2-total-small">－</div>
                                <div class="casino2-totals-line2">還能壓小上限：<b id="casino2-limit-small">－</b></div>
                            </div>
                        </div>
                    </div>
                    <div class="casino2-broadcast" id="casino2-broadcast"></div>
                    <div class="casino2-bet" id="casino2-bet">
                        <div class="casino2-bet-btns">
                            <button type="button" class="casino2-bet-btn bid" id="casino2-bid-btn">搶莊</button>
                            <button type="button" class="casino2-bet-btn big" id="casino2-big-btn">壓大</button>
                            <button type="button" class="casino2-bet-btn small" id="casino2-small-btn">壓小</button>
                        </div>
                        <div class="casino2-bet-panel">
                            <input type="text" inputmode="numeric" id="casino2-amt" placeholder="下注數量" value="1000">
                            <div class="casino2-balance" id="casino2-balance"></div>
                            <div class="casino2-bet-msg" id="casino2-bet-msg"></div>
                        </div>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(win);

        const handle = document.getElementById('casino2-drag');
        document.getElementById('casino2-close').onclick = closeCasino2;
        handle.addEventListener('pointerdown', event => {
            if (event.target.closest('button')) return;
            const rect = win.getBoundingClientRect();
            drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
            handle.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        handle.addEventListener('pointermove', event => {
            if (!drag || drag.id !== event.pointerId) return;
            const maxX = Math.max(0, innerWidth - win.offsetWidth);
            const maxY = Math.max(0, innerHeight - win.offsetHeight);
            win.style.left = Math.max(0, Math.min(maxX, event.clientX - drag.dx)) + 'px';
            win.style.top = Math.max(0, Math.min(maxY, event.clientY - drag.dy)) + 'px';
        });
        function stop(event) { if (drag && drag.id === event.pointerId) drag = null; }
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);

        function showMsg(r) {
            const el = document.getElementById('casino2-bet-msg');
            if (!el) return;
            if (r.ok) el.textContent = r.clamped ? `額度不足，已自動調整為 ${r.amount.toLocaleString()}。` : '';
            else el.textContent = r.error || '操作失敗。';
        }
        document.getElementById('casino2-bid-btn').onclick = () => { showMsg(playerBid(document.getElementById('casino2-amt').value)); };
        document.getElementById('casino2-big-btn').onclick = () => { showMsg(playerBet('big', document.getElementById('casino2-amt').value)); };
        document.getElementById('casino2-small-btn').onclick = () => { showMsg(playerBet('small', document.getElementById('casino2-amt').value)); };
    }

    // ---------- 播報區 ----------
    let broadcastLog = [];
    function pushBroadcast(text, cls) {
        broadcastLog.push({ text, cls: cls || 'row-plain' });
        if (broadcastLog.length > BROADCAST_MAX) broadcastLog.shift();
        const el = document.getElementById('casino2-broadcast');
        if (!el) return;
        const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10;
        el.innerHTML = broadcastLog.map(e => `<div class="${e.cls}">${e.text}</div>`).join('');
        if (wasAtBottom) el.scrollTop = el.scrollHeight;
    }
    function clearScheduled() { scheduled.forEach(id => clearTimeout(id)); scheduled = []; }

    // 追蹤這一局播報進度：喊價播到第幾筆、下注播到第幾筆
    let _bcCursor = { round: null, bidIdx: 0, betIdx: 0 };
    function flushBidBroadcast(sim, uptoT) {
        while (_bcCursor.bidIdx < sim.bidEvents.length && sim.bidEvents[_bcCursor.bidIdx].t <= uptoT) {
            const e = sim.bidEvents[_bcCursor.bidIdx];
            pushBroadcast(`【<span class="word-bid">搶莊</span>】${e.name}　出價　${e.amount.toLocaleString()}`);
            _bcCursor.bidIdx++;
        }
    }
    function flushBetBroadcast(sim, uptoT) {
        while (_bcCursor.betIdx < sim.betEvents.length && sim.betEvents[_bcCursor.betIdx].t <= uptoT) {
            const e = sim.betEvents[_bcCursor.betIdx];
            const sideSpan = e.side === 'big' ? '<span class="word-big">壓大</span>' : '<span class="word-small">壓小</span>';
            pushBroadcast(`${e.name}　${sideSpan}　出價 ${e.amount.toLocaleString()}`);
            _bcCursor.betIdx++;
        }
    }
    function ensureBroadcastCursor(round) {
        if (_bcCursor.round !== round) { _bcCursor = { round, bidIdx: 0, betIdx: 0 }; pushBroadcast(`── 第 ${round} 局．開放搶莊 ──`, 'row-announce'); }
    }

    function setPhaseLabel(text) { const el = document.getElementById('casino2-phase'); if (el) el.textContent = text; }

    // ---------- 骰子揭曉 ----------
    function showDiceBlank() { for (let i = 0; i < 3; i++) { const el = document.getElementById('casino2-die-' + i); if (el) { el.innerHTML = ''; el.classList.remove('hl'); } } }
    function showDiceInstant(dice) { for (let i = 0; i < 3; i++) { const el = document.getElementById('casino2-die-' + i); if (el) { el.innerHTML = dotsGridHTML(dice[i]); el.classList.remove('hl'); } } }
    function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
    async function revealSequential(round, dice) {
        for (let i = 0; i < 3; i++) {
            const st = phaseInfo();
            if (st.round !== round || st.phase !== 'prep') return;   // 局已經跳走就中止
            const el = document.getElementById('casino2-die-' + i);
            if (el) { el.innerHTML = dotsGridHTML(dice[i]); el.classList.add('hl'); }
            await wait(400);
            if (el) el.classList.remove('hl');
            await wait(300);
        }
    }

    // ---------- 主循環：每 300ms 檢查一次目前局/階段，換了才重新佈置畫面；每次tick都核對結算/播報有沒有漏 ----------
    const PHASE_LABEL = { bid: '搶莊中', bet: '下注中', prep: '場地準備中' };
    async function refreshView() {
        settleIfNeeded();
        const info = phaseInfo();
        const sim = getSim(info.round);
        ensureBroadcastCursor(info.round);

        if (info.phase === 'bid') flushBidBroadcast(sim, info.t);
        else { flushBidBroadcast(sim, BID_MS); flushBetBroadcast(sim, info.phase === 'bet' ? info.t : BET_MS); }

        // 🩹 補救機制：不管有沒有剛好抓到 prep 開始那一瞬間，只要「這局已經結束但還沒公告」就補公告一次。
        if (info.round > lastAnnouncedRound && (info.phase !== 'bid')) {
            if (_lastResult && _lastResult.round === info.round && !_lastResult.pushed) {
                pushBroadcast(_lastResult.text, 'row-announce');
                _lastResult.pushed = true;
            }
            if (info.phase === 'prep') lastAnnouncedRound = info.round;
        }

        // 骰子：搶莊/下注階段清空；場地準備階段第一次偵測到就揭曉
        const key = info.round + '|' + info.phase;
        if (key !== curRoundKey) {
            curRoundKey = key;
            if (info.phase !== 'prep') { showDiceBlank(); _diceShownForRound = null; }
        }
        if (info.phase === 'prep' && _diceShownForRound !== info.round) {
            _diceShownForRound = info.round;
            clearScheduled();
            revealSequential(info.round, sim.dice);
        }

        // 莊家/總額面板
        const st = readState();
        const myBid = (st && st.round === info.round) ? st.bid : null;
        const myBet = (st && st.round === info.round) ? st.bet : null;
        let bankerLabel = '尚未決定', bankerCapital = 0;
        if (info.phase === 'bid') {
            const leader = currentLeadingBid(sim, info.t, myBid);
            if (leader) { bankerLabel = leader.name; bankerCapital = leader.amount; }
        } else {
            bankerCapital = sim.finalNpcBid; bankerLabel = sim.finalNpcBidName;
            if (myBid && myBid.amount > sim.finalNpcBid) { bankerCapital = myBid.amount; bankerLabel = '你'; }
        }
        const nameEl = document.getElementById('casino2-banker-name'); if (nameEl) nameEl.textContent = bankerLabel;
        const capEl = document.getElementById('casino2-banker-capital'); if (capEl) capEl.textContent = bankerCapital.toLocaleString();

        let totals = { big: 0, small: 0 };
        if (info.phase === 'bet') {
            const playerEvent = myBet ? { t: myBet.atMs, side: myBet.side, amount: myBet.amount, isPlayer: true } : null;
            totals = replayBets(sim, bankerCapital, info.t, playerEvent).totals;
        } else if (info.phase === 'prep') {
            const playerEvent = myBet ? { t: myBet.atMs, side: myBet.side, amount: myBet.amount, isPlayer: true } : null;
            totals = replayBets(sim, bankerCapital, BET_MS, playerEvent).totals;
        }
        const tBig = document.getElementById('casino2-total-big'); if (tBig) tBig.textContent = totals.big.toLocaleString();
        const tSmall = document.getElementById('casino2-total-small'); if (tSmall) tSmall.textContent = totals.small.toLocaleString();
        const lBig = document.getElementById('casino2-limit-big'); if (lBig) lBig.textContent = Math.max(0, bankerCapital + totals.small - totals.big).toLocaleString();
        const lSmall = document.getElementById('casino2-limit-small'); if (lSmall) lSmall.textContent = Math.max(0, bankerCapital + totals.big - totals.small).toLocaleString();

        // 按鈕開關：搶莊只在bid階段且這局還沒喊過就disable；壓注只在bet階段且這局還沒下過
        const bidBtn = document.getElementById('casino2-bid-btn');
        const bigBtn = document.getElementById('casino2-big-btn');
        const smallBtn = document.getElementById('casino2-small-btn');
        if (bidBtn) bidBtn.disabled = info.phase !== 'bid';
        if (bigBtn) bigBtn.disabled = !(info.phase === 'bet' && !myBet);
        if (smallBtn) smallBtn.disabled = !(info.phase === 'bet' && !myBet);

        setPhaseLabel(`第 ${info.round} 局・${PHASE_LABEL[info.phase]}（${Math.ceil(info.remain / 1000)}秒）`);
        const balEl = document.getElementById('casino2-balance');
        if (balEl) balEl.textContent = `目前龍鑽餘額：${pandoraGetSharedDiamonds().toLocaleString()}`;
    }

    function stopAll() {
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        clearScheduled();
    }

    async function openCasino2() {
        buildWindowDom();
        const win = document.getElementById('casino2-window');
        win.classList.remove('hidden');
        stopAll();
        curRoundKey = null;
        await refreshView();
        refreshTimer = setInterval(refreshView, 300);
    }
    function closeCasino2() {
        const win = document.getElementById('casino2-window');
        if (win) win.classList.add('hidden');
        stopAll();
    }
    window.openCasino2 = openCasino2;

    // ---------- 按鈕注入 ----------
    function injectButton() {
        const ref = document.getElementById('btn-pandora-shop');
        if (!ref || document.getElementById('btn-casino2')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-casino2';
        btn.className = 'bg-amber-950 hover:bg-amber-900 px-3 py-1 text-amber-200 font-bold border border-amber-700 rounded text-sm shadow-md whitespace-nowrap min-w-[3.25rem] text-center';
        btn.title = '天堂賭場（重製版）：搶莊、壓大壓小';
        btn.textContent = '骰子賭場';
        btn.onclick = openCasino2;
        ref.insertAdjacentElement('afterend', btn);
    }
    function init() {
        injectButton();
        setInterval(injectButton, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.__gmCasinoV2Applied = true;
})();

(function () {
    'use strict';

    if (window.__gmPandoraShopApplied) {
        console.warn('[潘朵拉商城] 偵測到已套用過，本次略過。');
        return;
    }
    if (typeof pandoraAdjustSharedDiamonds !== 'function' || typeof pandoraGetSharedDiamonds !== 'function' || typeof _lsGet !== 'function' || typeof _lsSet !== 'function') {
        console.warn('[潘朵拉商城] 缺少龍之鑽石存取函式，請確認載入順序在 js/24-pandora-relic-market.js、js/00-data.js 之後');
        return;
    }
    if (typeof RELIC_CAT_ITEMS === 'undefined' || typeof getIconUrl !== 'function' || typeof gainItem !== 'function' || typeof DB === 'undefined' || typeof relicDexHas !== 'function') {
        console.warn('[潘朵拉商城] 缺少遺物清單/道具存取函式，請確認載入順序在 js/01-drops-config.js、js/21-relic-book.js 之後');
        return;
    }
    if (typeof pandoraRelicTipShow !== 'function' || typeof pandoraTipMove !== 'function' || typeof pandoraTipHide !== 'function') {
        console.warn('[潘朵拉商城] 缺少道具說明彈窗函式，請確認載入順序在 js/14-craft-pandora.js、js/24-pandora-relic-market.js 之後');
        return;
    }
    if (typeof killMob !== 'function') {
        console.warn('[潘朵拉商城] 缺少 killMob，龍之鑽石掉落功能無法套用，請確認載入順序在 js/05-kill-progression.js 之後');
        return;
    }

    // ================================================================

    const CANVAS_W = 800, CANVAS_H = 450;
    const SHOP_BG = 'assets/area/img/潘朵拉商城.png';
    const DIAMOND_ICON = 'assets/icons/items/龍之鑽石.png';

    const SHOP_REFRESH_MS = 2 * 60 * 60 * 1000;
    const SHOP_SLOT_COUNT = 6;
    const SHOP_PRICE_MIN = 6600, SHOP_PRICE_MAX = 8800, SHOP_PRICE_STEP = 100;

    const COUNTDOWN_TOP = 8;
    const COUNTDOWN_LEFT = 60;
    const COUNTDOWN_SIZE = 20;

    const SHOP_SLOTS = [
        { left: 29.3, top: 13.5, width: 19.3, height: 35.0 },
        { left: 51.3, top: 13.5, width: 20.3, height: 35.0 },
        { left: 74.3, top: 13.5, width: 19.3, height: 35.0 },
        { left: 29.3, top: 52.2, width: 19.3, height: 34.7 },
        { left: 51.3, top: 52.2, width: 20.3, height: 34.7 },
        { left: 74.3, top: 52.2, width: 19.3, height: 34.7 },
    ];
    const SHOP_ICON_BOX = 48;
    const SHOP_ICON_IMG = 40;
    const SHOP_MSG_TOP = 15;

    // ---------- 種子亂數（同一個刷新週期永遠算出同一批商品） ----------
    function hashSeed(str) {
        let h = 1779033703 ^ str.length;
        for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
        return h >>> 0;
    }
    function mulberry32(seed) {
        let s = seed >>> 0;
        return function () {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function seededRand(str) { return mulberry32(hashSeed(str)); }

    // ---------- 遺物池：攤平 RELIC_CAT_ITEMS 所有分類 ----------
    function buildRelicPool() {
        const pool = [];
        for (const k in RELIC_CAT_ITEMS) pool.push(...(RELIC_CAT_ITEMS[k] || []));
        return pool;
    }
    const RELIC_POOL = buildRelicPool();

    // ---------- 這一批(週期)要賣什麼、賣多少錢：純函式，同一個週期永遠算出同一批 ----------
    function currentShopCycle() { return Math.floor(Date.now() / SHOP_REFRESH_MS); }
    function computeShopStock(cycle) {
        const rand = seededRand('pandora-shop|' + cycle);
        const pool = RELIC_POOL.slice();
        const priceSteps = Math.round((SHOP_PRICE_MAX - SHOP_PRICE_MIN) / SHOP_PRICE_STEP);
        const items = [];
        for (let i = 0; i < SHOP_SLOT_COUNT && pool.length; i++) {
            const idx = Math.floor(rand() * pool.length);
            const id = pool.splice(idx, 1)[0];
            const price = SHOP_PRICE_MIN + Math.floor(rand() * (priceSteps + 1)) * SHOP_PRICE_STEP;
            items.push({ id, price });
        }
        return items;
    }
    let _stockCache = { cycle: null, items: null };
    function getShopStock() {
        const cycle = currentShopCycle();
        if (_stockCache.cycle !== cycle) _stockCache = { cycle, items: computeShopStock(cycle) };
        return _stockCache.items;
    }

    // ---------- 這一批裡，哪幾格已經賣掉了（存 localStorage，換批次自動重置） ----------
    const SOLD_KEY = 'pandoraShopSold_v1';
    function loadSold() {
        try {
            const raw = _lsGet(SOLD_KEY);
            const st = raw ? JSON.parse(raw) : null;
            if (st && st.cycle === currentShopCycle()) return st.sold || [];
        } catch (e) {}
        return [];
    }
    function markSold(slotIdx) {
        const sold = loadSold();
        if (!sold.includes(slotIdx)) sold.push(slotIdx);
        try { _lsSet(SOLD_KEY, JSON.stringify({ cycle: currentShopCycle(), sold })); } catch (e) {}
    }

    // ---------- 視窗＋拖曳 ----------
    let drag = null;
    let refreshTimer = null;

    function injectStyle() {
        if (document.getElementById('pandora-shop-style')) return;
        const style = document.createElement('style');
        style.id = 'pandora-shop-style';
        style.textContent = `
/* 🩹 疊層降低，避免蓋住滑鼠懸浮跳出來的道具說明（原本設太高） */
#pandora-shop-window { position:fixed; left:calc(50% - 400px); top:calc(50% - 245px); z-index:150; }   /* 🩹 道具說明框(#pandora-tooltip)是寫死的 z-index:200，這裡必須比它低，才不會蓋住說明框 */
#pandora-shop-window.hidden { display:none; }
#pandora-shop-frame { width:min(${CANVAS_W}px,92vw); background:#0d0c0a; border:1px solid #57534e; border-radius:8px; box-shadow:0 12px 40px rgba(0,0,0,.6); overflow:hidden; }
#pandora-shop-drag { display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:#1c1917; border-bottom:1px solid #3f3a34; cursor:move; user-select:none; }
#pandora-shop-drag .title { color:#facc15; font-weight:700; font-size:.85rem; }
#pandora-shop-close { background:#3f2d13; color:#f5deb3; border:1px solid #78350f; border-radius:4px; padding:2px 8px; font-size:.8rem; cursor:pointer; }
#pandora-shop-canvas { position:relative; width:100%; aspect-ratio:${CANVAS_W}/${CANVAS_H}; background:url('${SHOP_BG}') center/cover no-repeat; }
/* 倒數：紅色字體、無框線 */
.pshop-countdown { position:absolute; left:${COUNTDOWN_LEFT}%; top:${COUNTDOWN_TOP}%; transform:translateX(-50%); font-size:${COUNTDOWN_SIZE}px; font-weight:900; color:#ef4444; text-shadow:0 1px 4px #000,0 0 8px rgba(239,68,68,.6); z-index:4; }
.pshop-msg { position:absolute; left:50%; top:${SHOP_MSG_TOP}%; transform:translateX(-50%); font-size:13px; font-weight:700; color:#facc15; text-shadow:0 1px 3px #000; min-height:16px; z-index:4; }
/* 6格：橫向列表列，仿黑市排法 */
.pshop-slot-abs { position:absolute; z-index:3; }
.pshop-row { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; width:100%; height:100%; padding:8px; box-sizing:border-box; text-align:center; }
.pshop-icon-box { position:relative; width:${SHOP_ICON_BOX}px; height:${SHOP_ICON_BOX}px; background:#0f172a; border:1px solid #475569; border-radius:6px; display:flex; align-items:center; justify-content:center; flex-shrink:0; overflow:hidden; }
.pshop-icon-box img.pshop-icon { width:${SHOP_ICON_IMG}px; height:${SHOP_ICON_IMG}px; object-fit:contain; pointer-events:none; }
.pshop-info { width:100%; }
.pshop-name { font-size:12px; white-space:normal; word-break:break-all; }
.pshop-tag { position:absolute; top:0; left:0; right:0; font-size:9px; font-weight:800; text-align:center; line-height:1.3; padding:1px 0; pointer-events:none; }
.pshop-tag-uncollected { background:rgba(127,29,29,.85); color:#fecaca; }
.pshop-tag-collected { background:rgba(51,65,85,.85); color:#cbd5e1; }
.pshop-price { font-size:12px; color:#3f2d13; display:flex; align-items:center; justify-content:center; gap:3px; margin-top:2px; font-weight:700; }
.pshop-price img { width:16px; height:16px; object-fit:contain; }
.pshop-buy { font-size:11px; font-weight:800; padding:5px 16px; border-radius:5px; border:1px solid #92400e; background:linear-gradient(135deg,#78350f,#b45309); color:#fde68a; cursor:pointer; margin-top:2px; }
.pshop-buy:disabled { opacity:.4; cursor:not-allowed; background:#57534e; border-color:#57534e; color:#a8a29e; }
`;
        document.head.appendChild(style);
    }

    function renderSlots() {
        const wrap = document.getElementById('pandora-shop-slots');
        if (!wrap) return;
        const items = getShopStock();
        const sold = loadSold();
        wrap.innerHTML = items.map((it, i) => {
            const d = DB.items[it.id];
            if (!d) return '';
            const isSold = sold.includes(i);
            const owned = relicDexHas(it.id);
            const tag = `<div class="pshop-tag ${owned ? 'pshop-tag-collected' : 'pshop-tag-uncollected'}">${owned ? '已收藏' : '未收藏'}</div>`;
            const pos = SHOP_SLOTS[i] || SHOP_SLOTS[0];
            return `<div class="pshop-slot-abs" style="left:${pos.left}%;top:${pos.top}%;width:${pos.width}%;height:${pos.height}%;">
                <div class="pshop-row">
                <div class="pshop-icon-box" onmouseenter="pandoraRelicTipShow(event,'${it.id}')" onmousemove="pandoraTipMove(event)" onmouseleave="pandoraTipHide()">
                    ${tag}
                    <img class="pshop-icon" src="${getIconUrl(d)}" alt="${d.n}" onerror="this.style.display='none'">
                </div>
                <div class="pshop-info">
                    <div class="pshop-name"><span class="c-relic">${d.n}</span></div>
                    <div class="pshop-price"><img src="${DIAMOND_ICON}" alt="龍之鑽石"> × ${it.price.toLocaleString()}</div>
                </div>
                <button type="button" class="pshop-buy" data-slot="${i}" ${isSold ? 'disabled' : ''}>${isSold ? '已售完' : '購買'}</button>
                </div>
            </div>`;
        }).join('');
        wrap.querySelectorAll('.pshop-buy').forEach(btn => {
            btn.onclick = () => onBuyClick(Number(btn.dataset.slot));
        });
    }

    function setMsg(text) { const el = document.getElementById('pandora-shop-msg'); if (el) el.textContent = text || ''; }
    function onBuyClick(slotIdx) {
        const items = getShopStock();
        const it = items[slotIdx];
        if (!it) return;
        if (loadSold().includes(slotIdx)) { setMsg('這一批已經賣完了，等下一批刷新。'); return; }
        const balance = pandoraGetSharedDiamonds();
        if (balance < it.price) { setMsg('龍鑽不足。'); return; }
        const result = pandoraAdjustSharedDiamonds(-it.price);
        if (!result || !result.ok) { setMsg('龍鑽不足。'); return; }
        gainItem(it.id, 1);
        markSold(slotIdx);
        const d = DB.items[it.id];
        setMsg(`購買成功：${d ? d.n : it.id}`);
        renderSlots();
    }

    function updateCountdown() {
        const el = document.getElementById('pandora-shop-countdown');
        if (!el) return;
        const nextRefresh = (currentShopCycle() + 1) * SHOP_REFRESH_MS;
        const remain = Math.max(0, nextRefresh - Date.now());
        const h = Math.floor(remain / 3600000);
        const m = Math.floor((remain % 3600000) / 60000);
        const s = Math.floor((remain % 60000) / 1000);
        const pad = n => String(n).padStart(2, '0');
        el.textContent = `刷新倒數：${pad(h)}:${pad(m)}:${pad(s)}`;
    }

    function buildWindowDom() {
        if (document.getElementById('pandora-shop-window')) return;
        injectStyle();
        const win = document.createElement('div');
        win.id = 'pandora-shop-window';
        win.className = 'hidden';
        win.innerHTML = `
            <div id="pandora-shop-frame">
                <div id="pandora-shop-drag">
                    <span class="title">潘朵拉商城</span>
                    <button type="button" id="pandora-shop-close">關閉</button>
                </div>
                <div id="pandora-shop-canvas">
                    <div class="pshop-countdown" id="pandora-shop-countdown"></div>
                    <div class="pshop-msg" id="pandora-shop-msg"></div>
                    <div id="pandora-shop-slots"></div>
                </div>
            </div>`;
        document.body.appendChild(win);

        const handle = document.getElementById('pandora-shop-drag');
        document.getElementById('pandora-shop-close').onclick = closePandoraShop;
        handle.addEventListener('pointerdown', event => {
            if (event.target.closest('button')) return;
            const rect = win.getBoundingClientRect();
            drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
            handle.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        handle.addEventListener('pointermove', event => {
            if (!drag || drag.id !== event.pointerId) return;
            const maxX = Math.max(0, innerWidth - win.offsetWidth);
            const maxY = Math.max(0, innerHeight - win.offsetHeight);
            win.style.left = Math.max(0, Math.min(maxX, event.clientX - drag.dx)) + 'px';
            win.style.top = Math.max(0, Math.min(maxY, event.clientY - drag.dy)) + 'px';
        });
        function stop(event) { if (drag && drag.id === event.pointerId) drag = null; }
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
    }

    let _lastCycle = null;
    function refreshView() {
        const cycle = currentShopCycle();
        if (cycle !== _lastCycle) { _lastCycle = cycle; setMsg(''); renderSlots(); }
        updateCountdown();
    }

    function openPandoraShop() {
        buildWindowDom();
        document.getElementById('pandora-shop-window').classList.remove('hidden');
        _lastCycle = null;
        refreshView();
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(refreshView, 1000);   // 每秒更新一次倒數文字＋檢查有沒有跨批次刷新
    }
    function closePandoraShop() {
        const win = document.getElementById('pandora-shop-window');
        if (win) win.classList.add('hidden');
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    }
    window.openPandoraShop = openPandoraShop;

    // ---------- 按鈕注入 ----------
    function injectButton() {
        const ref = document.getElementById('btn-pandora-shortcut');
        if (!ref || document.getElementById('btn-pandora-shop')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-pandora-shop';
        btn.className = 'bg-purple-950 hover:bg-purple-900 px-3 py-1 text-purple-200 font-bold border border-purple-700 rounded text-sm shadow-md whitespace-nowrap min-w-[3.25rem] text-center';
        btn.title = '潘朵拉商城';
        btn.textContent = '商城';
        btn.onclick = openPandoraShop;
        ref.insertAdjacentElement('afterend', btn);
    }
    function init() {
        injectButton();
        setInterval(injectButton, 2000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    const _origKillMob = killMob;
    killMob = function (idx) {
        const ret = _origKillMob.apply(this, arguments);
        try {
            if (Math.random() < 0.005) {
                const amt = 1 + Math.floor(Math.random() * 10);
                const r = pandoraAdjustSharedDiamonds(amt);
                if (r && r.ok && typeof logSys === 'function') {
                    logSys(`<span class="text-cyan-300 font-bold">意外拾獲 💎 龍之鑽石 x ${amt}！</span>`);
                }
            }
        } catch (e) {}
        return ret;
    };

    function rollOfflineDiamonds(elapsedMs) {
        const ms = Math.max(0, Number(elapsedMs) || 0);
        if (ms < 1000) return;
        const estKills = (ms / 60000) * 240;
        const trials = Math.min(Math.round(estKills), 2000000);
        if (trials <= 0) return;
        let hits = 0;
        for (let i = 0; i < trials; i++) { if (Math.random() < 0.005) hits++; }
        if (hits <= 0) return;
        let total = 0;
        for (let i = 0; i < hits; i++) total += 1 + Math.floor(Math.random() * 10);
        if (total <= 0) return;
        try {
            const r = pandoraAdjustSharedDiamonds(total);
            if (r && r.ok && typeof logSys === 'function') {
                logSys(`<span class="text-cyan-300 font-bold">掛機期間意外拾獲 💎 龍之鑽石 x ${total}！</span>`);
            }
        } catch (e) {}
    }
    if (typeof window.offlineSettleCatchup === 'function') {
        const _origSettleCatchup = window.offlineSettleCatchup;
        window.offlineSettleCatchup = function (elapsedMs, reason) {
            const ret = _origSettleCatchup.apply(this, arguments);
            try { rollOfflineDiamonds(elapsedMs); } catch (e) {}
            return ret;
        };
    } else {
        console.warn('[潘朵拉商城] 缺少 window.offlineSettleCatchup，掛機龍之鑽石掉落這段不會套用（即時掉落跟商城不受影響）');
    }

    window.__gmPandoraShopApplied = true;
})();
