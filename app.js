'use strict';
/* Bio-Debate: peer assessment, quizzes, polls, anonymous feedback and text/link sharing.
   Backend: Supabase RPC functions (schema.sql, schema_v2.sql, schema_v3.sql). Keys live in config.js. */

/* ================= Core helpers ================= */
const $ = s => document.querySelector(s);
const app = $('#app');
const E = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f2 = v => Math.round(v * 100) / 100;
const SHAPES = ['▲', '◆', '●', '■'];
const URL_RE = /https?:\/\/[^\s]+/;

let lang = localStorage.vd_l || 'en';
const T = k => I[lang][k] ?? I.en[k] ?? k;

const rpc = (fn, body) =>
  fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async r => {
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.message) || 'Connection problem. Try again.');
    return j;
  });

const toast = m => {
  const t = $('#toast');
  t.textContent = m; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2800);
};
const token = localStorage.vd_tok || (localStorage.vd_tok = crypto.randomUUID());

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const a = document.createElement('textarea'); a.value = text; document.body.append(a); a.select(); document.execCommand('copy'); a.remove(); }
  toast(T('copiedT'));
}
const joinLink = code => location.origin + location.pathname + '?c=' + code;
const screenLink = code => location.origin + location.pathname + '#screen=' + code;
const makeQR = (el, code, size) => new QRCode(el, { text: joinLink(code), width: size, height: size });
function showQR(title, code) {
  const o = document.createElement('div');
  o.className = 'ov';
  o.innerHTML = `<h2 style="font-size:28px">${E(title)}</h2><div id="q" style="margin:18px"></div><p>${T('scan')}</p><div class="code" style="font-size:72px">${code}</div>`;
  o.onclick = () => o.remove();
  document.body.append(o);
  makeQR($('#q'), code, Math.min(300, innerWidth - 80));
}

/* ----- Navigation: a stack of views, wired to the phone's Back button ----- */
const H = [];
let tick;
const every = (fn, ms) => { clearInterval(tick); tick = setInterval(fn, ms); };
function draw() {
  clearInterval(tick);
  app.onclick = app.oninput = null;
  $('#bk').hidden = H.length < 2;
  H[H.length - 1]();
}
function nav(view) { H.push(view); history.pushState(null, ''); draw(); }
function repl(view) { H[H.length - 1] = view; draw(); }
addEventListener('popstate', () => { if (H.length > 1) { H.pop(); draw(); } });
$('#bk').onclick = () => history.back();

/* ----- Language ----- */
function applyLang() {
  document.documentElement.lang = lang === 'ku' ? 'ckb' : 'en';
  document.documentElement.dir = lang === 'ku' ? 'rtl' : 'ltr';
  $('#lg').textContent = lang === 'ku' ? 'EN' : 'کوردی';
  $('#sb').textContent = T('sub');
  $('#bk').setAttribute('aria-label', T('back'));
}
$('#lg').onclick = () => { lang = lang === 'ku' ? 'en' : 'ku'; localStorage.vd_l = lang; applyLang(); draw(); };

/* ================= Debate maths ================= */
// Final mark = students' share + teacher mark. Students' share = (average / rubric total) x total x (1 - weight).
function calcDebate(d) {
  const rubricMax = d.rubric.reduce((s, r) => s + r.max, 0);
  const w = d.w_teacher / 100, N = d.total_mark;
  return ['a', 'b'].map(k => {
    const g = d[k], cr = g.sums.map(v => g.n ? v / g.n : 0), avg = cr.reduce((s, v) => s + v, 0);
    const t = d['teacher_' + k], share = avg / rubricMax * N * (1 - w);
    return {
      name: d['group_' + k], n: g.n, cr, avg, share, t,
      mem: (d['members_' + k] || '').split('\n').map(s => s.trim()).filter(Boolean),
      final: share + (t ?? 0)
    };
  }).sort((x, y) => y.final - x.final);
}
const debateBoard = d => {
  const N = d.total_mark, w = d.w_teacher / 100;
  return calcDebate(d).map((x, i) => `<div class="rk ${i ? '' : 'w'}"><i>${i + 1}</i><div><b>${E(x.name)}</b>
    <small>${T('stu')} ${f2(x.share)}/${f2(N * (1 - w))}, ${x.t != null ? `${T('tch')} ${f2(x.t)}/${f2(N * w)}` : T('pending')}</small></div><em>${f2(x.final)}/${f2(N)}</em></div>`).join('');
};
const rankList = (a, real) => (a || []).map(x => `<div class="rk"><i>${x.pos}</i><div><b>${E(x.name)}</b><small>${E(x.grp)}${x.real != null ? `, ${x.real}/${real}` : ''}</small></div><em>${x.score}</em></div>`).join('');

/* ================= Poll result chart (shown when a poll finishes) ================= */
const POLL_COLORS = ['#1f5eff', '#e8590c', '#0f9d6e', '#8a3ffc'];
const pollFrom = z => z.questions.map((q, j) => ({
  q: q.q, o: q.o,
  counts: q.o.map((_, i) => z.players.filter(p => p.ans.some(a => a.qi === j && a.ch === i)).length)
}));
function pollChart(res) {
  return res.map(r => {
    const total = r.counts.reduce((s, v) => s + v, 0), top = Math.max(...r.counts);
    let acc = 0;
    const stops = total
      ? r.counts.map((v, i) => { const from = acc / total * 100; acc += v; return `${POLL_COLORS[i]} ${from}% ${acc / total * 100}%`; }).join(',')
      : '#e8edf3 0 100%';
    const bars = r.o.map((o, i) => {
      const pct = total ? r.counts[i] / total * 100 : 0;
      return `<div class="pr${total && r.counts[i] === top ? ' top' : ''}"><div class="pl"><span>${SHAPES[i]} ${E(o)}</span><b>${r.counts[i]} · ${+pct.toFixed(1)}%</b></div>
        <div class="pt"><i style="width:${pct}%;background:${POLL_COLORS[i]}"></i></div></div>`;
    }).join('');
    return `<div class="pq"><h3>${E(r.q)}</h3><div class="donut" style="background:conic-gradient(${stops})"><span><b>${total}</b><small>${T('votes')}</small></span></div>${bars}</div>`;
  }).join('');
}

/* ================= Student views ================= */
let D, C, S, sig = '', F, M;   // current debate, code, quiz state, signature, feedback item, member/presenter evaluation
const pollRes = {};            // finished poll results by code, for the final chart
let pollBusy = false;
const stamp = s => { s.dl = Date.now() + (s.left || 0) * 1000; return s; };
setInterval(() => { const b = $('#tb'); if (b && S && S.q && S.dl) b.style.width = Math.max(0, (S.dl - Date.now()) / 1000 / S.q.t * 100) + '%'; }, 200);

const code0 = new URLSearchParams(location.search).get('c') || '';
let autoJoin = code0.length === 4;

function vJoin() {
  app.innerHTML = `<div class="card"><h2>${T('joinT')}</h2><p>${T('joinP')}</p>
    <input id="c" class="digits" type="text" inputmode="numeric" maxlength="4" placeholder="0000" value="${E(code0)}" autocomplete="off">
    <button class="btn" id="go">${T('go')}</button></div>`;
  $('#c').oninput = e => { e.target.value = e.target.value.replace(/\D/g, ''); };
  $('#go').onclick = async () => {
    const c = $('#c').value.trim();
    try {
      const kind = await rpc('vx_kind', { c });
      C = c;
      if (kind === 'd') { D = await rpc('vd_get', { c }); nav(vDebate); }
      else if (kind === 'q') { S = stamp(await rpc('vq_state', { c, tok: token })); await enterQuiz(); }
      else if (kind === 'm') { M = await rpc('vm_get', { c }); nav(vMembers); }
      else { F = await rpc('vf_get', { c }); nav(F.kind === 'copy' ? vShare : vFeedback); }
    } catch (e) { toast(e.message); }
  };
  if (autoJoin) { autoJoin = false; $('#go').click(); }
}

