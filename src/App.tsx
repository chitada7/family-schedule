import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api, addDays, DEMO, dow, Ev, EvInput, fmtDay, KINDS, occurrences, parse, PEOPLE, person, PersonKey,
  repeatLabel, sb, seedDemo, sortEvs, store, timeLabel, today, USERS, WEEK, ymd,
} from './lib';

/* ═════════ 최상위: 로그인 → 가족 확인 → 누구세요? → 본 화면 ═════════ */
export default function App() {
  const [phase, setPhase] = useState<'loading' | 'login' | 'noaccess' | 'ready'>('loading');
  const [email, setEmail] = useState('');
  const [me, setMe] = useState<PersonKey | null>((store.get('fam_me') as PersonKey) || null);
  const [big, setBig] = useState(store.get('fam_big') === '1');

  useEffect(() => { document.documentElement.classList.toggle('big', big); }, [big]);

  const check = useCallback(async () => {
    if (DEMO) { seedDemo(); setPhase('ready'); return; }
    const { data } = await sb!.auth.getSession();
    const s = data.session;
    if (!s) { setPhase('login'); return; }
    setEmail(s.user.email ?? '');
    const { data: acc } = await sb!.from('fam_access').select('*').eq('user_id', s.user.id).maybeSingle();
    // 계정마다 사람이 정해져 있으면 '누구세요?'를 건너뛰어요
    if (acc?.who) { store.set('fam_me', acc.who); setMe(acc.who as PersonKey); }
    setPhase(acc ? 'ready' : 'noaccess');
  }, []);

  useEffect(() => {
    check();
    if (DEMO) return;
    const { data } = sb!.auth.onAuthStateChange(() => { check(); });
    return () => data.subscription.unsubscribe();
  }, [check]);

  if (phase === 'loading') return <div className="center muted">불러오는 중…</div>;
  if (phase === 'login') return <Login />;
  if (phase === 'noaccess') return <NoAccess email={email} onRetry={check} />;
  if (!me) return <WhoPicker onPick={(k) => { store.set('fam_me', k); setMe(k); }} />;
  return (
    <Main
      me={me}
      big={big}
      onBig={(v) => { store.set('fam_big', v ? '1' : '0'); setBig(v); }}
      onSwitch={() => { store.del('fam_me'); setMe(null); }}
    />
  );
}

/* ═════════ 로그인 ═════════ */
function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setMsg('');
    const r = mode === 'in'
      ? await sb!.auth.signInWithPassword({ email, password: pw })
      : await sb!.auth.signUp({ email, password: pw });
    setBusy(false);
    if (r.error) setMsg(mode === 'in' ? '이메일이나 비밀번호를 다시 확인해 주세요.' : r.error.message);
    else if (mode === 'up' && !r.data.session) setMsg('메일함에서 인증 링크를 누른 뒤 로그인해 주세요.');
  };
  return (
    <div className="auth">
      <div className="logo">🏠</div>
      <h1>우리집 일정</h1>
      <p className="muted">할머니 · 엄마 · 아빠가 함께 보는 가족 달력</p>
      <input type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      <input type="password" placeholder="비밀번호 (6자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      <button className="primary" disabled={busy || !email || pw.length < 6} onClick={submit}>{mode === 'in' ? '로그인' : '가입하기'}</button>
      {msg && <p className="err">{msg}</p>}
      <button className="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(''); }}>
        {mode === 'in' ? '처음이에요 (가입하기)' : '이미 계정이 있어요 (로그인)'}
      </button>
    </div>
  );
}

function NoAccess({ email, onRetry }: { email: string; onRetry: () => void }) {
  return (
    <div className="auth">
      <div className="logo">🔒</div>
      <h1>가족 등록이 필요해요</h1>
      <p className="muted"><b>{email}</b> 계정은 아직 가족으로 등록되지 않았어요. 진아에게 이 이메일을 알려주세요.</p>
      <button className="primary" onClick={onRetry}>다시 확인</button>
      <button className="link" onClick={() => sb!.auth.signOut()}>다른 계정으로 로그인</button>
    </div>
  );
}

