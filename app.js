/* 封魔の刻 ― 悪魔を目覚めさせるな ― オンライン協力ゲーム
 * 構成：WebRTC（PeerJS）P2P。ホストのブラウザが唯一の正（authoritative）。
 * 山札と全員の手札はホストだけが持ち、各プレイヤーには「自分の手札」と公開情報だけを送ります。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var S = SealGame;
  var Q = new URLSearchParams(location.search);
  var CFG = window.NT_CONFIG || {};
  var ICE = (CFG.iceServers && CFG.iceServers.length) ? CFG.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
  if (Q.get('ice')) ICE = Q.get('ice').split(',').map(function (u) { return { urls: u }; });
  var PEER_OPTS = Object.assign({ debug: 1, config: { iceServers: ICE } }, CFG.peer || {});
  var ID_PREFIX = 'fuuma-no-toki-jp-v1-';
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var TURBO = Q.has('turbo');
  var HB_MS = 3000, LOST_MS = 10000, MAX_SEATS = 5, BIG_JUMP = 20;
  var LS_ID = 'ds-client-id', LS_NAME = 'ds-name', LS_HOST = 'ds-host-room', LS_SND = 'ds-sound', LS_CALM = 'ds-calm', SS_CLIENT = 'ds-joined';
  var PILE_LABEL = ['▲1', '▲2', '▼1', '▼2'];
  var SIGNALS = [
    { k: 'stop', ic: '✋', label: 'この列は触らないで！' },
    { k: 'wait', ic: '⏳', label: 'ちょっとだけ待って' },
    { k: 'ok', ic: '👍', label: 'この列いけるかも' },
    { k: 'mine', ic: '🙋', label: 'ここは任せて' }
  ];
  var REACTS = ['👍', '🙏', '😱', '💦', '🔥', '✨'];
  var OMENS = [
    ['封印は静かに保たれている…', '魔法陣は穏やかに光っている', '悪魔は深い眠りの中…'],
    ['封印がきしむ…', '遠くで何かがうごめいた…', '魔法陣の光がゆらいだ…'],
    ['ひびが走った…', '何かが目覚めようとしている…', '冷たい風が吹きぬける…'],
    ['何かが目覚めようとしている…', '鼓動が聞こえる……', '封印が悲鳴をあげている…'],
    ['👿 ……もうすぐだ……', '👿 ……あと少しで、自由に……', '👿 ……聞こえるぞ、封印の砕ける音が……']
  ];
  var SEALC = ['#9a6cff', '#b067e0', '#d0509a', '#e8384f', '#ff2740'];

  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {} }
  function load(k, json) { try { var v = localStorage.getItem(k); return json ? JSON.parse(v) : v; } catch (e) { return null; } }
  function sstore(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function sload(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } }
  function rid(n) { var s = ''; for (var i = 0; i < n; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]; return s; }
  var myId = load(LS_ID) || (function () { var v = rid(16); store(LS_ID, v); return v; })();
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8); }
  function genCode() { var c = ''; for (var i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1').slice(0, 4); }
  function inviteUrl(code) { var u = location.origin + location.pathname + '?room=' + code; if (Q.get('ice')) u += '&ice=' + encodeURIComponent(Q.get('ice')); return u; }
  var reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- 汎用UI ----------
  var SCREENS = ['title', 'lobby', 'play', 'result'];
  function show(id) { SCREENS.forEach(function (s) { $(s).classList.toggle('active', s === id); }); }
  function overlay(id, on) { $(id).classList.toggle('active', on); }
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2800); }
  function banner(msg) { $('banner').textContent = msg || ''; $('banner').classList.toggle('show', !!msg); }
  function confirmBox(title, text, yes, cb, noCancel) {
    $('cfTitle').textContent = title; $('cfText').textContent = text; $('cfYes').textContent = yes;
    $('cfNo').style.display = noCancel ? 'none' : '';
    overlay('confirmModal', true);
    $('cfYes').onclick = function () { overlay('confirmModal', false); cb && cb(); };
    $('cfNo').onclick = function () { overlay('confirmModal', false); };
  }
  function connecting(on, title, text, onCancel) {
    overlay('connecting', on);
    if (on) { $('connTitle').textContent = title || '接続中…'; $('connText').textContent = text || ''; $('connCancel').onclick = onCancel || function () { location.href = location.pathname; }; }
  }
  $('rulesBtn1').onclick = $('rulesBtn2').onclick = function () { overlay('rulesModal', true); };
  $('rulesClose').onclick = function () { overlay('rulesModal', false); };
  // 魔法陣をテンプレートから配置
  [].forEach.call(document.querySelectorAll('.sealslot'), function (slot, i) {
    var frag = $('sealTpl').content.cloneNode(true);
    var path = frag.querySelector('#runePath'), tp = frag.querySelector('textPath');
    path.id = 'runePath' + i; tp.setAttribute('href', '#runePath' + i);   // IDの重複を避ける
    slot.appendChild(frag);
  });

  // ---------- 効果音（WebAudioで合成。外部ファイルなし） ----------
  var SND = (function () {
    var ctx = null, master = null, on = load(LS_SND) !== '0' && !TURBO, drone = null, hbT = null, dng = 0, inPlay = false;
    function ensure() {
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = on ? 0.7 : 0; master.connect(ctx.destination); } catch (e) { ctx = null; return null; }
      }
      if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
      return ctx;
    }
    document.addEventListener('pointerdown', function () { if (on) { ensure(); syncDrone(); } }, true);
    function ok() { return on && ctx && ctx.state === 'running'; }
    function env(g, t0, a, peak, d) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
    function tone(f, dur, type, vol, f2, delay) {
      if (!ok()) return; var t0 = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      env(g, t0, 0.008, vol || 0.2, dur); o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
    }
    function noise(dur, vol, freq, delay, q) {
      if (!ok()) return; var t0 = ctx.currentTime + (delay || 0), n = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(); s.buffer = b; f.type = 'lowpass'; f.frequency.value = freq || 800; f.Q.value = q || 0.7;
      env(g, t0, 0.01, vol || 0.2, dur); s.connect(f); f.connect(g); g.connect(master); s.start(t0); s.stop(t0 + dur + 0.05);
    }
    function syncDrone() {
      if (!ctx) return;
      if (on && inPlay && !drone && ctx.state === 'running') {
        var g = ctx.createGain(), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160; g.gain.value = 0.0001;
        var o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = o2.type = 'sawtooth'; o1.frequency.value = 55; o2.frequency.value = 55.6;
        o1.connect(f); o2.connect(f); f.connect(g); g.connect(master); o1.start(); o2.start();
        drone = { g: g, f: f, o: [o1, o2] };
      }
      if (drone && (!on || !inPlay)) { drone.o.forEach(function (o) { try { o.stop(); } catch (e) {} }); drone = null; }
      if (drone) { var t = ctx.currentTime; drone.g.gain.setTargetAtTime(0.012 + dng * 0.05, t, 0.8); drone.f.frequency.setTargetAtTime(140 + dng * 260, t, 0.8); }
    }
    function heartbeat() {
      clearTimeout(hbT);
      if (!inPlay || S.stage(Math.round(dng * 100)) < 3) return;
      tone(62, 0.14, 'sine', 0.35, 40); tone(52, 0.16, 'sine', 0.28, 36, 0.2);
      hbT = setTimeout(heartbeat, 1250 - dng * 620);
    }
    return {
      setOn: function (v) { on = v && !TURBO; store(LS_SND, v ? '1' : '0'); if (on) ensure(); if (master) master.gain.value = on ? 0.7 : 0; syncDrone(); },
      isOn: function () { return load(LS_SND) !== '0'; },
      setPlay: function (p) { inPlay = p; syncDrone(); if (!p) clearTimeout(hbT); },
      setDanger: function (d) { var was = S.stage(Math.round(dng * 100)); dng = d; syncDrone(); var st = S.stage(Math.round(d * 100)); if (st >= 3 && (was < 3 || !hbT)) heartbeat(); if (st < 3) { clearTimeout(hbT); hbT = null; } },
      place: function () { tone(150, 0.12, 'sine', 0.3, 60); noise(0.05, 0.12, 2400); },
      big: function () { tone(70, 0.8, 'sine', 0.5, 28); noise(0.7, 0.35, 300); tone(90, 0.5, 'sawtooth', 0.08, 40); },
      relief: function () { [523, 784, 1047, 1568].forEach(function (f, i) { tone(f, 1.4, 'sine', 0.12, f * 1.01, i * 0.09); }); noise(0.6, 0.05, 6000, 0.05); },
      signal: function () { tone(880, 0.12, 'triangle', 0.1); tone(1320, 0.14, 'triangle', 0.08, null, 0.07); },
      react: function () { tone(660, 0.08, 'sine', 0.08, 990); },
      turn: function () { tone(392, 0.3, 'triangle', 0.12); tone(587, 0.4, 'triangle', 0.12, null, 0.12); },
      lose: function () {
        if (!ok()) return; var t0 = ctx.currentTime;
        [44, 46.5, 66].forEach(function (f) { var o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = f; fl.type = 'lowpass';
          fl.frequency.setValueAtTime(90, t0); fl.frequency.exponentialRampToValueAtTime(1400, t0 + 2.6); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 2.4); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 5.5);
          o.connect(fl); fl.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 5.6); });
        noise(1.6, 0.5, 900, 1.9); tone(55, 2.2, 'sine', 0.55, 25, 1.9);
      },
      win: function () { [262, 330, 392, 523, 659, 784, 1047].forEach(function (f, i) { tone(f, 2.2, 'sine', 0.1, null, i * 0.16); }); [131, 196, 262].forEach(function (f) { tone(f, 3.4, 'triangle', 0.07, null, 1.2); }); }
    };
  })();
  function syncSwitches() {
    var on = SND.isOn();
    [].forEach.call(document.querySelectorAll('.sndSw'), function (b) { b.classList.toggle('on', on); });
    $('sndBtn').textContent = on ? '🔊' : '🔇';
    var calm = load(LS_CALM) === '1';
    [].forEach.call(document.querySelectorAll('.calmSw'), function (b) { b.classList.toggle('on', calm); });
    document.body.classList.toggle('calm', calm);
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('.sndSw') || e.target.closest('#sndBtn')) { SND.setOn(!SND.isOn()); syncSwitches(); }
    if (e.target.closest('.calmSw')) { store(LS_CALM, load(LS_CALM) === '1' ? '0' : '1'); syncSwitches(); }
  });
  syncSwitches();
  function calm() { return reducedMotion || document.body.classList.contains('calm'); }
  function vibrate(p) { if (!calm() && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} }

  // =====================================================================
  //  ホスト（authoritative）
  // =====================================================================
  var host = null;
  function hostId(code) { return ID_PREFIX + code; }
  function newRoom(name) {
    return { code: genCode(), phase: 'lobby', nextSid: 2, gid: 0,
      seats: [{ sid: 1, name: name, kind: 'host', clientId: myId, connected: true }],
      G: null, sig: [{}, {}, {}, {}], reacts: [], reactSeq: 0, log: [], evId: 0, ev: null, created: Date.now() };
  }
  function startHost(name, resumeRoom) {
    document.body.classList.add('is-host');
    host = { room: resumeRoom || newRoom(name), conns: {}, lastSeen: {}, lastReact: {}, tries: 0, opened: false, resuming: !!resumeRoom };
    if (resumeRoom) host.room.seats.forEach(function (s) { if (s.kind === 'remote') s.connected = false; });
    connecting(true, '結界を張っています…', 'シグナリングサーバーに接続中');
    openHostPeer();
    setInterval(hostHeartbeat, 2000);
  }
  function openHostPeer() {
    var R = host.room;
    var peer = new Peer(hostId(R.code), PEER_OPTS);
    host.peer = peer;
    peer.on('open', function () { host.opened = true; host.tries = 0; connecting(false); banner(''); hostBroadcast(); });
    peer.on('connection', function (conn) {
      conn.on('data', function (m) { hostOnMessage(conn, m); });
      conn.on('close', function () { hostConnClosed(conn); });
      conn.on('error', function () { hostConnClosed(conn); });
    });
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'unavailable-id') {
        try { peer.destroy(); } catch (x) {}
        if (!host.opened && R.phase === 'lobby' && !host.resuming) { R.code = genCode(); openHostPeer(); return; }
        if (++host.tries > 25) { connecting(false); toast('部屋を再開できませんでした'); return; }
        connecting(true, '部屋を再開しています…', '少し時間がかかることがあります（' + host.tries + '）');
        setTimeout(openHostPeer, 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) {
        if (!host.opened) { connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…'); setTimeout(function () { try { peer.destroy(); } catch (x) {} openHostPeer(); }, 4000); }
        else banner('シグナリングサーバーとの接続が不安定です（ゲームは続行できます）');
      } else if (e.type === 'browser-incompatible') connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
    });
  }
  function seatByClient(cid) { return host.room.seats.filter(function (s) { return s.clientId === cid; })[0]; }
  function seatBySid(sid) { return host.room.seats.filter(function (s) { return s.sid === sid; })[0]; }
  function nameOf(sid) { var s = seatBySid(sid); return s ? s.name : '?'; }
  function addLog(t) { var R = host.room; R.log.unshift(t); if (R.log.length > 40) R.log.length = 40; }

  function hostOnMessage(conn, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') return hostJoin(conn, m);
    var seat = conn.clientId && seatByClient(conn.clientId);
    if (!seat || host.conns[conn.clientId] !== conn) return;
    host.lastSeen[conn.clientId] = Date.now();
    if (m.t === 'ping') return;
    if (m.t === 'lobbyReq') return hostLobbyReq(seat);
    if (m.t === 'abort') return;   // 中断できるのはホストだけ（参加者からの abort は無視）
    if (m.t === 'play' || m.t === 'end') return hostAct(seat, m, conn);
    if (m.t === 'signal') return hostSignal(seat, m);
    if (m.t === 'react') return hostReact(seat, m);
    if (m.t === 'leave') {
      var R = host.room;
      if (R.phase === 'lobby') R.seats.splice(R.seats.indexOf(seat), 1); else seat.connected = false;
      addLog('👋 ' + seat.name + 'が退出しました');
      delete host.conns[conn.clientId];
      try { conn.close(); } catch (e) {}
      hostBroadcast();
    }
  }
  function hostJoin(conn, m) {
    var R = host.room;
    var name = cleanName(m.name), cid = String(m.clientId || '').slice(0, 40);
    function reject(text) { conn.send({ t: 'reject', msg: text }); setTimeout(function () { try { conn.close(); } catch (e) {} }, 500); }
    if (!name || !cid) return reject('名前を入力してください');
    if (cid === myId) return reject('ホストと同じ端末・ブラウザからは参加できません');
    var seat = seatByClient(cid);
    if (!seat) { seat = R.seats.filter(function (s) { return s.kind === 'remote' && s.name === name && !s.connected; })[0]; if (seat) seat.clientId = cid; }
    if (seat) {
      var old = host.conns[cid]; if (old && old !== conn) { try { old.close(); } catch (e) {} }
      seat.connected = true; addLog('🔌 ' + seat.name + 'が戻ってきました');
    } else {
      if (R.phase !== 'lobby') return reject('この部屋は封印の儀の最中です。前に参加していた人は、同じ名前で入ると元の席に戻れます。');
      if (R.seats.length >= MAX_SEATS) return reject('満員です（最大5人）');
      if (R.seats.some(function (s) { return s.name === name; })) return reject('その名前はすでに使われています。別の名前にしてください。');
      seat = { sid: R.nextSid++, name: name, kind: 'remote', clientId: cid, connected: true };
      R.seats.push(seat); addLog('👋 ' + name + 'が参加しました');
    }
    conn.clientId = cid; host.conns[cid] = conn; host.lastSeen[cid] = Date.now();
    conn.send({ t: 'welcome', code: R.code, sid: seat.sid });
    hostBroadcast();
  }
  function hostConnClosed(conn) {
    if (!conn.clientId || host.conns[conn.clientId] !== conn) return;
    delete host.conns[conn.clientId];
    var seat = seatByClient(conn.clientId);
    if (seat && seat.connected) { seat.connected = false; addLog('⚠️ ' + seat.name + 'の接続が切れました'); hostBroadcast(); }
  }
  function hostHeartbeat() {
    if (!host) return;
    var now = Date.now();
    Object.keys(host.conns).forEach(function (cid) {
      var c = host.conns[cid];
      try { c.send({ t: 'hb' }); } catch (e) {}
      if (now - (host.lastSeen[cid] || 0) > LOST_MS) { try { c.close(); } catch (e) {} hostConnClosed(c); }
    });
  }

  // ---- 進行 ----
  function debugDeck() {   // テスト用の隠しURLフラグ（ホストのURLのみ有効）
    var d = Q.get('deck');
    if (!d) return null;
    if (d === 'small') { var r = Q.get('seed') ? S.rngFrom(+Q.get('seed')) : Math.random; var a = []; for (var c = 2; c <= 25; c++) a.push(c); return S.shuffle(a, r); }
    var list = d.split(/[ ,]+/).map(Number).filter(function (x) { return x >= 2 && x <= 99; });
    var seen = {}, out = [];
    list.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
    if (Q.get('fill') !== '0') { var rest = S.fullDeck().filter(function (x) { return !seen[x]; }); out = out.concat(S.shuffle(rest, Q.get('seed') ? S.rngFrom(+Q.get('seed') + 1) : Math.random)); }
    return out;
  }
  function hostStartGame() {
    var R = host.room;
    if (R.seats.length < 1 || R.seats.length > MAX_SEATS) return;
    var pids = R.seats.map(function (s) { return s.sid; });
    var rng = Q.get('seed') ? S.rngFrom(+Q.get('seed') + R.gid) : Math.random;
    var deck = debugDeck();
    var startIdx = Q.has('start') ? +Q.get('start') : deck ? 0 : Math.floor(rng() * pids.length);
    R.G = S.newGame(pids, { rng: rng, deck: deck, startIdx: startIdx });
    R.gid++; R.G.gid = R.gid;
    R.phase = 'play'; R.sig = [{}, {}, {}, {}]; R.reacts = []; R.log = [];
    addLog('🕯️ 封印の儀が始まった。' + nameOf(S.currentPid(R.G)) + 'から');
    R.ev = { id: ++R.evId, type: 'start' };
    syncOver();
    hostBroadcast();
  }
  function syncOver() {
    var R = host.room, G = R.G;
    if (G.phase === 'play') return;
    R.phase = 'over';
    if (G.end.won) addLog('✨ 封印完了！ 悪魔は再び眠りについた');
    else addLog('👿 ' + nameOf(G.end.stuck) + 'は札を置けなかった… 悪魔が復活した（残り' + G.end.left + '枚）');
    R.ev = { id: ++R.evId, type: 'over', won: G.end.won };
  }
  function hostAct(seat, m, conn) {
    var R = host.room, G = R.G;
    if (R.phase !== 'play' || !G) return;
    if (m.mv !== G.moves || m.gid !== R.gid) return;   // 古い・重複した操作は無視
    try {
      if (m.t === 'play') {
        var ev = S.play(G, seat.sid, +m.card, +m.pile);
        var big = !ev.back && ev.jump >= BIG_JUMP;
        delete R.sig[ev.pile][seat.sid];                 // 自分が置いた列の合図は消す
        addLog(seat.name + '：' + PILE_LABEL[ev.pile] + 'に ' + ev.card + (ev.back ? '　↩ 逆流の術！' : big ? '　⚠ 大きな跳び' : ''));
        R.ev = { id: ++R.evId, type: 'play', by: seat.sid, card: ev.card, pile: ev.pile, from: ev.from, back: ev.back, jump: ev.jump, big: big, autoEnd: !!ev.autoEnd };
        if (ev.autoEnd && G.phase === 'play') addLog('🂠 ' + seat.name + 'の手札がなくなった');
      } else {
        var r = S.endTurn(G, seat.sid);
        addLog(seat.name + 'が手番を終えた' + (r.drew ? '（' + r.drew + '枚補充）' : ''));
        R.ev = { id: ++R.evId, type: 'end', by: seat.sid, drew: r.drew };
      }
      syncOver();
      hostBroadcast();
    } catch (e) { if (conn) conn.send({ t: 'error', msg: e.message }); else { toast(e.message); hostBroadcast(); } }
  }
  function hostSignal(seat, m) {
    var R = host.room;
    if (R.phase !== 'play') return;
    var p = +m.pile; if (!(p >= 0 && p < 4)) return;
    var kinds = SIGNALS.map(function (s) { return s.k; });
    if (m.kind && kinds.indexOf(m.kind) >= 0) R.sig[p][seat.sid] = m.kind; else delete R.sig[p][seat.sid];
    hostBroadcast();
  }
  function hostReact(seat, m) {
    var R = host.room, now = Date.now();
    if (REACTS.indexOf(m.e) < 0 || now - (host.lastReact[seat.sid] || 0) < 600) return;
    host.lastReact[seat.sid] = now;
    R.reacts.push({ id: ++R.reactSeq, by: seat.sid, e: m.e }); if (R.reacts.length > 6) R.reacts.shift();
    hostBroadcast();
  }

  // ---- ビュー（見せてよい情報だけ） ----
  function viewFor(sid) {
    var R = host.room, G = R.G;
    var v = { t: 'state', phase: R.phase, code: R.code, you: sid, log: R.log.slice(0, 6), ev: R.ev, reacts: R.reacts,
      seats: R.seats.map(function (s) { return { sid: s.sid, name: s.name, kind: s.kind, connected: s.kind !== 'remote' || s.connected }; }) };
    v.notice = R.notice || null;
    if (sid === 1 && R.lobbyReq && R.phase !== 'lobby') v.lobbyReq = R.lobbyReq;
    if (!G || R.phase === 'lobby') return v;
    v.seats.forEach(function (s) { s.hand = G.hands[s.sid] ? G.hands[s.sid].length : 0; });
    v.gid = R.gid; v.mv = G.moves; v.piles = G.piles.map(function (p) { return { d: p.d, t: p.t, n: p.n }; });
    v.deckCount = G.deck.length; v.turn = S.currentPid(G); v.played = G.played; v.min = S.minPlays(G); v.hs = G.hs;
    v.danger = R.danger; v.sig = R.sig; v.remaining = S.remaining(G); v.total = G.total;
    v.hand = (G.hands[sid] || []).slice();                // 自分の手札だけ
    if (R.phase === 'over') {
      v.end = { won: G.end.won, left: G.end.left, rating: S.rating(G.end.left), stuck: G.end.stuck || null, need: G.end.need || 0, played: G.end.played || 0,
        turns: G.turns, plays: G.history.length, backs: G.backs, maxJump: G.history.reduce(function (a, h) { return h.back ? a : Math.max(a, h.jump); }, 0) };
      v.reveal = { hands: G.hands, deckLeft: G.deck.length };   // 決着後だけ公開
    }
    return v;
  }
  // ---- 中断してロビーへ（ホストのみ）：部屋コード・接続中の参加者・設定はそのまま ----
  function hostToLobby(msg) {
    var R = host.room;
    R.phase = 'lobby'; R.G = null; R.ev = null; R.sig = [{}, {}, {}, {}]; R.danger = 0;
    R.seats = R.seats.filter(function (s) { return s.kind !== 'remote' || s.connected; });
    R.lobbyReq = null; R.notice = { id: (R.notice ? R.notice.id : 0) + 1, msg: msg };
    addLog(msg);
    hostBroadcast();
  }
  function hostLobbyReq(seat) {   // 参加者の「ロビーに戻りたい」：ホストに知らせるだけ
    var R = host.room;
    if (seat.kind !== 'remote' || R.phase === 'lobby') return;
    if (R.lobbyReq && R.lobbyReq.sid === seat.sid && Date.now() - R.lobbyReq.at < 5000) return;
    R.lobbyReq = { sid: seat.sid, name: seat.name, at: Date.now() };
    addLog('🙋 ' + seat.name + '「ロビーに戻りたい」');
    hostBroadcast();
  }
  function hostBroadcast() {
    var R = host.room;
    R.danger = R.G && R.phase !== 'lobby' ? S.danger(R.G) : 0;
    R.seats.forEach(function (s) {
      if (s.kind !== 'remote') return;
      var c = host.conns[s.clientId];
      if (c && c.open) { try { c.send(viewFor(s.sid)); } catch (e) {} }
    });
    render(viewFor(1));
    store(LS_HOST, { room: R, saved: Date.now() });
  }

  // ---- ホスト操作 ----
  $('seatList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sid]'); if (!b || !host) return;
    var R = host.room, seat = seatBySid(+b.dataset.sid);
    if (!seat || seat.kind === 'host' || R.phase !== 'lobby') return;
    confirmBox(seat.name + 'を外しますか？', '部屋から退出させます。', '外す', function () {
      var c = host.conns[seat.clientId];
      if (c) { try { c.send({ t: 'kicked' }); } catch (x) {} setTimeout(function () { try { c.close(); } catch (x) {} }, 300); delete host.conns[seat.clientId]; }
      R.seats.splice(R.seats.indexOf(seat), 1); hostBroadcast();
    });
  });
  $('startBtn').onclick = function () { if (host) hostStartGame(); };
  $('hostResultBtns').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !host) return;
    var R = host.room;
    if (b.dataset.a === 'again') hostStartGame();
    else if (b.dataset.a === 'lobby') hostToLobby('ロビーに戻りました');
  });
  $('hostbar').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !host) return;
    if (b.dataset.skip) { var R = host.room; addLog('⏭️ ' + nameOf(+b.dataset.skip) + 'の番を飛ばしました'); S.skipTurn(R.G); R.ev = { id: ++R.evId, type: 'end', by: +b.dataset.skip, drew: 0 }; syncOver(); hostBroadcast(); }
    else $('hostbar').dataset.dismiss = b.dataset.wait;
  });

  // =====================================================================
  //  参加者（クライアント）
  // =====================================================================
  var client = null, received = [];
  function startClient(code, name) {
    document.body.classList.remove('is-host');
    client = { code: code, name: name, everJoined: false, lastMsg: Date.now() };
    connecting(true, '部屋 ' + code + ' に接続中…', 'しばらくお待ちください', function () { leaveClient(false); });
    var peer = new Peer(PEER_OPTS);
    client.peer = peer;
    peer.on('open', clientConnect);
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'peer-unavailable') {
        if (!client.everJoined) { connecting(false); toast('部屋が見つかりません。コードを確認してください。'); leaveClient(false); }
        else clientLost();
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) {
        if (!client.everJoined) connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…');
      } else if (e.type === 'browser-incompatible') connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
    });
    client.hbTimer = setInterval(function () {
      if (!client) return;
      if (client.conn && client.conn.open) { try { client.conn.send({ t: 'ping' }); } catch (e) {} }
      if (client.everJoined && Date.now() - client.lastMsg > LOST_MS) clientLost();
    }, HB_MS);
    setTimeout(function () {
      if (client && !client.everJoined && $('connecting').classList.contains('active'))
        $('connText').textContent = 'つながりにくいようです。コードが正しいか、ホストが部屋を開いているか確認してください。（通信環境によっては接続できない場合があります）';
    }, 15000);
  }
  function clientConnect() {
    if (!client || client.peer.destroyed) return;
    if (client.conn) { try { client.conn.close(); } catch (e) {} }
    var conn = client.peer.connect(hostId(client.code), { reliable: true });
    client.conn = conn;
    conn.on('open', function () { conn.send({ t: 'join', name: client.name, clientId: myId }); });
    conn.on('data', function (m) { if (client && client.conn === conn) clientOnMessage(m); });
    conn.on('close', function () { if (client && client.conn === conn) clientLost(); });
    conn.on('error', function () { if (client && client.conn === conn) clientLost(); });
  }
  function clientOnMessage(m) {
    if (!m || typeof m !== 'object') return;
    client.lastMsg = Date.now();
    if (m.t === 'welcome') { client.everJoined = true; actSent = ''; connecting(false); banner(''); sstore(SS_CLIENT, { code: client.code, name: client.name }); }
    else if (m.t === 'state') { received.push(m); if (received.length > 4000) received.shift(); render(m); }
    else if (m.t === 'reject') { connecting(false); leaveClient(false); confirmBox('お知らせ', m.msg, 'OK', null, true); }
    else if (m.t === 'kicked') { sstore(SS_CLIENT, null); leaveClient(false); confirmBox('お知らせ', 'ホストによって部屋から外されました。', 'OK', null, true); }
    else if (m.t === 'closed') { sstore(SS_CLIENT, null); leaveClient(false); confirmBox('お知らせ', 'ホストが部屋を閉じました。', 'OK', null, true); }
    else if (m.t === 'error') { actSent = ''; toast(m.msg); if (lastView) render(lastView); }
  }
  function clientLost() {
    if (!client || !client.everJoined) return;
    banner('ホストとの接続が切れました。再接続しています…');
    clearTimeout(client.retryT);
    client.retryT = setTimeout(function () {
      if (!client) return;
      client.lastMsg = Date.now();
      if (client.peer.disconnected && !client.peer.destroyed) { try { client.peer.reconnect(); } catch (e) {} }
      clientConnect();
    }, 3000);
  }
  function leaveClient(sendLeave) {
    if (!client) return;
    if (sendLeave && client.conn && client.conn.open) { try { client.conn.send({ t: 'leave' }); } catch (e) {} }
    clearInterval(client.hbTimer); clearTimeout(client.retryT);
    var p = client.peer; client = null;
    setTimeout(function () { try { p.destroy(); } catch (e) {} }, 300);
    banner(''); connecting(false); SND.setPlay(false); show('title'); renderTitle();
  }
  function leaveRoom() {
    if (host) {
      confirmBox('部屋を閉じますか？', '参加者全員の接続が切れ、ゲームは終了します。', '部屋を閉じる', function () {
        Object.keys(host.conns).forEach(function (cid) { try { host.conns[cid].send({ t: 'closed' }); } catch (e) {} });
        store(LS_HOST, null);
        setTimeout(function () { try { host.peer.destroy(); } catch (e) {} location.href = location.pathname; }, 400);
      });
    } else confirmBox('部屋を出ますか？', 'ゲーム中に出ても、同じ名前で入り直せば元の席に戻れます。', '部屋を出る', function () { sstore(SS_CLIENT, null); leaveClient(true); });
  }
  $('leaveBtn1').onclick = $('leaveBtn2').onclick = leaveRoom;
  // ⋯メニュー：ホスト＝「中断してロビーに戻る」（確認あり）／部屋を閉じる。参加者＝「ロビーに戻りたい」をホストに伝える／退出する
  ['menuBtn'].forEach(function (id) { if ($(id)) $(id).onclick = function () { overlay('menuModal', true); }; });
  function confirmAbort() {
    confirmBox('中断してロビーに戻りますか？', 'いまのゲームを終了して、全員をこの部屋のロビーに戻します。部屋コード・参加者・設定はそのままです。', '中断してロビーへ', function () {
      if (host && host.room.phase !== 'lobby') hostToLobby('⏸️ ホストがゲームを中断しました');
    });
  }
  $('menuAbort').onclick = function () { overlay('menuModal', false); confirmAbort(); };
  $('menuReq').onclick = function () { overlay('menuModal', false); if (client && client.conn && client.conn.open) client.conn.send({ t: 'lobbyReq' }); toast('ホストに「ロビーに戻りたい」と伝えました'); };
  $('menuLeave').onclick = function () { overlay('menuModal', false); leaveRoom(); };
  $('menuRules').onclick = function () { overlay('menuModal', false); overlay('rulesModal', true); };
  $('menuClose').onclick = function () { overlay('menuModal', false); };
  $('lobbyReqBar').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-lr]'); if (!b || !host) return;
    if (b.dataset.lr === 'no') { host.room.lobbyReq = null; hostBroadcast(); } else confirmAbort();
  });
  var seenNotice = null;
  function abortUi(v) {
    if (seenNotice === null) seenNotice = v.notice ? v.notice.id : 0;
    else if (v.notice && v.notice.id !== seenNotice) { seenNotice = v.notice.id; if (!host && v.phase === 'lobby') toast(v.notice.msg + '。ロビーで次のゲームを待っています'); }
    if (v.phase === 'lobby') overlay('menuModal', false);
    var bar = $('lobbyReqBar'), key = host && v.lobbyReq && v.phase !== 'lobby' ? v.lobbyReq.sid + ':' + v.lobbyReq.at : '';
    if (bar.dataset.key !== key) {
      bar.dataset.key = key;
      bar.innerHTML = key ? '<span>🙋 ' + esc(v.lobbyReq.name) + '「ロビーに戻りたい」</span><button data-lr="abort">中断してロビーへ</button><button data-lr="no" class="ghost">とじる</button>' : '';
      bar.classList.toggle('show', !!key);
    }
  }


  // ---- 自分の操作（ホストは直接、参加者は送信） ----
  var lastView = null, actSent = '';
  function sendAct(msg) {
    var v = lastView; if (!v || v.phase !== 'play' || v.turn !== v.you) return false;
    var key = v.gid + ':' + v.mv; if (actSent === key) return false;
    actSent = key; msg.mv = v.mv; msg.gid = v.gid;
    if (host) { hostAct(seatBySid(1), msg, null); actSent = ''; }
    else if (client && client.conn && client.conn.open) client.conn.send(msg);
    return true;
  }
  function sendSoft(msg) {   // 合図・リアクション（手番に関係なく）
    if (host) { if (msg.t === 'signal') hostSignal(seatBySid(1), msg); else hostReact(seatBySid(1), msg); }
    else if (client && client.conn && client.conn.open) client.conn.send(msg);
  }

  // ---- 手札と列の操作 ----
  var selCard = null, sigPile = null;
  $('hand').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-c]'); if (!b || !lastView) return;
    var c = +b.dataset.c; selCard = selCard === c ? null : c; renderPlay(lastView);
  });
  $('piles').addEventListener('click', function (e) {
    var el = e.target.closest('.pile'); if (!el || !lastView) return;
    var v = lastView, i = +el.dataset.i, p = v.piles[i];
    var myTurn = v.phase === 'play' && v.turn === v.you;
    if (myTurn && selCard != null && S.canPlace(p, selCard)) {
      var kind = S.canPlace(p, selCard), jump = Math.abs(selCard - p.t), card = selCard;
      var go = function () { selCard = null; sendAct({ t: 'play', card: card, pile: i }); };
      if (kind === 'normal' && jump >= BIG_JUMP) confirmBox('大きく跳ばしますか？', PILE_LABEL[i] + 'を ' + p.t + ' → ' + card + '（' + jump + '）まで進めます。置いた札は取り消せません。', '置く', go);
      else go();
      return;
    }
    if (myTurn && selCard != null) { toast('その列には置けません'); return; }
    openSignal(i);
  });
  function openSignal(i) {
    if (!lastView || lastView.phase !== 'play') return;
    sigPile = i;
    var mine = (lastView.sig[i] || {})[lastView.you];
    $('sigTitle').textContent = PILE_LABEL[i] + '（' + (i < 2 ? 'のぼり' : 'くだり') + '）に合図';
    $('sigList').innerHTML = SIGNALS.map(function (s) { return '<button data-k="' + s.k + '" class="' + (mine === s.k ? 'on' : '') + '"><span class="ic">' + s.ic + '</span>' + s.label + '</button>'; }).join('') +
      (mine ? '<button data-k=""><span class="ic">🧹</span>合図を取り消す</button>' : '');
    overlay('sigModal', true);
  }
  $('sigList').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    sendSoft({ t: 'signal', pile: sigPile, kind: b.dataset.k || null }); overlay('sigModal', false);
  });
  $('sigClose').onclick = function () { overlay('sigModal', false); };
  $('reacts').innerHTML = REACTS.map(function (e) { return '<button data-e="' + e + '">' + e + '</button>'; }).join('');
  $('reacts').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) sendSoft({ t: 'react', e: b.dataset.e }); });
  $('endBtn').onclick = function () {
    var v = lastView; if (!v || v.turn !== v.you || v.played < v.min) return;
    var draw = Math.min(v.hs - v.hand.length, v.deckCount);
    confirmBox('手番を終えますか？', (draw > 0 ? '山札から' + draw + '枚補充して、' : '') + '次の人に交代します。置いた札は取り消せません。', '手番を終える', function () { sendAct({ t: 'end' }); });
  };

  // =====================================================================
  //  描画（受け取ったビューだけを使う）
  // =====================================================================
  var lastEvId = null, lastStage = -1, seenReact = null, lastTurnKey = '', cineShown = '', lastOverKey = '';
  function render(v) {
    lastView = v; window.__ds.view = v;
    abortUi(v);
    if (lastEvId === null) { lastEvId = v.ev ? v.ev.id : 0; seenReact = v.reacts && v.reacts.length ? v.reacts[v.reacts.length - 1].id : 0; }
    if (v.phase === 'lobby') { show('lobby'); renderLobby(v); setDanger(0); SND.setPlay(false); overlay('sigModal', false); hideCine(); }
    else if (v.phase === 'play') { show('play'); renderPlay(v); SND.setPlay(true); hideCine(); }
    else { renderPlay(v); SND.setPlay(false); renderResult(v); }
    if (v.ev && v.ev.id !== lastEvId) { lastEvId = v.ev.id; effect(v, v.ev); }
    if (v.reacts) v.reacts.forEach(function (r) { if (r.id > seenReact) { seenReact = r.id; bubble(r.by, r.e); } });
    if (v.phase === 'play') {
      var tk = v.gid + ':' + v.turn;
      if (tk !== lastTurnKey) { var mine = v.turn === v.you; lastTurnKey = tk; if (mine) { turnBanner('あなたの番'); SND.turn(); vibrate(40); } }
    }
  }
  function renderLobby(v) {
    var isHost = !!host;
    $('codeBig').textContent = v.code;
    var url = inviteUrl(v.code);
    $('inviteUrl').textContent = url;
    if ($('qr').dataset.url !== url) {
      try { var qr = qrcode(0, 'M'); qr.addData(url); qr.make(); $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) {}
      $('qr').dataset.url = url;
    }
    var n = v.seats.length;
    $('seatCount').textContent = n + ' / 5人';
    $('seatList').innerHTML = v.seats.map(function (s, i) {
      var tags = (s.kind === 'host' ? '<span class="tag host">ホスト</span>' : '') + (s.sid === v.you ? '<span class="tag you">あなた</span>' : '') +
        (s.kind === 'remote' ? (s.connected ? '<span class="tag on">接続中</span>' : '<span class="tag off">切断</span>') : '');
      return '<div class="seat' + (s.connected ? '' : ' offline') + '"><span class="av">' + (i + 1) + '</span><span class="nm">' + esc(s.name) + '</span>' + tags +
        (isHost && s.kind !== 'host' ? '<button class="xbtn" data-sid="' + s.sid + '">×</button>' : '') + '</div>';
    }).join('');
    $('seatHint').textContent = '1〜5人で遊べます／手札：' + S.handSize(n) + '枚' + (n === 1 ? '（ソロ）' : '');
    $('startBtn').disabled = n < 1 || n > MAX_SEATS;
    $('startBtn').textContent = '封印の儀をはじめる（' + n + '人' + (n === 1 ? '・ソロ' : '') + '）';
    $('leaveBtn1').textContent = isHost ? '部屋を閉じる' : '部屋を出る';
  }
  function setDanger(d) {
    var x = Math.max(0, Math.min(100, d || 0)) / 100, st = S.stage(d || 0), b = document.body;
    b.style.setProperty('--dng', x.toFixed(3));
    b.style.setProperty('--beat', (1.25 - x * 0.62).toFixed(2) + 's');
    b.style.setProperty('--sealc', SEALC[st]);
    for (var k = 0; k <= 4; k++) { b.classList.toggle('st' + k, st === k); if (k) b.classList.toggle('k' + k, st >= k); }
    SND.setDanger(x);
    return st;
  }
  function seatName(v, sid) { var s = v.seats.filter(function (x) { return x.sid === sid; })[0]; return s ? s.name : '?'; }
  function renderPlay(v) {
    $('codeChip').textContent = v.code; $('deckNum').textContent = v.deckCount;
    var st = setDanger(v.danger);
    $('gaugeBar').style.width = v.danger + '%'; $('gaugePct').textContent = v.danger + '%';
    if (st !== lastStage) {
      lastStage = st; var lines = OMENS[st], o = $('omen');
      o.textContent = lines[Math.floor(Math.random() * lines.length)];
      o.className = 'omen st' + st + ' fade';
    }
    // プレイヤー
    var bubbles = {};
    [].forEach.call($('players').querySelectorAll('.pchip'), function (el) { var bs = el.querySelectorAll('.bubble'); if (bs.length) bubbles[el.dataset.sid] = [].slice.call(bs); });
    $('players').innerHTML = v.seats.map(function (s) {
      return '<div class="pchip' + (s.sid === v.turn && v.phase === 'play' ? ' cur' : '') + (s.hand === 0 ? ' empty' : '') + (s.connected ? '' : ' off') + '" data-sid="' + s.sid + '">' +
        (s.sid === v.you ? '<span class="me">あなた</span>' : '') + '<span class="nm">' + esc(s.name) + '</span><span class="hc">手札 <b>' + s.hand + '</b></span></div>';
    }).join('');
    Object.keys(bubbles).forEach(function (sid) { var el = $('players').querySelector('.pchip[data-sid="' + sid + '"]'); if (el) bubbles[sid].forEach(function (b) { el.appendChild(b); }); });
    // 列
    var myTurn = v.phase === 'play' && v.turn === v.you;
    if (selCard != null && v.hand.indexOf(selCard) < 0) selCard = null;
    $('piles').innerHTML = v.piles.map(function (p, i) {
      var k = selCard != null ? S.canPlace(p, selCard) : null;
      var cls = 'pile ' + p.d + (selCard != null ? (k ? ' can' + (k === 'back' ? ' back' : '') : ' no') : '');
      var sigs = v.sig && v.sig[i] ? Object.keys(v.sig[i]).map(function (sid) {
        var kind = v.sig[i][sid], def = SIGNALS.filter(function (s) { return s.k === kind; })[0]; if (!def) return '';
        return '<span class="sig ' + kind + '" title="' + esc(seatName(v, +sid) + '：' + def.label) + '">' + def.ic + '<span class="who">' + esc(seatName(v, +sid).slice(0, 3)) + '</span></span>';
      }).join('') : '';
      var base = p.n === 0;
      return '<div class="' + cls + '" data-i="' + i + '"><span class="dir">' + (p.d === 'up' ? '▲のぼり' : '▼くだり') + '</span>' +
        '<div class="top"><div class="card' + (base ? ' base' : '') + '" id="pileTop' + i + '">' + p.t + '</div></div>' +
        '<span class="cnt">' + (base ? (p.d === 'up' ? '大きい数を置く' : '小さい数を置く') : p.n + '枚目') + '</span><div class="sigs">' + sigs + '</div></div>';
    }).join('');
    // ログ・手札
    $('log').innerHTML = (v.log || []).slice(0, 2).map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('');
    $('handCount').textContent = v.hand.length + '枚' + (v.phase === 'play' ? '（上限' + v.hs + '）' : '');
    $('hand').innerHTML = v.hand.length ? v.hand.map(function (c) {
      var dead = !v.piles.some(function (p) { return S.canPlace(p, c); });
      return '<button data-c="' + c + '" class="' + (selCard === c ? 'sel' : '') + (dead ? ' dead' : '') + '"><div class="card">' + c + '</div></button>';
    }).join('') : '<div class="empty">手札はありません（番は飛ばされます）</div>';
    // 状態
    var cur = v.seats.filter(function (s) { return s.sid === v.turn; })[0];
    if (v.phase !== 'play') $('status').textContent = '決着';
    else if (myTurn) $('status').innerHTML = v.played < v.min ? 'あなたの番：あと<b>' + (v.min - v.played) + '枚</b>以上置こう' + (selCard == null ? '（札をタップ）' : '') : '置けました！ 手番を終えるか、さらに置いてもOK';
    else if (cur && !cur.connected) $('status').innerHTML = esc(cur.name) + 'の再接続を待っています<span class="dots"></span>';
    else $('status').innerHTML = (cur ? esc(cur.name) + 'の番' + (v.played ? '（' + v.played + '枚置いた）' : '') : '') + '<span class="dots"></span>';
    $('endBtn').disabled = !(myTurn && v.played >= v.min && actSent !== v.gid + ':' + v.mv);
    $('endBtn').textContent = v.deckCount > 0 ? '手番を終える（札を補充）' : '手番を終える';
    var hb = $('hostbar');
    if (host && v.phase === 'play' && cur && !cur.connected && hb.dataset.dismiss !== String(cur.sid)) {
      hb.innerHTML = '<span>⚠️ ' + esc(cur.name) + 'の接続が切れています</span><button data-skip="' + cur.sid + '">⏭️ 番を飛ばす</button><button class="n" data-wait="' + cur.sid + '">待つ</button>';
      hb.classList.add('show');
    } else hb.classList.remove('show');
  }
  function bubble(sid, e) {
    var el = $('players').querySelector('.pchip[data-sid="' + sid + '"]'); if (!el) return;
    var b = document.createElement('span'); b.className = 'bubble'; b.textContent = e; el.appendChild(b);
    setTimeout(function () { b.remove(); }, 2300); SND.react();
  }
  function turnBanner(t) { var b = $('turnBanner'); b.textContent = t; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
  function flash(kind) { var f = $('flash'); f.className = ''; void f.offsetWidth; f.className = kind; }
  function floatText(t, bad) {
    [].forEach.call($('altar').querySelectorAll('.relieftext'), function (x) { x.remove(); });
    var el = document.createElement('div'); el.className = 'relieftext' + (bad ? ' bad' : ''); el.textContent = t;
    $('altar').appendChild(el); setTimeout(function () { el.remove(); }, 2100);
  }
  function effect(v, ev) {
    if (ev.type === 'play') {
      var top = $('pileTop' + ev.pile), pile = top && top.closest('.pile');
      if (top) top.classList.add('played-pop');
      if (ev.back) {
        SND.relief(); flash('gold'); floatText('✨ 逆流の術！ 封印が力を取り戻す');
        if (pile) pile.classList.add('hitback');
        [].forEach.call(document.querySelectorAll('#altar .seal'), function (s) { s.classList.remove('relief'); void s.offsetWidth; s.classList.add('relief'); setTimeout(function () { s.classList.remove('relief'); }, 1400); });
      } else if (ev.big) {
        SND.big(); flash('red'); vibrate([60, 40, 90]); floatText('封印が大きく揺らいだ…', true);
        if (pile) pile.classList.add('hitbig');
        if (!calm()) { var c = $('play').querySelector('.col'); c.classList.remove('shakeit'); void c.offsetWidth; c.classList.add('shakeit'); setTimeout(function () { c.classList.remove('shakeit'); }, 600); }
      } else SND.place();
    } else if (ev.type === 'over') {
      var key = v.gid + ':' + (ev.won ? 'w' : 'l');
      if (cineShown !== key) { cineShown = key; playCine(v); }
    }
  }

  // ---- シネマティック ----
  var cineTimers = [];
  function hideCine() { cineTimers.forEach(clearTimeout); cineTimers = []; $('cine').className = ''; [].forEach.call($('cine').querySelectorAll('.spark,.ember'), function (e) { e.remove(); }); }
  function playCine(v) {
    hideCine();
    var won = v.end.won, c = $('cine'), k = TURBO ? 0.35 : 1;
    var L = won ? ['最後の札が納められた……', '封 印 完 了', '悪魔は再び、永き眠りについた']
      : ['封印が……砕ける……', '悪 魔 復 活', '👿「……ようやく、目覚めの時だ」'];
    c.querySelector('.l1').textContent = L[0]; c.querySelector('.l2').textContent = L[1]; c.querySelector('.l3').textContent = L[2];
    $('cineScore').innerHTML = won ? '残った札 <b>0</b> 枚 ― ' + v.end.rating.label : '残った札 <b>' + v.end.left + '</b> 枚 ― ' + v.end.rating.label;
    [].forEach.call(c.querySelectorAll('.l,.score,.closebtn'), function (e) { e.classList.remove('show'); });
    c.className = 'active ' + (won ? 'win' : 'lose');
    c.querySelector('.seal').style.setProperty('--dng', won ? '0.5' : '1');
    void c.offsetWidth; c.classList.add('go');
    if (won) SND.win(); else { SND.lose(); vibrate([100, 60, 200, 80, 400]); }
    var at = function (ms, fn) { cineTimers.push(setTimeout(fn, ms * k)); };
    at(900, function () { c.querySelector('.l1').classList.add('show'); });
    at(won ? 2600 : 2300, function () { c.querySelector('.l2').classList.add('show'); if (!won) flash('red'); });
    at(won ? 3600 : 3400, function () { c.querySelector('.l3').classList.add('show'); });
    at(4300, function () { $('cineScore').classList.add('show'); });
    at(5000, function () { $('cineClose').classList.add('show'); });
    // 粒子
    var n = calm() ? 0 : 36;
    for (var i = 0; i < n; i++) at(Math.random() * 4000 + (won ? 1500 : 1800), function () {
      var p = document.createElement('div'); p.className = won ? 'spark' : 'ember';
      p.style.left = Math.random() * 100 + 'vw'; p.style.top = (60 + Math.random() * 40) + 'vh'; p.style.animationDuration = (2 + Math.random() * 2.5) + 's';
      c.appendChild(p); setTimeout(function () { p.remove(); }, 5000);
    });
  }
  $('cineClose').onclick = function () { hideCine(); };
  $('replayCine').onclick = function () { if (lastView && lastView.end) playCine(lastView); };

  function renderResult(v) {
    show('result');
    var e = v.end, won = e.won;
    $('rHead').className = 'rtitle ' + (won ? 'won' : 'lost');
    $('rIcon').textContent = won ? '✨' : '👿';
    $('rTitle').textContent = won ? '封印完了' : '悪魔が復活した';
    $('rText').textContent = won ? 'すべての札を納めきった！ 悪魔は永き眠りについた。' : seatName(v, e.stuck) + 'は' + (e.played ? (e.played + 1) + '枚目' : '1枚も') + '置けなかった… ' + e.rating.text;
    $('rScore').innerHTML = '残った札 <b>' + e.left + '</b> 枚<br><span class="rank">' + e.rating.label + '</span>';
    $('rStats').innerHTML = '手番の数：' + e.turns + '　置いた札：' + e.plays + '枚<br>逆流の術：' + e.backs + '回　いちばん大きな跳び：' + e.maxJump +
      '<br>列の最終：' + v.piles.map(function (p, i) { return PILE_LABEL[i] + ' ' + p.t; }).join('　');
    var R = v.reveal || { hands: {}, deckLeft: 0 };
    $('revealWrap').style.display = won ? 'none' : '';
    $('revealBox').innerHTML = v.seats.map(function (s) {
      var h = R.hands[s.sid] || [];
      return '<div class="rev-row"><span class="rn">' + esc(s.name) + '</span><span class="rev-cards">' + (h.length ? h.map(function (c) { return '<span class="mini">' + c + '</span>'; }).join('') : '<span style="color:var(--dim);font-size:12px">なし</span>') + '</span></div>';
    }).join('') + '<div class="hint">山札に残っていた札：' + R.deckLeft + '枚</div>';
    var key = v.gid + ':over';
    if (key !== lastOverKey) { lastOverKey = key; $('result').querySelector('.col').scrollTop = 0; }
    $('leaveBtn2').textContent = host ? '部屋を閉じる' : '部屋を出る';
  }

  // ---- 招待URLのコピー・共有 ----
  $('copyBtn').onclick = function () {
    var u = $('inviteUrl').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { toast('招待URLをコピーしました'); }, function () { toast('コピーできませんでした。URLを長押ししてコピーしてください'); });
  };
  $('shareBtn').onclick = function () {
    var u = $('inviteUrl').textContent;
    if (navigator.share) navigator.share({ title: '封魔の刻', text: '悪魔の封印を一緒に守ろう！', url: u }).catch(function () {});
    else $('copyBtn').click();
  };

  // ---- タイトル ----
  function renderTitle() {
    if (!$('nameIn').value) $('nameIn').value = load(LS_NAME) || '';
    var inv = normCode(Q.get('room'));
    $('inviteJoinBox').style.display = inv.length === 4 ? '' : 'none';
    $('invCode').textContent = inv; if (inv.length === 4) $('codeIn').value = inv;
    var saved = load(LS_HOST, true);
    var ok = saved && saved.room && Date.now() - saved.saved < 12 * 3600 * 1000;
    $('resumeBtn').style.display = ok ? '' : 'none';
    if (ok) $('resumeBtn').textContent = '前回の部屋（' + saved.room.code + '）を再開する';
    var j = sload(SS_CLIENT);
    $('rejoinBtn').style.display = j ? '' : 'none';
    if (j) $('rejoinBtn').textContent = '部屋 ' + j.code + ' に戻る（' + j.name + '）';
  }
  function getName() { var n = cleanName($('nameIn').value); if (!n) { toast('名前を入力してください'); $('nameIn').focus(); return null; } store(LS_NAME, n); return n; }
  $('createBtn').onclick = function () { var n = getName(); if (n) { store(LS_HOST, null); startHost(n, null); } };
  $('resumeBtn').onclick = function () { var s = load(LS_HOST, true); if (s) startHost(s.room.seats[0].name, s.room); };
  function join(code) { var n = getName(); if (!n) return; code = normCode(code); if (code.length !== 4) { toast('4文字の部屋コードを入力してください'); return; } startClient(code, n); }
  $('joinBtn').onclick = function () { join($('codeIn').value); };
  $('joinInvitedBtn').onclick = function () { join(Q.get('room')); };
  $('rejoinBtn').onclick = function () { var j = sload(SS_CLIENT); if (j) { $('nameIn').value = j.name; startClient(j.code, j.name); } };
  $('codeIn').addEventListener('input', function () { this.value = normCode(this.value); });

  // テスト・デバッグ用（ゲームの秘密情報はホスト以外には存在しません）
  window.__ds = {
    view: null, received: received,
    role: function () { return host ? 'host' : client ? 'client' : 'none'; },
    hostRoom: function () { return host ? host.room : null; },
    sendRaw: function (m) { if (client && client.conn) client.conn.send(m); }
  };
  renderTitle();
})();