/* --- Peer assessment: both groups on one screen, one submit --- */
function vDebate() {
  const d = D, key = 'vd:' + d.id;
  if (d.released) { app.innerHTML = `<div class="card"><h2>${E(d.title)}</h2><p>${T('res')}</p>${debateBoard(d)}</div>`; return; }
  if (d.status !== 'open') {
    app.innerHTML = `<div class="card"><h2>${E(d.title)}</h2><p>${T('closedP')}</p><button class="btn o" id="rf">${T('chk')}</button></div>`;
    $('#rf').onclick = async () => { try { D = await rpc('vd_get', { c: d.code }); draw(); } catch (e) { toast(e.message); } };
    return;
  }
  if (localStorage[key]) { app.innerHTML = `<div class="card"><h2>${E(d.title)}</h2><p class="ok">${T('done')}</p></div>`; return; }
  const team = k => `<div class="card team ${k === 'b' ? 'B' : ''}" data-k="${k}"><h2>${E(d['group_' + k])}</h2>${d.rubric.map(r =>
    `<div class="crit"><span>${E(r.name)}</span><output>${Math.round(r.max / 2)}/${r.max}</output><input type="range" min="0" max="${r.max}" step="1" value="${Math.round(r.max / 2)}" data-m="${r.max}"></div>`).join('')}</div>`;
  app.innerHTML = `<div class="card"><h2>${E(d.title)}</h2><p>${T('scoreBoth')}</p></div>${team('a')}${team('b')}<button class="btn" id="send">${T('sendBoth')}</button>`;
  app.oninput = e => { if (e.target.type === 'range') e.target.previousElementSibling.textContent = e.target.value + '/' + e.target.dataset.m; };
  $('#send').onclick = async e => {
    const btn = e.target, scores = k => [...document.querySelectorAll(`[data-k=${k}] input`)].map(x => +x.value);
    btn.disabled = true;
    try { await rpc('vd_submit2', { c: d.code, tok: token, sa: scores('a'), sb: scores('b') }); localStorage[key] = 1; toast(T('sent')); draw(); }
    catch (er) { if (/already/.test(er.message)) { localStorage[key] = 1; draw(); } else { btn.disabled = false; toast(er.message); } }
  };
}

/* --- Evaluation by members, or of one presenter: every person is scored on their own --- */
const evalFinal = m => {
  const w = m.w_teacher / 100;
  return m.people.map(p => { const avg = p.n ? p.sum / p.n : 0, share = avg * (1 - w); return { ...p, avg, share, final: share + (p.teacher ?? 0) }; })
    .sort((a, b) => b.final - a.final);
};
const evalBoard = m => {
  const N = m.total_mark, w = m.w_teacher / 100, many = m.people.length > 1;
  return evalFinal(m).map((x, i) => `<div class="rk ${i ? '' : 'w'}">${many ? `<i>${i + 1}</i>` : ''}<div><b>${E(x.name)}</b>${x.grp ? `<small>${E(x.grp)}</small>` : ''}
    <small>${T('stu')} ${f2(x.share)}/${f2(N * (1 - w))}, ${x.teacher != null ? `${T('tch')} ${f2(x.teacher)}/${f2(N * w)}` : T('pending')}</small></div><em>${f2(x.final)}/${f2(N)}</em></div>`).join('');
};
function vMembers() {
  const m = M, key = 'vm:' + m.id;
  if (m.released) { app.innerHTML = `<div class="card"><h2>${E(m.title)}</h2><p>${T('res')}</p>${evalBoard(m)}</div>`; return; }
  if (m.status !== 'open') {
    app.innerHTML = `<div class="card"><h2>${E(m.title)}</h2><p>${T('closedP')}</p><button class="btn o" id="rf">${T('chk')}</button></div>`;
    $('#rf').onclick = async () => { try { M = await rpc('vm_get', { c: m.code }); draw(); } catch (e) { toast(e.message); } };
    return;
  }
  if (localStorage[key]) { app.innerHTML = `<div class="card"><h2>${E(m.title)}</h2><p class="ok">${T('done')}</p></div>`; return; }
  const N = m.total_mark, step = N > 20 ? 1 : 0.5, half = step === 1 ? Math.round(N / 2) : Math.round(N) / 2, groups = [];
  m.people.forEach(p => { const g = groups[groups.length - 1]; if (g && g.name === p.grp) g.list.push(p); else groups.push({ name: p.grp, list: [p] }); });
  const row = p => `<div class="crit"><span>${E(p.name)}</span><output>${half}/${f2(N)}</output><input type="range" min="0" max="${N}" step="${step}" value="${half}" data-m="${f2(N)}"></div>`;
  app.innerHTML = `<div class="card"><h2>${E(m.title)}</h2><p>${T(m.style === 'person' ? 'scorePerson' : 'scoreMembers')} ${T('outOf')} ${f2(N)}.</p></div>` +
    groups.map((g, gi) => `<div class="card team ${gi % 2 ? 'B' : ''}">${g.name ? `<h2>${E(g.name)}</h2>` : ''}${g.list.map(row).join('')}</div>`).join('') +
    `<button class="btn" id="send">${T('sendAll')}</button>`;
  app.oninput = e => { if (e.target.type === 'range') e.target.previousElementSibling.textContent = e.target.value + '/' + e.target.dataset.m; };
  $('#send').onclick = async e => {
    const btn = e.target;
    btn.disabled = true;
    try {
      await rpc('vm_submit', { c: m.code, tok: token, sc: [...document.querySelectorAll('#app input[type=range]')].map(x => +x.value) });
      localStorage[key] = 1; toast(T('sent')); draw();
    } catch (er) { if (/already/.test(er.message)) { localStorage[key] = 1; draw(); } else { btn.disabled = false; toast(er.message); } }
  };
}

