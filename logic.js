/* 封魔の刻 ― ルールエンジン（ブラウザ / Node 共通）
 * 札：2〜99（98枚）。封印の列：のぼり2本（1から）、くだり2本（100から）。
 * のぼり列は大きい札、くだり列は小さい札。ただし「ちょうど10戻す」逆流の術はOK。
 */
(function (root) {
  'use strict';
  var MIN = 2, MAX = 99;

  function rngFrom(seed) {               // mulberry32（?seed= で再現可能に）
    var a = (seed >>> 0) || 1;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffle(a, rng) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function fullDeck() { var d = []; for (var c = MIN; c <= MAX; c++) d.push(c); return d; }
  function handSize(n) { return n <= 1 ? 8 : n === 2 ? 7 : 6; }

  // 置けるか：'normal' / 'back'（逆流の術）/ null
  function canPlace(pile, card) {
    if (pile.d === 'up') { if (card > pile.t) return 'normal'; if (card === pile.t - 10) return 'back'; }
    else { if (card < pile.t) return 'normal'; if (card === pile.t + 10) return 'back'; }
    return null;
  }

  function newGame(pids, opts) {
    opts = opts || {};
    if (!pids.length || pids.length > 5) throw new Error('1〜5人で遊べます');
    var rng = opts.rng || Math.random;
    var deck = opts.deck ? opts.deck.slice() : shuffle(fullDeck(), rng);
    var seen = {};
    deck.forEach(function (c) { if (!(c >= MIN && c <= MAX) || seen[c]) throw new Error('bad deck'); seen[c] = 1; });
    var hs = handSize(pids.length), hands = {};
    pids.forEach(function (p) { hands[p] = deck.splice(0, hs).sort(function (a, b) { return a - b; }); });
    var G = {
      pids: pids.slice(), hs: hs, deck: deck, hands: hands, total: deck.length + pids.length * hs,
      piles: [{ d: 'up', t: 1, n: 0 }, { d: 'up', t: 1, n: 0 }, { d: 'down', t: 100, n: 0 }, { d: 'down', t: 100, n: 0 }],
      turnIdx: (opts.startIdx || 0) % pids.length, played: 0, moves: 0, turns: 1, phase: 'play', end: null, history: [], backs: 0
    };
    G.total = G.deck.length + pids.reduce(function (a, p) { return a + hands[p].length; }, 0);
    skipEmpty(G);
    checkStuck(G);
    return G;
  }
  function currentPid(G) { return G.pids[G.turnIdx]; }
  function minPlays(G) { return G.deck.length > 0 ? 2 : 1; }
  function remaining(G) { return G.deck.length + G.pids.reduce(function (a, p) { return a + G.hands[p].length; }, 0); }
  function legalMoves(G, pid) {
    var out = [];
    (G.hands[pid] || []).forEach(function (c) { G.piles.forEach(function (p, i) { var k = canPlace(p, c); if (k) out.push({ card: c, pile: i, kind: k, jump: k === 'back' ? -10 : Math.abs(c - p.t) }); }); });
    return out;
  }
  // 残りの必要枚数を続けて出せるか（小さな探索）
  function canMeetMin(G, pid) {
    var need = minPlays(G) - G.played;
    if (need <= 0) return true;
    var hand = (G.hands[pid] || []).slice(), tops = G.piles.map(function (p) { return { d: p.d, t: p.t }; });
    function dfs(k) {
      if (k === 0) return true;
      for (var i = 0; i < hand.length; i++) for (var j = 0; j < 4; j++) {
        var c = hand[i]; if (c == null || !canPlace(tops[j], c)) continue;
        var old = tops[j].t; tops[j].t = c; hand[i] = null;
        var ok = dfs(k - 1); tops[j].t = old; hand[i] = c;
        if (ok) return true;
      }
      return false;
    }
    return dfs(need);
  }
  function skipEmpty(G) {
    for (var k = 0; k < G.pids.length; k++) { if (G.hands[currentPid(G)].length) return; G.turnIdx = (G.turnIdx + 1) % G.pids.length; }
  }
  function checkWin(G) { if (remaining(G) === 0) { G.phase = 'won'; G.end = { won: true, left: 0 }; return true; } return false; }
  function checkStuck(G) {
    if (G.phase !== 'play') return;
    var pid = currentPid(G);
    if (G.played < minPlays(G) && legalMoves(G, pid).length === 0) {
      G.phase = 'lost';
      G.end = { won: false, left: remaining(G), stuck: pid, need: minPlays(G), played: G.played };
    }
  }

  function play(G, pid, card, pileIdx) {
    if (G.phase !== 'play') throw new Error('ゲームは終了しています');
    if (currentPid(G) !== pid) throw new Error('あなたの番ではありません');
    var hand = G.hands[pid], hi = hand.indexOf(card);
    if (hi < 0) throw new Error('その札は持っていません');
    var pile = G.piles[pileIdx]; if (!pile) throw new Error('列がありません');
    var kind = canPlace(pile, card);
    if (!kind) throw new Error('その列には置けません');
    var from = pile.t;
    hand.splice(hi, 1); pile.t = card; pile.n++; G.played++; G.moves++;
    if (kind === 'back') G.backs++;
    var ev = { by: pid, card: card, pile: pileIdx, from: from, back: kind === 'back', jump: Math.abs(card - from) };
    G.history.push(ev);
    if (checkWin(G)) return ev;
    if (!hand.length) { ev.autoEnd = true; endTurn(G, pid); return ev; }   // 手札がなくなったら自動で手番終了
    checkStuck(G);
    return ev;
  }
  function canEndTurn(G, pid) { return G.phase === 'play' && currentPid(G) === pid && G.played >= minPlays(G); }
  function endTurn(G, pid) {
    if (!canEndTurn(G, pid)) throw new Error(G.played < minPlays(G) ? 'あと' + (minPlays(G) - G.played) + '枚以上出してください' : 'あなたの番ではありません');
    var hand = G.hands[pid], drew = 0;
    while (hand.length < G.hs && G.deck.length) { hand.push(G.deck.shift()); drew++; }
    hand.sort(function (a, b) { return a - b; });
    G.played = 0; G.moves++; G.turns++;
    G.turnIdx = (G.turnIdx + 1) % G.pids.length;
    skipEmpty(G);
    if (!checkWin(G)) checkStuck(G);
    return { drew: drew };
  }
  function skipTurn(G) {   // 切断中の人の番を飛ばす（ホスト操作）
    if (G.phase !== 'play') return;
    var pid = currentPid(G), hand = G.hands[pid];
    while (hand.length < G.hs && G.deck.length) hand.push(G.deck.shift());
    hand.sort(function (a, b) { return a - b; });
    G.played = 0; G.moves++; G.turns++;
    G.turnIdx = (G.turnIdx + 1) % G.pids.length; skipEmpty(G); checkStuck(G);
  }

  // ---- 危険度（復活ゲージ 0〜100）----
  function danger(G) {
    if (G.phase === 'lost') return 100;
    if (G.phase === 'won') return 0;
    var un = G.deck.slice(); G.pids.forEach(function (p) { un = un.concat(G.hands[p]); });
    if (!un.length) return 0;
    var cov = 0, dead = 0;
    un.forEach(function (c) {
      var k = 0, any = false;
      G.piles.forEach(function (p) { var r = canPlace(p, c); if (r === 'normal') k++; if (r) any = true; });
      cov += k; if (!any) dead++;
    });
    cov /= un.length;                                              // 1枚あたり置ける列の数（開始時は4）
    var dCov = clamp((3.2 - cov) / 2.6);
    var dDead = clamp(dead / Math.max(3, un.length * 0.2));
    var pid = currentPid(G), lm = legalMoves(G, pid);
    var n = lm.length, best = 99;
    lm.forEach(function (m) { if (m.jump < best) best = m.kind === 'back' ? 0 : m.jump; });
    var lf = n === 0 ? 1 : n <= 1 ? 0.8 : n <= 2 ? 0.55 : n <= 4 ? 0.3 : 0.1;
    var dHand = 0.5 * lf + 0.5 * clamp((best - 2) / 22);
    var d = 100 * (0.42 * dCov + 0.28 * dDead + 0.30 * dHand);
    if (!canMeetMin(G, pid)) d = Math.max(d, 92);
    return Math.round(clamp(d / 100) * 100);
  }
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function stage(d) { return d >= 82 ? 4 : d >= 65 ? 3 : d >= 45 ? 2 : d >= 25 ? 1 : 0; }
  function rating(left) {
    if (left === 0) return { key: 'perfect', label: '完全封印', text: 'すべての札を使いきった！ 悪魔は永き眠りへ…' };
    if (left <= 10) return { key: 'great', label: '見事！', text: '残り10枚以下。あと少しで完全封印だった！' };
    if (left <= 25) return { key: 'good', label: 'おしい…', text: '封印はほころびたが、悪魔はまだ弱っている。' };
    return { key: 'bad', label: '完敗', text: '悪魔の力が封印を上回った…' };
  }

  var api = { MIN: MIN, MAX: MAX, rngFrom: rngFrom, shuffle: shuffle, fullDeck: fullDeck, handSize: handSize, canPlace: canPlace, newGame: newGame,
    currentPid: currentPid, minPlays: minPlays, remaining: remaining, legalMoves: legalMoves, canMeetMin: canMeetMin, play: play,
    canEndTurn: canEndTurn, endTurn: endTurn, skipTurn: skipTurn, danger: danger, stage: stage, rating: rating };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SealGame = api;
})(this);