function WhoPicker({ onPick }: { onPick: (k: PersonKey) => void }) {
  return (
    <div className="auth">
      <h1>누구세요?</h1>
      <p className="muted">이 휴대폰을 쓰는 사람을 골라주세요. 한 번만 고르면 돼요.</p>
      <div className="who">
        {USERS.map((u) => {
          const p = person(u.key);
          return (
            <button key={u.key} style={{ background: p.soft, color: p.color, borderColor: p.color }} onClick={() => onPick(u.key)}>
              {u.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ═════════ 본 화면 ═════════ */
type Sheet = null | { mode: 'new'; date: string } | { mode: 'edit'; ev: Ev; date: string } | { mode: 'settings' };

function Main({ me, big, onBig, onSwitch }: { me: PersonKey; big: boolean; onBig: (v: boolean) => void; onSwitch: () => void }) {
  const [evs, setEvs] = useState<Ev[]>([]);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'month' | 'list'>((store.get('fam_tab') as 'month' | 'list') || 'month');
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState(today());
  const [filter, setFilter] = useState<PersonKey[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    try { setEvs(await api.list()); setErr(''); } catch { setErr('일정을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  }, []);
  useEffect(() => {
    load();
    const off = api.subscribe(load);
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => { off(); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 1800); };
  const shown = useMemo(() => (filter.length ? evs.filter((e) => filter.includes(e.person)) : evs), [evs, filter]);

  /** from~to 사이 날짜별 일정 */
  const byDate = useCallback((from: string, to: string) => {
    const m = new Map<string, Ev[]>();
    for (const e of shown) for (const d of occurrences(e, from, to)) { if (!m.has(d)) m.set(d, []); m.get(d)!.push(e); }
    m.forEach((l) => l.sort(sortEvs));
    return m;
  }, [shown]);

  const toggle = (k: PersonKey) => setFilter((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]));
  const setTabSave = (t: 'month' | 'list') => { store.set('fam_tab', t); setTab(t); };
  const meLabel = USERS.find((u) => u.key === me)?.label;

  return (
    <div className="app">
      <header>
        <div className="seg">
          <button className={tab === 'month' ? 'on' : ''} onClick={() => setTabSave('month')}>달력</button>
          <button className={tab === 'list' ? 'on' : ''} onClick={() => setTabSave('list')}>다가오는 일정</button>
        </div>
        <button className="me" onClick={() => setSheet({ mode: 'settings' })} style={{ color: person(me).color, background: person(me).soft }}>
          {meLabel} ⚙︎
        </button>
      </header>

      <div className="chips">
        <button className={`chip ${filter.length === 0 ? 'on all' : ''}`} onClick={() => setFilter([])}>전체</button>
        {PEOPLE.map((p) => {
          const on = filter.includes(p.key);
          return (
            <button key={p.key} className="chip" onClick={() => toggle(p.key)}
              style={on ? { background: p.color, color: '#fff', borderColor: p.color } : { color: p.color, borderColor: p.soft, background: '#fff' }}>
              <i style={{ background: on ? '#fff' : p.color }} />{p.label}
            </button>
          );
        })}
      </div>

      {err && <div className="banner">{err}</div>}
      {DEMO && <div className="banner demo">미리보기 화면이에요. 저장해도 실제로 공유되지 않아요.</div>}

      {tab === 'month'
        ? <MonthView month={month} setMonth={setMonth} sel={sel} setSel={setSel} byDate={byDate}
            onOpen={(ev, date) => setSheet({ mode: 'edit', ev, date })} />
        : <ListView byDate={byDate} onOpen={(ev, date) => setSheet({ mode: 'edit', ev, date })} />}

      <button className="fab" onClick={() => setSheet({ mode: 'new', date: tab === 'month' ? sel : today() })} aria-label="일정 추가">＋</button>

      {sheet?.mode === 'new' && (
        <EventSheet me={me} date={sheet.date} onClose={() => setSheet(null)}
          onSave={async (v) => { await api.add(v); setSheet(null); flash('저장했어요'); if (DEMO) load(); }} />
      )}
      {sheet?.mode === 'edit' && (
        <EventSheet me={me} date={sheet.date} ev={sheet.ev} onClose={() => setSheet(null)}
          onSave={async (v) => { await api.update(sheet.ev.id, v); setSheet(null); flash('고쳤어요'); if (DEMO) load(); }}
          onDelete={async () => { await api.remove(sheet.ev.id); setSheet(null); flash('지웠어요'); if (DEMO) load(); }}
          onSkip={async () => {
            await api.update(sheet.ev.id, { skip_dates: [...sheet.ev.skip_dates, sheet.date] });
            setSheet(null); flash(`${fmtDay(sheet.date)}만 뺐어요`); if (DEMO) load();
          }} />
      )}
      {sheet?.mode === 'settings' && (
        <Settings big={big} onBig={onBig} meLabel={meLabel ?? ''} onClose={() => setSheet(null)} onSwitch={onSwitch} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ═════════ 달력 ═════════ */
function MonthView({ month, setMonth, sel, setSel, byDate, onOpen }: {
  month: Date; setMonth: (d: Date) => void; sel: string; setSel: (s: string) => void;
  byDate: (a: string, b: string) => Map<string, Ev[]>; onOpen: (e: Ev, d: string) => void;
}) {
  const first = ymd(month);
  const gridStart = addDays(first, -month.getDay());
  const last = ymd(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const weeks = Math.ceil((month.getDay() + parse(last).getDate()) / 7);
  const gridEnd = addDays(gridStart, weeks * 7 - 1);
  const map = byDate(gridStart, gridEnd);
  const t = today();
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const move = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const goToday = () => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSel(t); };
  const list = map.get(sel) ?? [];
  const selInMonth = sel >= gridStart && sel <= gridEnd;

  return (
    <>
      <div className="mhead">
        <button onClick={() => move(-1)} aria-label="이전 달">‹</button>
        <h2>{month.getFullYear()}년 {month.getMonth() + 1}월</h2>
        <button onClick={() => move(1)} aria-label="다음 달">›</button>
        <button className="today" onClick={goToday}>오늘</button>
      </div>
      <div className="grid">
        {WEEK.map((w, i) => <div key={w} className={`wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>{w}</div>)}
        {days.map((d) => {
          const items = map.get(d) ?? [];
          const out = d.slice(0, 7) !== first.slice(0, 7);
          const wd = dow(d);
          return (
            <button key={d} className={`cell ${out ? 'out' : ''} ${d === sel ? 'sel' : ''}`} onClick={() => setSel(d)}>
              <span className={`num ${d === t ? 'today' : ''} ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}`}>{parse(d).getDate()}</span>
              {items.slice(0, 3).map((e) => {
                const p = person(e.person);
                const hot = e.kind === '휴가' || e.important;
                return <span key={e.id} className={`bar ${hot ? 'hot' : ''}`} style={hot ? { background: p.color, color: '#fff', borderLeftColor: p.color } : { background: p.soft, color: p.color, borderLeftColor: p.color }}>{e.important && e.kind !== '휴가' ? '★' : ''}{e.title}</span>;
              })}
              {items.length > 3 && <span className="more">+{items.length - 3}</span>}
            </button>
          );
        })}
      </div>
      {selInMonth && (
        <section className="day">
          <h3>{fmtDay(sel)}{sel === t && <em>오늘</em>}</h3>
          {list.length === 0 ? <p className="empty">일정이 없어요</p> : list.map((e) => <Card key={e.id} e={e} onClick={() => onOpen(e, sel)} />)}
        </section>
      )}
    </>
  );
}

/* ═════════ 다가오는 일정 (4주) ═════════ */
function ListView({ byDate, onOpen }: { byDate: (a: string, b: string) => Map<string, Ev[]>; onOpen: (e: Ev, d: string) => void }) {
  const t = today();
  const end = addDays(t, 27);
  const map = byDate(t, end);
  const dates = [...map.keys()].sort();
  return (
    <div className="list">
      {dates.length === 0 && <p className="empty">앞으로 4주 동안 일정이 없어요</p>}
      {dates.map((d) => (
        <section key={d} className="day">
          <h3>{fmtDay(d)}{d === t && <em>오늘</em>}{d === addDays(t, 1) && <em className="tmr">내일</em>}</h3>
          {map.get(d)!.map((e) => <Card key={e.id} e={e} onClick={() => onOpen(e, d)} />)}
        </section>
      ))}
    </div>
  );
}

function Card({ e, onClick }: { e: Ev; onClick: () => void }) {
  const p = person(e.person);
  const multi = !e.repeat_days?.length && e.end_date !== e.start_date;
  return (
    <button className={`card ${e.important || e.kind === '휴가' ? 'hot' : ''}`} onClick={onClick} style={{ borderLeftColor: p.color }}>
      <div className="row1">
        <span className="tag" style={{ background: p.color }}>{p.label}</span>
        <span className={`kind ${e.kind === '휴가' ? 'vac' : ''}`}>{e.kind}</span>
        {e.important && <span className="imp">★ 중요</span>}
        <span className="time">{timeLabel(e)}</span>
      </div>
      <div className="title">{e.title}</div>
      {(multi || e.repeat_days?.length || e.memo) && (
        <div className="sub">
          {multi && <span>{fmtDay(e.start_date)} ~ {fmtDay(e.end_date)}</span>}
          {e.repeat_days?.length ? <span>{repeatLabel(e)}</span> : null}
          {e.memo && <span>📝 {e.memo}</span>}
        </div>
      )}
    </button>
  );
}

/* ═════════ 일정 입력·수정 ═════════ */
function EventSheet({ me, date, ev, onClose, onSave, onDelete, onSkip }: {
  me: PersonKey; date: string; ev?: Ev; onClose: () => void;
  onSave: (v: EvInput) => Promise<void>; onDelete?: () => Promise<void>; onSkip?: () => Promise<void>;
}) {
  const [who, setWho] = useState<PersonKey>(ev?.person ?? me);
  const [title, setTitle] = useState(ev?.title ?? '');
  const [kind, setKind] = useState(ev?.kind ?? '기타');
  const [start, setStart] = useState(ev?.start_date ?? date);
  const [multi, setMulti] = useState(!!ev && !ev.repeat_days?.length && ev.end_date !== ev.start_date);
  const [end, setEnd] = useState(ev?.end_date ?? date);
  const [allDay, setAllDay] = useState(ev?.all_day ?? true);
  const [st, setSt] = useState(ev?.start_time?.slice(0, 5) ?? '09:00');
  const [et, setEt] = useState(ev?.end_time?.slice(0, 5) ?? '');
  const [rep, setRep] = useState<number[]>(ev?.repeat_days ?? []);
  const [repeat, setRepeat] = useState(!!ev?.repeat_days?.length);
  const [until, setUntil] = useState(ev?.repeat_until ?? '');
  const [memo, setMemo] = useState(ev?.memo ?? '');
  const [imp, setImp] = useState(ev?.important ?? false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  const isRepeat = !!ev?.repeat_days?.length;
  const quick: Record<string, string[]> = { 휴가: ['연차', '반차', '여행'], 근무: ['야간근무', '주말근무', '출장'], 학원: ['수학학원', '영어학원', '미술학원', '태권도'] };

  const save = async () => {
    if (!title.trim()) { setMsg('무슨 일정인지 적어주세요'); return; }
    if (repeat && rep.length === 0) { setMsg('반복할 요일을 골라주세요'); return; }
    if (multi && !repeat && end < start) { setMsg('끝나는 날이 시작하는 날보다 빨라요'); return; }
    setBusy(true);
    try {
      await onSave({
        title: title.trim(), person: who, kind,
        start_date: start, end_date: repeat ? start : multi ? end : start,
        all_day: allDay, start_time: allDay ? null : st || null, end_time: allDay ? null : et || null,
        repeat_days: repeat ? rep : null, repeat_until: repeat && until ? until : null,
        skip_dates: ev?.skip_dates ?? [], memo: memo.trim() || null, important: imp, created_by: ev?.created_by ?? me,
      });
    } catch { setMsg('저장하지 못했어요. 다시 눌러주세요.'); setBusy(false); }
  };

  return (
    <div className="dim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <button className="link" onClick={onClose}>닫기</button>
          <b>{ev ? '일정 고치기' : '일정 추가'}</b>
          <button className="link strong" disabled={busy} onClick={save}>저장</button>
        </div>
        <div className="sheet-b">
          <label>누구 일정이에요?</label>
          <div className="pick6">
            {PEOPLE.map((p) => (
              <button key={p.key} onClick={() => setWho(p.key)}
                style={who === p.key ? { background: p.color, color: '#fff', borderColor: p.color } : { color: p.color, borderColor: p.soft, background: p.soft }}>
                {p.label}
              </button>
            ))}
          </div>

          <label>종류</label>
          <div className="kinds">
            {KINDS.map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k}</button>)}
          </div>

          <label>무슨 일정이에요?</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 연차, 수학학원, 병원" />
          {quick[kind] && !title && (
            <div className="quick">{quick[kind].map((q) => <button key={q} onClick={() => setTitle(q)}>{q}</button>)}</div>
          )}

          <label>날짜</label>
          <div className="dates">
            <input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} />
            {multi && !repeat && <><span>~</span><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></>}
          </div>
          <div className="toggles">
            {!repeat && <Toggle on={multi} set={setMulti} label="여러 날 (휴가·여행)" />}
            <Toggle on={allDay} set={setAllDay} label="하루종일" />
          </div>
          {!allDay && (
            <div className="dates">
              <input type="time" value={st} onChange={(e) => setSt(e.target.value)} />
              <span>~</span>
              <input type="time" value={et} onChange={(e) => setEt(e.target.value)} />
            </div>
          )}

          <div className="toggles">
            <Toggle on={repeat} set={(v) => { setRepeat(v); if (v) { setMulti(false); if (!rep.length) setRep([dow(start)]); } }} label="매주 반복 (학원 등)" />
          </div>
          {repeat && (
            <>
              <div className="wdays">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <button key={d} className={rep.includes(d) ? 'on' : ''} onClick={() => setRep((r) => (r.includes(d) ? r.filter((x) => x !== d) : [...r, d]))}>{WEEK[d]}</button>
                ))}
              </div>
              <div className="dates">
                <span className="lbl">언제까지</span>
                <input type="date" value={until} min={start} onChange={(e) => setUntil(e.target.value)} />
                {until && <button className="link" onClick={() => setUntil('')}>계속</button>}
              </div>
              {!until && <p className="hint">끝나는 날을 비워두면 계속 반복돼요. 위 날짜부터 시작해요.</p>}
            </>
          )}

          <div className="toggles"><Toggle on={imp} set={setImp} label="★ 중요 (목록 맨 위에 표시)" /></div>

          <label>메모</label>
          <textarea rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="준비물, 장소, 데리러 갈 사람 등" />

          {msg && <p className="err">{msg}</p>}
          <button className="primary" disabled={busy} onClick={save}>{busy ? '저장 중…' : '저장'}</button>

          {ev && (
            <div className="danger">
              {isRepeat && onSkip && (
                <button onClick={async () => { setBusy(true); await onSkip(); }}>{fmtDay(date)}만 빼기 (휴강·결석)</button>
              )}
              {!confirmDel
                ? <button onClick={() => setConfirmDel(true)}>{isRepeat ? '반복 일정 전체 지우기' : '이 일정 지우기'}</button>
                : <button className="really" onClick={async () => { setBusy(true); await onDelete!(); }}>정말 지울게요</button>}
            </div>
          )}
          {ev?.created_by && <p className="hint center-t">{USERS.find((u) => u.key === ev.created_by)?.label ?? ''}가 입력한 일정</p>}
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, set, label }: { on: boolean; set: (v: boolean) => void; label: string }) {
  return (
    <button className={`tg ${on ? 'on' : ''}`} onClick={() => set(!on)}>
      <span className="sw"><span /></span>{label}
    </button>
  );
}

/* ═════════ 설정 ═════════ */
function Settings({ big, onBig, meLabel, onClose, onSwitch }: { big: boolean; onBig: (v: boolean) => void; meLabel: string; onClose: () => void; onSwitch: () => void }) {
  return (
    <div className="dim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h"><span /><b>설정</b><button className="link strong" onClick={onClose}>닫기</button></div>
        <div className="sheet-b">
          <div className="toggles"><Toggle on={big} set={onBig} label="큰 글씨" /></div>
          <button className="line" onClick={onSwitch}>사용하는 사람 바꾸기 (지금: {meLabel})</button>
          {!DEMO && <button className="line" onClick={() => sb!.auth.signOut()}>로그아웃</button>}
          <p className="hint">홈 화면에 추가하면 앱처럼 쓸 수 있어요. 아이폰은 Safari 공유 버튼 → 홈 화면에 추가, 갤럭시는 Chrome ⋮ → 홈 화면에 추가.</p>
        </div>
      </div>
    </div>
  );
}