/* --- Quiz and poll --- */
async function enterQuiz() {
  if (!S.me && S.kind === 'poll') { await rpc('vq_join', { c: C, tok: token, nm: '', gr: '' }); S = stamp(await rpc('vq_state', { c: C, tok: token })); }
  nav(S.me ? vQuiz : vQuizForm);
}
function vQuizForm() {
  app.innerHTML = `<div class="card"><h2>${E(S.title)}</h2><p>${T('qjp')}</p>
    <input id="n" type="text" maxlength="40" placeholder="${T('nm')}" value="${E(localStorage.vd_n || '')}">
    <input id="g" type="text" maxlength="30" placeholder="${T('gr')}" value="${E(localStorage.vd_g || '')}">
    <button class="btn" id="go">${T('enter')}</button></div>`;
  $('#go').onclick = async () => {
    const n = $('#n').value.trim(), g = $('#g').value.trim();
    if (n.length < 2 || !g) return toast(T('req'));
    try {
      await rpc('vq_join', { c: C, tok: token, nm: n, gr: g });
      localStorage.vd_n = n; localStorage.vd_g = g;
      S = stamp(await rpc('vq_state', { c: C, tok: token })); repl(vQuiz);
    } catch (e) { toast(e.message); }
  };
}
function vQuiz() {
  sig = '';
  const get = async () => { S = stamp(await rpc('vq_state', { c: C, tok: token })); paintQuiz('p'); };
  paintQuiz('p');
  every(() => get().catch(() => {}), 1500);
  app.onclick = async e => {
    const b = e.target.closest('[data-ch]');
    if (!b || b.disabled) return;
    try { await rpc('vq_answer', { c: C, tok: token, ch: +b.dataset.ch }); S.me.ch = +b.dataset.ch; sig = ''; paintQuiz('p'); }
    catch (er) { toast(er.message); }
  };
}
function paintQuiz(mode) {
  const s = S;
  if (s.kind === 'poll' && s.phase === 'end' && !pollRes[C] && !pollBusy) {
    pollBusy = true;   // fetch the final results once; retry after 5 seconds if it fails
    rpc('vq_results', { c: C }).then(r => { pollRes[C] = r; sig = ''; paintQuiz(mode); }).catch(() => {}).finally(() => setTimeout(() => { pollBusy = false; }, 5000));
  }
  const k = [mode, s.phase, s.qi, s.n, s.ans_n, s.rv, s.me && s.me.ch, s.me && s.me.score, lang, !!pollRes[C]].join('|');
  if (k === sig) return;
  sig = k;
  app.innerHTML = quizView(s, mode);
  if (mode === 's' && s.phase === 'lobby') makeQR($('#q'), C, 280);
}
// mode 'p' = player phone, 's' = projector screen
function quizView(s, mode) {
  const big = mode === 's', poll = s.kind === 'poll';
  if (s.phase === 'lobby')
    return `<div class="card ctr"><h2>${E(s.title)}</h2><p>${T(big ? 'scan' : 'wait')}</p>${big ? `<div id="q"></div><div class="code">${C}</div>` : ''}<p><b>${s.n}</b> ${T('plr')}</p></div>`;
  if (s.phase === 'end') {
    if (poll) return `<div class="card ctr"><h2>${E(s.title)}</h2><p>${T('thanksP')}</p></div>` +
      (pollRes[C] && pollRes[C].length ? `<div class="card"><h2>${T('pollRes')}</h2>${pollChart(pollRes[C])}</div>` : '');
    const me = s.me && s.rv >= 4 && s.me.score != null
      ? `<p><b>${T('rank')} ${s.me.rank}, ${s.me.score} ${T('pts')}${s.me.real != null ? `, ${s.me.real}/${s.real}` : ''}</b></p>` : (!big && s.rv < 4 ? `<p>${T('wr')}</p>` : '');
    return `<div class="card"><h2>${T('fin')}</h2>${big ? '' : me}${rankList(s.top, s.real)}</div>`;
  }
  const q = s.q, reveal = s.phase === 'r', ch = s.me ? s.me.ch : null, answered = ch != null;
  let h = `<div class="card"><div class="row"><b>${T('qn')} ${s.qi + 1}/${s.total}</b>${reveal ? '' : '<div class="bar"><i id="tb"></i></div>'}</div>
    <h2 style="font-size:${big ? 30 : 22}px;margin-top:10px">${E(q.q)}</h2>`;
  h += q.o.map((o, i) => {
    const win = reveal && !poll && i === q.c, dim = reveal && !poll && i !== q.c;
    return `<button class="opt o${i}${win ? ' win' : ''}${dim ? ' dim' : ''}${ch === i ? ' sel' : ''}" ${big || reveal || (answered && !s.change) ? 'disabled' : ''} data-ch="${i}"><span>${SHAPES[i]} ${E(o)}</span>${reveal ? `<em>${s.counts[i]}</em>` : ''}</button>`;
  }).join('');
  if (big && !reveal) h += `<p>${s.ans_n}/${s.n} ${T('ans')}</p>`;
  if (!big && !reveal && answered) h += `<p class="ok">${T(s.change ? 'saved' : 'locked')}</p>`;
  if (!big && reveal && !poll) h += `<p class="${ch === q.c ? 'ok' : 'bad'}"><b>${answered ? (ch === q.c ? T('ok') : T('no')) : T('tu')}</b></p>`;
  return h + '</div>';
}

/* --- Anonymous feedback and shared text/link --- */
const wordCount = t => (t.trim().match(/\S+/g) || []).length;
function vFeedback() {
  const key = 'vf:' + F.id;
  if (localStorage[key]) { app.innerHTML = `<div class="card"><h2>${E(F.title)}</h2><p class="ok">${T('fsent')}</p></div>`; return; }
  if (!F.open) { app.innerHTML = `<div class="card"><h2>${E(F.title)}</h2><p>${T('fclosed')}</p></div>`; return; }
  app.innerHTML = `<div class="card"><h2>${E(F.title)}</h2><p>${E(F.body)}</p><textarea id="t" style="min-height:180px" placeholder="${T('fph')}"></textarea>
    <div class="wc" id="wc">0/500 ${T('words')}</div><button class="btn" id="send">${T('send')}</button></div>`;
  app.oninput = () => { const n = wordCount($('#t').value), w = $('#wc'); w.textContent = `${n}/500 ${T('words')}`; w.classList.toggle('bad', n > 500); $('#send').disabled = n > 500 || n === 0; };
  $('#send').disabled = true;
  $('#send').onclick = async () => {
    try { await rpc('vf_send', { c: F.code, tok: token, txt: $('#t').value }); localStorage[key] = 1; draw(); }
    catch (e) { if (/already/.test(e.message)) { localStorage[key] = 1; draw(); } else toast(e.message); }
  };
}
function vShare() {
  const link = (F.body.match(URL_RE) || [])[0];
  app.innerHTML = `<div class="card"><h2>${E(F.title)}</h2><div class="share">${E(F.body)}</div>
    <button class="btn A" id="cp">${T('copyBtn')}</button>${link ? `<br><a class="btn o" href="${E(link)}" target="_blank" rel="noopener noreferrer">${T('openL')}</a>` : ''}</div>`;
  $('#cp').onclick = () => copyText(F.body);
}

/* ================= Projector screen (public; controlled from the teacher's phone) ================= */
function vScreen() {
  document.querySelector('main').classList.add('wide');
  let kind, last = '';
  const frame = async () => {
    try {
      kind = kind || await rpc('vx_kind', { c: C });
      if (kind === 'q') { S = stamp(await rpc('vq_state', { c: C, tok: '-' })); paintQuiz('s'); return; }
      const item = kind === 'd' ? await rpc('vd_get', { c: C }) : kind === 'm' ? await rpc('vm_get', { c: C }) : await rpc('vf_get', { c: C });
      const k = [item.released, item.status, item.open, lang].join('|');
      if (k === last) return;
      last = k;
      if (kind === 'd' && item.released) app.innerHTML = `<div class="card"><h2>${E(item.title)}</h2><p>${T('res')}</p>${debateBoard(item)}</div>`;
      else if (kind === 'm' && item.released) app.innerHTML = `<div class="card"><h2>${E(item.title)}</h2><p>${T('res')}</p>${evalBoard(item)}</div>`;
      else { app.innerHTML = `<div class="card ctr"><h2>${E(item.title)}</h2><p>${T('scan')}</p><div id="q"></div><div class="code">${C}</div></div>`; makeQR($('#q'), C, 280); }
    } catch (e) { app.innerHTML = `<div class="card">${E(e.message)}</div>`; }
  };
  frame(); every(frame, 1500);
}

/* ================= Export: Excel and Word, everything in one file ================= */
const dataRows = {
  final: d => calcDebate(d).map((x, i) => ({ Rank: i + 1, Debate: d.title, Group: x.name, Members: x.mem.join(', '), 'Final result': f2(x.final), 'Out of': f2(d.total_mark) })),
  detail: d => {
    const N = d.total_mark, w = d.w_teacher / 100;
    return calcDebate(d).map((x, i) => {
      const o = { Debate: d.title, Rank: i + 1, Group: x.name, Votes: x.n };
      d.rubric.forEach((r, j) => { o[`${r.name} (/${r.max})`] = f2(x.cr[j]); });
      return { ...o, 'Students share': f2(x.share), 'Students max': f2(N * (1 - w)), 'Teacher mark': x.t ?? '', 'Teacher max': f2(N * w), 'Final result': f2(x.final), 'Out of': f2(N) };
    });
  },
  members: d => calcDebate(d).flatMap(x => x.mem.map(m => ({ Debate: d.title, Group: x.name, Student: m }))),
  quiz: z => z.players.map(p => {
    const o = { Quiz: z.title, Rank: p.pos, Name: p.name, Group: p.grp, Points: p.score, Correct: p.ok };
    if (z.opts.real) o['Real score'] = p.real;
    z.questions.forEach((_, j) => { const a = p.ans.find(a => a.qi === j); o['Q' + (j + 1)] = a ? a.pts : 0; });
    return o;
  }),
  poll: z => z.questions.flatMap((q, j) => q.o.map((opt, i) => ({ Poll: z.title, Question: q.q, Option: opt, Votes: z.players.filter(p => p.ans.some(a => a.qi === j && a.ch === i)).length }))),
  real: z => z.players.map(p => ({ Name: p.name, Group: p.grp, 'Real score': p.real, 'Out of': z.opts.real })),
  eval: m => {
    const N = m.total_mark, w = m.w_teacher / 100;
    return evalFinal(m).map((x, i) => ({
      Evaluation: m.title, Type: m.style === 'person' ? 'Presenter' : 'Members', Rank: i + 1, Group: x.grp, Name: x.name, Votes: x.n,
      'Student average': f2(x.avg), 'Students share': f2(x.share), 'Students max': f2(N * (1 - w)),
      'Teacher mark': x.teacher ?? '', 'Teacher max': f2(N * w), 'Final result': f2(x.final), 'Out of': f2(N)
    }));
  },
  feedback: f => f.responses.map((r, i) => ({ Form: f.title, '#': i + 1, Date: (r.at || '').slice(0, 16).replace('T', ' '), Response: r.body }))
};
function buildSheets({ ds = [], qs = [], fs = [], ms = [] }) {
  const out = [];
  const add = (name, rows) => rows.length && out.push([name, rows]);
  add('Final result', ds.flatMap(dataRows.final));
  add('Assessment details', ds.flatMap(dataRows.detail));
  add('Members', ds.flatMap(dataRows.members));
  add('Evaluation results', ms.flatMap(dataRows.eval));
  qs.forEach(z => {
    add((z.kind === 'poll' ? 'Poll ' : 'Quiz ') + z.title, z.kind === 'poll' ? dataRows.poll(z) : dataRows.quiz(z));
    if (z.kind === 'quiz' && z.opts.real) add('Real score ' + z.title, dataRows.real(z));
  });
  fs.filter(f => f.kind === 'feedback').forEach(f => add('Feedback ' + f.title, dataRows.feedback(f)));
  return out;
}
const toTable = rows => '<table><tr>' + Object.keys(rows[0]).map(k => `<th>${E(k)}</th>`).join('') + '</tr>' +
  rows.map(o => '<tr>' + Object.values(o).map(v => `<td>${E(v)}</td>`).join('') + '</tr>').join('') + '</table>';
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function exportData(format, src) {
  const sheets = buildSheets(src), name = 'bio-debate-' + new Date().toISOString().slice(0, 10);
  if (!sheets.length) return toast(T('none'));
  if (format === 'x') {
    if (!window.XLSX) return toast('Excel library not loaded. Check your connection.');
    const wb = XLSX.utils.book_new(), used = new Set();
    sheets.forEach(([n, rows], i) => {
      let s = n.replace(/[\\\/?*\[\]:]/g, '').slice(0, 28) || 'Sheet';
      if (used.has(s)) s += ' ' + (i + 1);
      used.add(s); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), s);
    });
    XLSX.writeFile(wb, name + '.xlsx');
  } else {
    const body = sheets.map(([n, rows]) => `<h2>${E(n)}</h2>${toTable(rows)}`).join('');
    download(new Blob(['\ufeff<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>body{font-family:Calibri,Tahoma,Arial}table{border-collapse:collapse;margin-bottom:14px}td,th{border:1px solid #888;padding:4px 8px}th{background:#0d1b2a;color:#fff}</style></head><body dir="' +
      (lang === 'ku' ? 'rtl' : 'ltr') + '"><h1>Bio-Debate</h1>' + body + '</body></html>'], { type: 'application/msword' }), name + '.doc');
  }
}

/* ================= Teacher ================= */
let P = sessionStorage.vp || '', L = [], Q = [], FI = [], MS = [], TS = [], tab = 'a', astyle = 'd', ofilter = 'all';
const TABS = [['a', 'tabA'], ['q', 'tabQ'], ['p', 'tabP'], ['f', 'tabF'], ['s', 'tabS']];
// Who is signed in. The owner signs in with the passcode alone; a teacher with username + passcode.
// legacy = schema_v5.sql is not installed yet, so the app behaves exactly as before (owner only).
let ME = { admin: true, legacy: true, name: '' };
const SEP = '\u001f';   // separates username and passcode in a teacher's login
const tabsFor = () => ME.legacy ? TABS : [...TABS, ['t', ME.admin ? 'tabT' : 'tabAcc']];
const ownTag = x => (ME.admin && !ME.legacy && x.owner) ? `<span class="tag own">${E(x.owner)}</span>` : '';
const visible = x => ofilter === 'all' || (ofilter === 'mine' ? !x.owner_id : x.owner_id === ofilter);
const load = async () => {
  [L, Q, FI, MS] = await Promise.all([rpc('vd_list', { p: P }), rpc('vq_list', { p: P }).catch(() => []), rpc('vf_list', { p: P }).catch(() => []), rpc('vm_list', { p: P }).catch(() => [])]);
  if (tab === 't' && ME.admin && !ME.legacy) TS = await rpc('vt_list', { p: P });
};
const reload = async () => { try { await load(); draw(); } catch (e) { toast(e.message); } };
async function boot() {
  ME = await rpc('vt_me', { p: P }).catch(e => (/Wrong|disabled/i.test(e.message) ? Promise.reject(e) : null)) || { admin: true, legacy: true, name: '' };
  await load();
}

function vTeacher() {
  if (!P) return vLogin();
  boot().then(() => repl(vDash)).catch(() => { P = ''; sessionStorage.vp = ''; vLogin(); });
}
function vLogin() {
  app.innerHTML = `<div class="card"><h2>${T('tp')}</h2><p>${T('userHint')}</p><input id="u" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="${T('user')}">
    <p>${T('pass')}</p><input id="p" type="password" autocomplete="current-password"><button class="btn" id="go">${T('in')}</button></div>`;
  $('#go').onclick = async () => {
    const u = $('#u').value.trim().toLowerCase();
    P = u ? u + SEP + $('#p').value : $('#p').value;
    try { await boot(); sessionStorage.vp = P; repl(vDash); } catch (e) { P = ''; toast(e.message); }
  };
}

/* ----- Cards ----- */
const teacherMax = (total, w) => f2(total * w / 100);
const debateCard = d => {
  const mx = teacherMax(d.total_mark, d.w_teacher);
  return `<div class="card" data-id="${d.id}"><div class="row"><h2>${E(d.title)}</h2>${ownTag(d)}<span class="tag ${d.status === 'open' ? 'on' : ''}">${d.status === 'open' ? T('open') : T('cl')}</span></div>
  <p>${E(d.group_a)} / ${E(d.group_b)}</p><div class="code">${d.code}</div>
  <div class="row"><button class="btn s" data-a="qr">${T('qr')}</button><button class="btn o s" data-a="link">${T('scr')}</button>
  <button class="btn o s" data-a="tg">${d.status === 'open' ? T('close') : T('reopen')}</button><button class="btn o s" data-a="rel">${d.released ? T('hide') : T('rel')}</button></div>
  <div class="row" style="margin-top:12px"><div><p style="margin:0 0 4px">${T('total')}</p><input type="number" class="tm" min="1" step="any" value="${d.total_mark}"></div></div>
  <p>${T('wt')}: <b class="wv">${d.w_teacher}</b>% ${T('tch')}, <b class="sv">${100 - d.w_teacher}</b>% ${T('stu')}</p>
  <input type="range" class="w" min="0" max="100" step="5" value="${d.w_teacher}" style="width:100%;accent-color:#0d1b2a">
  <p style="margin-top:12px">${T('ys')} <b class="mx">${mx}</b></p>
  <div class="row"><input type="number" class="ta" min="0" max="${mx}" step="any" placeholder="${E(d.group_a)}" value="${d.teacher_a ?? ''}"><input type="number" class="tb" min="0" max="${mx}" step="any" placeholder="${E(d.group_b)}" value="${d.teacher_b ?? ''}"></div>
  <p style="margin:0 0 6px">${T('mems')}</p><div class="row"><textarea class="ma" placeholder="${E(d.group_a)}">${E(d.members_a)}</textarea><textarea class="mb" placeholder="${E(d.group_b)}">${E(d.members_b)}</textarea></div>
  <div class="row"><button class="btn s" data-a="save">${T('save')}</button><button class="btn o s" data-a="again">${T('again')}</button><button class="btn o s" data-a="xl">${T('xl')}</button><button class="btn o s" data-a="wd">${T('wd')}</button><button class="btn o s" data-a="del">${T('del')}</button></div>
  <div class="live" style="margin-top:12px"></div></div>`;
};
const quizCard = z => `<div class="card" data-qid="${z.id}"><div class="row"><h2>${E(z.title)}</h2>${ownTag(z)}<span class="tag on qp"></span></div><div class="code">${z.code}</div>
  <div class="row"><button class="btn o s" data-a="qr">${T('qr')}</button><button class="btn o s" data-a="link">${T('scr')}</button></div><br>
  <button class="btn A" data-a="go"></button><div class="live"></div>
  <div class="row" style="margin-top:12px"><button class="btn o s" data-a="xl">${T('xl')}</button><button class="btn o s" data-a="wd">${T('wd')}</button><button class="btn o s" data-a="end">${T('last')}</button><button class="btn o s" data-a="again">${T('again')}</button><button class="btn o s" data-a="del">${T('del')}</button></div></div>`;
const formCard = f => `<div class="card" data-fid="${f.id}"><div class="row"><h2>${E(f.title)}</h2>${ownTag(f)}${f.kind === 'feedback' ? `<span class="tag ${f.open ? 'on' : ''}">${f.open ? T('open') : T('cl')}</span>` : ''}</div>
  <div class="code">${f.code}</div><div class="row"><button class="btn o s" data-a="qr">${T('qr')}</button><button class="btn o s" data-a="link">${T('scr')}</button>${f.kind === 'feedback' ? `<button class="btn o s" data-a="tgf">${f.open ? T('close') : T('reopen')}</button>` : ''}</div>
  ${f.kind === 'copy' ? `<div class="share">${E(f.body)}</div>` : `<p style="margin-top:10px"><b>${f.responses.length}</b> ${T('resp')}</p><div class="scroll">${f.responses.map(r => `<div class="resp">${E(r.body)}</div>`).join('')}</div>`}
  <div class="row" style="margin-top:12px">${f.kind === 'feedback' ? `<button class="btn o s" data-a="xl">${T('xl')}</button><button class="btn o s" data-a="wd">${T('wd')}</button>` : ''}<button class="btn o s" data-a="again">${T('again')}</button><button class="btn o s" data-a="del">${T('del')}</button></div></div>`;

/* ----- Forms ----- */
const forms = {
  a: () => `<div class="card"><h2>${T('newD')}</h2><input id="t" type="text" placeholder="${T('ttl')}"><div class="row"><input id="ga" type="text" placeholder="${T('ga')}"><input id="gb" type="text" placeholder="${T('gb')}"></div>
    <p style="margin:0 0 6px">${T('mem')}</p><div class="row"><textarea id="ma"></textarea><textarea id="mb"></textarea></div>
    <p style="margin:0 0 6px">${T('rub')}</p><textarea id="r">Arguments, 10\nRebuttal, 10\nEvidence, 10\nDelivery, 10</textarea>
    <p style="margin:0 0 6px">${T('total')}</p><input id="tm" type="number" min="1" step="any" value="10">
    <p style="margin:0 0 6px">${T('wt')}: <b id="wv">50</b>% ${T('tch')}</p><input id="w" type="range" min="0" max="100" step="5" value="50" style="width:100%;accent-color:#0d1b2a"><br><br>
    <button class="btn" id="mk">${T('mk')}</button></div>`,
  q: () => `<div class="card"><h2>${T('newQ')}</h2><input id="t" type="text" placeholder="${T('ttl')}"><p style="margin:0 0 6px">${T('qf')}</p>
    <textarea id="qq" style="min-height:140px">What is the capital of Iraq? | Erbil | Baghdad | Basra | Mosul | 2</textarea>
    <p style="margin:0 0 6px">${T('secs')}</p><input id="secs" type="number" min="5" max="120" value="20">
    <p style="margin:0 0 6px">${T('real')}</p><input id="real" type="number" min="0" step="any">
    <label class="chk"><input id="chg" type="checkbox" checked> ${T('chg')}</label><button class="btn" id="mkq">${T('mkQ')}</button></div>`,
  p: () => `<div class="card"><h2>${T('newP')}</h2><input id="t" type="text" placeholder="${T('ttl')}"><p style="margin:0 0 6px">${T('pf')}</p>
    <textarea id="qq" style="min-height:140px">Which topic next? | Genetics | Ecology | Biotechnology</textarea>
    <p style="margin:0 0 6px">${T('secs')}</p><input id="secs" type="number" min="5" max="120" value="30"><button class="btn" id="mkp">${T('mkP')}</button></div>`,
  f: () => `<div class="card"><h2>${T('newF')}</h2><input id="t" type="text" placeholder="${T('ttl')}"><textarea id="b" placeholder="${T('fq')}"></textarea><button class="btn" id="mkf">${T('newF')}</button></div>`,
  s: () => `<div class="card"><h2>${T('newS')}</h2><input id="t" type="text" placeholder="${T('ttl')}"><textarea id="b" style="min-height:140px" placeholder="${T('body')}"></textarea><button class="btn" id="mks">${T('newS')}</button></div>`
};
/* ----- Assessment styles: debate with rubric (unchanged), by members, single presenter ----- */
const debateForm = forms.a;
const styleBar = () => `<div class="tabs">${[['d', 'styleD'], ['m', 'styleM'], ['p', 'styleP']].map(([k, label]) =>
  `<button class="btn ${astyle === k ? '' : 'o'}" data-sty="${k}">${T(label)}</button>`).join('')}</div>`;
const markFields = () => `<p style="margin:0 0 6px">${T('total')}</p><input id="tm" type="number" min="1" step="any" value="10">
  <p style="margin:0 0 6px">${T('wt')}: <b id="wv">50</b>% ${T('tch')}</p><input id="w" type="range" min="0" max="100" step="5" value="50" style="width:100%;accent-color:#0d1b2a"><br><br>`;
const evalForm = () => astyle === 'm'
  ? `<div class="card"><h2>${T('newM')}</h2><input id="t" type="text" placeholder="${T('ttl')}"><p style="margin:0 0 6px">${T('gmf')}</p>
     <textarea id="gm" style="min-height:120px">Group A: Ali, Sara, Dana, Kaywan\nGroup B: Rebin, Hana</textarea>${markFields()}<button class="btn" id="mkm">${T('mkM')}</button></div>`
  : `<div class="card"><h2>${T('newPr')}</h2><input id="t" type="text" placeholder="${T('ttl')}"><input id="pn" type="text" placeholder="${T('pname')}">${markFields()}<button class="btn" id="mkpr">${T('mkM')}</button></div>`;
forms.a = () => styleBar() + (astyle === 'd' ? debateForm() : evalForm());

const evalCard = m => {
  const N = m.total_mark, mx = teacherMax(N, m.w_teacher);
  let prev = null;
  const rows = m.people.map((p, i) => {
    const head = p.grp && p.grp !== prev ? `<p style="margin:12px 0 4px"><b>${E(p.grp)}</b></p>` : '';
    prev = p.grp;
    return `${head}<div class="row"><span style="flex:2">${E(p.name)}</span><input type="number" class="tt" data-i="${i}" min="0" max="${mx}" step="any" value="${p.teacher ?? ''}"></div>`;
  }).join('');
  return `<div class="card" data-mid="${m.id}" data-total="${N}"><div class="row"><h2>${E(m.title)}</h2>${ownTag(m)}<span class="tag ${m.status === 'open' ? 'on' : ''}">${m.status === 'open' ? T('open') : T('cl')}</span></div>
  <p>${T(m.style === 'person' ? 'evalP' : 'evalM')}, ${T('total')} ${f2(N)}</p><div class="code">${m.code}</div>
  <div class="row"><button class="btn s" data-a="qr">${T('qr')}</button><button class="btn o s" data-a="link">${T('scr')}</button>
  <button class="btn o s" data-a="tg">${m.status === 'open' ? T('close') : T('reopen')}</button><button class="btn o s" data-a="rel">${m.released ? T('hide') : T('rel')}</button></div>
  <p style="margin-top:12px">${T('wt')}: <b class="wv">${m.w_teacher}</b>% ${T('tch')}, <b class="sv">${100 - m.w_teacher}</b>% ${T('stu')}</p>
  <input type="range" class="w" min="0" max="100" step="5" value="${m.w_teacher}" style="width:100%;accent-color:#0d1b2a">
  <p style="margin-top:12px">${T('ys')} <b class="mx">${mx}</b></p>${rows}
  <div class="row" style="margin-top:12px"><button class="btn s" data-a="saveM">${T('save')}</button><button class="btn o s" data-a="again">${T('again')}</button><button class="btn o s" data-a="xl">${T('xl')}</button><button class="btn o s" data-a="wd">${T('wd')}</button><button class="btn o s" data-a="del">${T('del')}</button></div>
  <div class="live" style="margin-top:12px"></div></div>`;
};
const groupsOf = m => m.people.reduce((g, p) => {
  const last = g[g.length - 1];
  if (last && last.name === p.grp) last.members.push(p.name); else g.push({ name: p.grp, members: [p.name] });
  return g;
}, []);

const parseQuestions = (text, secs, withAnswer) => text.split('\n').map(l => l.split('|').map(s => s.trim())).filter(a => a[0] && a.length >= (withAnswer ? 4 : 3))
  .map(a => { const c = withAnswer ? +a.pop() - 1 : undefined, o = a.slice(1).filter(Boolean); return { q: a[0], o, ...(withAnswer ? { c } : {}), t: secs }; })
  .filter(x => x.o.length >= 2 && x.o.length <= 4 && (x.c === undefined || (x.c >= 0 && x.c < x.o.length)));

/* ----- Dashboard ----- */
const quizLabel = z => {
  const last = z.qi + 1 >= z.questions.length;
  return { lobby: T('start'), q: T('reveal'), r: last ? T('last') : T('next'),
    end: z.kind === 'poll' || z.rv >= 4 ? T('ph_end') : z.rv === 3 ? T('full') : T('podium') }[z.phase];
};
function paintLive() {
  MS.forEach(m => {
    const c = document.querySelector(`[data-mid="${m.id}"] .live`);
    if (c) c.innerHTML = `<p style="margin:0">${T('live')}: ${Math.max(0, ...m.people.map(p => p.n))} ${T('votes')}</p>${evalBoard(m)}`;
  });
  L.forEach(d => { const c = document.querySelector(`[data-id="${d.id}"] .live`); if (c) c.innerHTML = `<p style="margin:0">${T('live')}: ${d.a.n} ${T('votes')}</p>${debateBoard(d)}`; });
  Q.forEach(z => {
    const c = document.querySelector(`[data-qid="${z.id}"]`); if (!c) return;
    const btn = c.querySelector('[data-a=go]');
    c.querySelector('.qp').textContent = T('ph_' + z.phase);
    btn.textContent = quizLabel(z); btn.disabled = z.phase === 'end' && (z.kind === 'poll' || z.rv >= 4);
    let h = `<p style="margin:10px 0 0">${z.players.length} ${T('plr')}${z.phase === 'lobby' ? '' : `, ${T('qn')} ${z.qi + 1}/${z.questions.length}`}</p>`;
    if (z.kind === 'poll' && z.phase === 'end') h += `<div style="margin-top:12px">${pollChart(pollFrom(z))}</div>`;
    else if (z.kind === 'poll' && z.phase !== 'lobby') {
      const q = z.questions[Math.min(z.qi, z.questions.length - 1)];
      h += q.o.map((o, i) => `<div class="rk"><div><b>${E(o)}</b></div><em>${z.players.filter(p => p.ans.some(a => a.qi === z.qi && a.ch === i)).length}</em></div>`).join('');
    } else if (z.kind === 'quiz') h += rankList(z.players.slice(0, 10), z.opts.real);
    c.querySelector('.live').innerHTML = h;
  });
}
/* ----- Teacher accounts (owner manages them; every account can change its own passcode) ----- */
const ownerOptions = () => {
  const m = new Map();
  [...L, ...Q, ...FI, ...MS].forEach(x => { if (x.owner_id) m.set(x.owner_id, x.owner); });
  TS.forEach(t => m.set(t.id, t.name));
  return [...m];
};
const filterBar = () => {
  if (!ME.admin || ME.legacy) return '';
  const opts = ownerOptions();
  if (!opts.length) return '';
  return `<select id="of" aria-label="${T('allT')}"><option value="all">${T('allT')}</option><option value="mine" ${ofilter === 'mine' ? 'selected' : ''}>${T('mine')}</option>` +
    opts.map(([id, n]) => `<option value="${id}" ${ofilter === id ? 'selected' : ''}>${E(n)}</option>`).join('') + '</select>';
};
const accountCard = () => `<div class="card"><h2>${T('myAcc')}</h2><p>${ME.admin ? T('ownerRole') : E(ME.name)}</p>
  <input id="mp" type="text" autocomplete="off" placeholder="${T('newPass')}"><button class="btn" id="chgp">${T('chgP')}</button></div>`;
const teacherCard = t => `<div class="card" data-tid="${t.id}"><div class="row"><h2>${E(t.name)}</h2><span class="tag ${t.active ? 'on' : ''}">${t.active ? T('active') : T('disabled')}</span></div>
  <p>${E(t.username)}: ${t.debates} ${T('tDeb')}, ${t.quizzes} ${T('tQuiz')}, ${t.forms} ${T('tForm')}</p>
  <input type="text" class="np" autocomplete="off" placeholder="${T('newPass')}">
  <div class="row"><button class="btn s" data-a="tReset">${T('resetP')}</button><button class="btn o s" data-a="tTog">${t.active ? T('disable') : T('enable')}</button><button class="btn o s" data-a="tDel">${T('delT')}</button></div></div>`;
const teachersPanel = () => ME.admin
  ? `<div class="card"><h2>${T('newT')}</h2><input id="tn" type="text" placeholder="${T('tname')}"><input id="tu" type="text" autocapitalize="none" spellcheck="false" placeholder="${T('tuser')}">
      <input id="tp" type="text" autocomplete="off" placeholder="${T('tpass')}"><button class="btn" id="mkt">${T('mkT')}</button></div>` + TS.map(teacherCard).join('') + accountCard()
  : accountCard();

function vDash() {
  if (tab === 't' && !tabsFor().some(([k]) => k === 't')) tab = 'a';
  if (!['all', 'mine'].includes(ofilter) && !ownerOptions().some(([id]) => id === ofilter)) ofilter = 'all';
  const list = tab === 'a' ? [...L.filter(visible).map(debateCard), ...MS.filter(visible).map(evalCard)]
    : tab === 'q' || tab === 'p' ? Q.filter(z => visible(z) && z.kind === (tab === 'q' ? 'quiz' : 'poll')).map(quizCard)
    : FI.filter(f => visible(f) && f.kind === (tab === 'f' ? 'feedback' : 'copy')).map(formCard);
  const body = tab === 't' ? teachersPanel() : filterBar() + forms[tab]() + list.join('');
  const who = ME.legacy ? '' : `<span class="tag">${T('signedAs')} ${E(ME.admin ? T('ownerRole') : ME.name)}</span>`;
  app.innerHTML = `<div class="tabs">${tabsFor().map(([k, label]) => `<button class="btn ${tab === k ? '' : 'o'}" data-tab="${k}">${T(label)}</button>`).join('')}</div>${body}
    <div class="row"><button class="btn o s" data-a="xlAll">${T('all')} (${T('xl')})</button><button class="btn o s" data-a="wdAll">${T('all')} (${T('wd')})</button>${who}<button class="btn o s" data-a="out">${T('out')}</button></div>`;
  paintLive();
  every(async () => { if (document.hidden) return; try { await load(); paintLive(); } catch {} }, 3000);
  app.oninput = onTeacherInput;
  app.onclick = onTeacherClick;
}

// Keep the teacher's allowed maximum in step with total mark and weight; never let a mark exceed it.
function onTeacherInput(e) {
  const t = e.target, c = t.closest('.card');
  if (t.id === 'of') { ofilter = t.value; return vDash(); }
  if (t.id === 'w') $('#wv').textContent = t.value;
  if (!c || !(c.dataset.id || c.dataset.mid)) return;
  if (t.classList.contains('w') || t.classList.contains('tm')) {
    const w = +c.querySelector('.w').value, tm = c.dataset.mid ? +c.dataset.total : +c.querySelector('.tm').value || 0, mx = teacherMax(tm, w);
    c.querySelector('.wv').textContent = w; c.querySelector('.sv').textContent = 100 - w; c.querySelector('.mx').textContent = mx;
    c.querySelectorAll('.ta,.tb,.tt').forEach(i => { i.max = mx; if (i.classList.contains('tt') && +i.value > mx) i.value = mx; });
  }
  if (t.classList.contains('ta') || t.classList.contains('tb') || t.classList.contains('tt')) {
    const mx = +t.max;
    if (+t.value > mx) { t.value = mx; toast(`${T('over')} ${mx}`); }
    if (+t.value < 0) t.value = 0;
  }
}
const sameDebate = (d, extra = {}) => ({ p: P, t: d.title, ga: d.group_a, gb: d.group_b, rub: d.rubric, ma: d.members_a, mb: d.members_b, tm: d.total_mark, w: d.w_teacher, ...extra });

const actions = {
  out: () => { sessionStorage.vp = P = ''; ofilter = 'all'; H.length = 0; H.push(vTeacher); draw(); },
  qr: ({ item }) => showQR(item.title, item.code),
  link: ({ item }) => copyText(screenLink(item.code)).then(() => toast(T('copied'))),
  xlAll: () => exportData('x', { ds: L.filter(visible), qs: Q.filter(visible), fs: FI.filter(visible), ms: MS.filter(visible) }),
  wdAll: () => exportData('w', { ds: L.filter(visible), qs: Q.filter(visible), fs: FI.filter(visible), ms: MS.filter(visible) }),
  // teacher accounts (owner only)
  tReset: async ({ item, card }) => {
    const np = card.querySelector('.np').value;
    if (np.length < 6) return toast(T('badP'));
    await rpc('vt_update', { p: P, i: item.id, patch: { pw: np } });
    card.querySelector('.np').value = ''; toast(T('passSaved'));
  },
  tTog: async ({ item }) => { await rpc('vt_update', { p: P, i: item.id, patch: { active: !item.active } }); await reload(); },
  tDel: async ({ item }) => {
    if (!confirm(T('delTConf'))) return;
    await rpc('vt_delete', { p: P, i: item.id }); await reload();
  },
  // debates and member/presenter evaluations
  tg: async ({ item, kind }) => { await rpc(kind === 'm' ? 'vm_update' : 'vd_update', { p: P, i: item.id, patch: { status: item.status === 'open' ? 'closed' : 'open' } }); await reload(); },
  rel: async ({ item, kind }) => { await rpc(kind === 'm' ? 'vm_update' : 'vd_update', { p: P, i: item.id, patch: { released: !item.released } }); await reload(); },
  saveM: async ({ item, card }) => {
    const t = [...card.querySelectorAll('.tt')].map(i => i.value === '' ? null : +i.value);
    await rpc('vm_update', { p: P, i: item.id, patch: { t, w: +card.querySelector('.w').value } });
    await reload();
  },
  save: async ({ item, card }) => {
    const v = s => card.querySelector(s).value;
    await rpc('vd_update', { p: P, i: item.id, patch: { ta: v('.ta') === '' ? null : +v('.ta'), tb: v('.tb') === '' ? null : +v('.tb'), w: +v('.w'), tm: +v('.tm'), ma: v('.ma'), mb: v('.mb') } });
    await reload();
  },
  // quizzes and polls
  go: async ({ item }) => {
    const act = { lobby: 'start', q: 'reveal', r: 'next', end: item.rv < 4 && item.kind === 'quiz' ? 'podium' : null }[item.phase];
    if (!act) return;
    await rpc('vq_ctl', { p: P, i: item.id, act }); await load(); paintLive();
  },
  end: async ({ item }) => { await rpc('vq_ctl', { p: P, i: item.id, act: 'end' }); await load(); paintLive(); },
  // feedback forms
  tgf: async ({ item }) => { await rpc('vf_update', { p: P, i: item.id, o: !item.open }); await reload(); },
  // shared
  again: async ({ item, kind }) => {
    if (kind === 'd') await rpc('vd_create', sameDebate(item));
    else if (kind === 'm') await rpc('vm_create', { p: P, t: item.title, style: item.style, groups: groupsOf(item), tm: item.total_mark, w: item.w_teacher });
    else if (kind === 'q') await rpc('vq_create', { p: P, t: item.title, qs: item.questions, k: item.kind, o: item.opts });
    else await rpc('vf_create', { p: P, k: item.kind, t: item.title, b: item.body });
    await reload();
  },
  del: async ({ item, kind }) => {
    if (!confirm(T('conf'))) return;
    await rpc(kind === 'd' ? 'vd_delete' : kind === 'm' ? 'vm_delete' : kind === 'q' ? 'vq_delete' : 'vf_delete', { p: P, i: item.id });
    await reload();
  },
  xl: ({ item, kind }) => exportData('x', kind === 'd' ? { ds: [item] } : kind === 'm' ? { ms: [item] } : kind === 'q' ? { qs: [item] } : { fs: [item] }),
  wd: ({ item, kind }) => exportData('w', kind === 'd' ? { ds: [item] } : kind === 'm' ? { ms: [item] } : kind === 'q' ? { qs: [item] } : { fs: [item] })
};
const creators = {
  mk: async () => {
    const rub = $('#r').value.split('\n').map(l => l.split(',')).filter(a => a[0].trim() && +a[1] > 0).map(a => ({ name: a[0].trim(), max: +a[1] }));
    if (!$('#t').value.trim() || !$('#ga').value.trim() || !$('#gb').value.trim() || !rub.length || !(+$('#tm').value > 0)) return toast(T('bad'));
    await rpc('vd_create', { p: P, t: $('#t').value.trim(), ga: $('#ga').value.trim(), gb: $('#gb').value.trim(), rub, ma: $('#ma').value, mb: $('#mb').value, tm: +$('#tm').value, w: +$('#w').value });
    await reload();
  },
  mkq: async () => {
    const qs = parseQuestions($('#qq').value, +$('#secs').value || 20, true), real = +$('#real').value;
    if (!$('#t').value.trim() || !qs.length) return toast(T('badQ'));
    await rpc('vq_create', { p: P, t: $('#t').value.trim(), qs, k: 'quiz', o: { change: $('#chg').checked, ...(real > 0 ? { real } : {}) } });
    await reload();
  },
  mkp: async () => {
    const qs = parseQuestions($('#qq').value, +$('#secs').value || 30, false);
    if (!$('#t').value.trim() || !qs.length) return toast(T('badQ'));
    await rpc('vq_create', { p: P, t: $('#t').value.trim(), qs, k: 'poll', o: {} });
    await reload();
  },
  mkf: async () => {
    if (!$('#t').value.trim() || !$('#b').value.trim()) return toast(T('badF'));
    await rpc('vf_create', { p: P, k: 'feedback', t: $('#t').value, b: $('#b').value }); await reload();
  },
  mks: async () => {
    if (!$('#t').value.trim() || !$('#b').value.trim()) return toast(T('badF'));
    await rpc('vf_create', { p: P, k: 'copy', t: $('#t').value, b: $('#b').value }); await reload();
  },
  // "Group name: member, member, member", one group per line. Every group must list its members.
  mkm: async () => {
    const groups = $('#gm').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const i = l.indexOf(':');
      return { name: i < 0 ? '' : l.slice(0, i).trim(), members: (i < 0 ? '' : l.slice(i + 1)).split(',').map(s => s.trim()).filter(Boolean) };
    });
    if (!$('#t').value.trim() || !groups.length || groups.some(g => !g.name || !g.members.length) || !(+$('#tm').value > 0)) return toast(T('badM'));
    await rpc('vm_create', { p: P, t: $('#t').value.trim(), style: 'members', groups, tm: +$('#tm').value, w: +$('#w').value });
    await reload();
  },
  mkpr: async () => {
    const name = $('#pn').value.trim();
    if (!$('#t').value.trim() || !name || !(+$('#tm').value > 0)) return toast(T('badM'));
    await rpc('vm_create', { p: P, t: $('#t').value.trim(), style: 'person', groups: [{ name: '', members: [name] }], tm: +$('#tm').value, w: +$('#w').value });
    await reload();
  },
  mkt: async () => {
    const nm = $('#tn').value.trim(), un = $('#tu').value.trim().toLowerCase(), pw = $('#tp').value;
    if (!nm || !/^[a-z0-9._-]{3,30}$/.test(un) || pw.length < 6) return toast(T('badT'));
    await rpc('vt_create', { p: P, nm, un, pw }); toast(T('accMade')); await reload();
  },
  chgp: async () => {
    const np = $('#mp').value;
    if (np.length < 6) return toast(T('badP'));
    await rpc('vt_passcode', { p: P, np });
    P = P.includes(SEP) ? P.slice(0, P.indexOf(SEP) + 1) + np : np;   // keep this session signed in with the new passcode
    sessionStorage.vp = P; $('#mp').value = ''; toast(T('passSaved'));
  }
};
async function onTeacherClick(e) {
  const t = e.target;
  try {
    if (t.dataset.tab) {
      if (t.dataset.tab !== tab) { const k = t.dataset.tab; if (k === 't' && ME.admin) TS = await rpc('vt_list', { p: P }); nav(() => { tab = k; vDash(); }); }
      return;
    }
    if (t.dataset.sty) { astyle = t.dataset.sty; return vDash(); }
    if (creators[t.id]) return await creators[t.id]();
    const a = t.dataset.a; if (!a) return;
    const card = t.closest('.card'), ctx = { card };
    if (card && card.dataset.id) { ctx.kind = 'd'; ctx.item = L.find(x => x.id === card.dataset.id); }
    else if (card && card.dataset.qid) { ctx.kind = 'q'; ctx.item = Q.find(x => x.id === card.dataset.qid); }
    else if (card && card.dataset.fid) { ctx.kind = 'f'; ctx.item = FI.find(x => x.id === card.dataset.fid); }
    else if (card && card.dataset.mid) { ctx.kind = 'm'; ctx.item = MS.find(x => x.id === card.dataset.mid); }
    else if (card && card.dataset.tid) { ctx.kind = 't'; ctx.item = TS.find(x => x.id === card.dataset.tid); }
    await actions[a](ctx);
  } catch (er) { toast(er.message); }
}

/* ================= Start ================= */
applyLang();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
addEventListener('hashchange', () => location.reload());
if (location.hash.startsWith('#screen=')) { C = location.hash.slice(8); H.push(vScreen); }
else if (location.hash === '#teacher') H.push(vTeacher);
else H.push(vJoin);
draw();
