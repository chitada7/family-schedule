import { createClient, SupabaseClient } from '@supabase/supabase-js';

/* ───────── 사람 · 종류 ───────── */
export type PersonKey = 'grandma' | 'mom' | 'dad' | 'taemin' | 'ina' | 'family';

export const PEOPLE: { key: PersonKey; label: string; color: string; soft: string }[] = [
  { key: 'grandma', label: '할머니', color: '#E58A0C', soft: '#FFF3DC' },
  { key: 'mom', label: '엄마', color: '#E2468F', soft: '#FDE7F1' },
  { key: 'dad', label: '아빠', color: '#1E88D6', soft: '#E1F1FC' },
  { key: 'taemin', label: '태민', color: '#13A06F', soft: '#DEF5EB' },
  { key: 'ina', label: '이나', color: '#8456E8', soft: '#EEE7FD' },
  { key: 'family', label: '가족', color: '#E5484D', soft: '#FDE6E7' },
];
export const person = (k: string) => PEOPLE.find((p) => p.key === k) ?? PEOPLE[5];

/** 앱을 쓰는 사람 (입력자) */
export const USERS: { key: PersonKey; label: string }[] = [
  { key: 'mom', label: '엄마' },
  { key: 'dad', label: '아빠' },
  { key: 'grandma', label: '할머니' },
];

export const KINDS = ['휴가', '근무', '학원', '병원', '약속', '행사', '기타'] as const;

/* ───────── 일정 ───────── */
export interface Ev {
  id: string;
  title: string;
  person: PersonKey;
  kind: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  all_day: boolean;
  start_time: string | null; // HH:MM(:SS)
  end_time: string | null;
  repeat_days: number[] | null; // 0=일 … 6=토
  repeat_until: string | null;
  skip_dates: string[];
  memo: string | null;
  important: boolean;
  created_by: string | null;
  updated_at?: string;
}
export type EvInput = Omit<Ev, 'id' | 'updated_at'>;

/* ───────── 날짜 도구 (모두 현지 날짜 문자열) ───────── */
const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const today = () => ymd(new Date());
export const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export const dow = (s: string) => parse(s).getDay();
export const fmtDay = (s: string) => {
  const d = parse(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
};
export const hm = (t: string | null) => (t ? t.slice(0, 5) : '');
export const timeLabel = (e: Ev) => {
  if (e.all_day) return '하루종일';
  const s = hm(e.start_time);
  const en = hm(e.end_time);
  return en ? `${s} ~ ${en}` : s;
};

/** 기간 [from, to] 안에서 일정이 실제로 있는 날짜들 */
export function occurrences(e: Ev, from: string, to: string): string[] {
  const out: string[] = [];
  if (e.repeat_days && e.repeat_days.length) {
    let d = e.start_date > from ? e.start_date : from;
    const end = e.repeat_until && e.repeat_until < to ? e.repeat_until : to;
    let guard = 0;
    while (d <= end && guard++ < 800) {
      if (e.repeat_days.includes(dow(d)) && !e.skip_dates.includes(d)) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }
  let d = e.start_date > from ? e.start_date : from;
  const end = e.end_date < to ? e.end_date : to;
  let guard = 0;
  while (d <= end && guard++ < 800) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/** 휴가 → 근무(야간·출장 등) → 중요 → 나머지 순서 */
export const rank = (e: Ev) => (e.kind === '휴가' ? 0 : e.kind === '근무' ? 1 : e.important ? 2 : 3);
export function sortEvs(a: Ev, b: Ev) {
  const r = rank(a) - rank(b);
  if (r) return r;
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
  const t = (a.start_time ?? '').localeCompare(b.start_time ?? '');
  if (t) return t;
  return PEOPLE.findIndex((p) => p.key === a.person) - PEOPLE.findIndex((p) => p.key === b.person);
}

export function repeatLabel(e: Ev) {
  if (!e.repeat_days?.length) return '';
  const days = [...e.repeat_days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEK[d]).join('·');
  return `매주 ${days}${e.repeat_until ? ` (~${parse(e.repeat_until).getMonth() + 1}/${parse(e.repeat_until).getDate()})` : ''}`;
}

/* ───────── 저장소 ───────── */
const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY_ = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const DEMO = new URLSearchParams(location.search).has('demo') || !URL_ || !KEY_;
export const sb: SupabaseClient | null = DEMO ? null : createClient(URL_!, KEY_!);

let demoRows: Ev[] = [];
let demoSeq = 1;
const demoListeners = new Set<() => void>();
export function seedDemo() {
  const t = today();
  const mk = (p: Partial<Ev>): Ev => ({
    id: String(demoSeq++), title: '', person: 'family', kind: '기타', start_date: t, end_date: t,
    all_day: true, start_time: null, end_time: null, repeat_days: null, repeat_until: null,
    skip_dates: [], memo: null, important: false, created_by: 'mom', ...p,
  });
  demoRows = [
    mk({ title: '수학학원', person: 'taemin', kind: '학원', all_day: false, start_time: '15:30', end_time: '17:00', repeat_days: [1, 3, 5], start_date: addDays(t, -20) }),
    mk({ title: '미술학원', person: 'ina', kind: '학원', all_day: false, start_time: '14:00', end_time: '15:00', repeat_days: [2, 4], start_date: addDays(t, -20) }),
    mk({ title: '여름휴가', person: 'dad', kind: '휴가', start_date: addDays(t, 6), end_date: addDays(t, 8), created_by: 'dad' }),
    mk({ title: '야간근무', person: 'mom', kind: '근무', all_day: false, start_time: '18:00', end_time: '22:00', start_date: addDays(t, 1), end_date: addDays(t, 1) }),
    mk({ title: '정형외과', person: 'grandma', kind: '병원', all_day: false, start_time: '10:30', start_date: t, end_date: t, created_by: 'grandma', memo: '진료카드 챙기기' }),
    mk({ title: '할아버지 제사', person: 'family', kind: '행사', important: true, start_date: addDays(t, 12), end_date: addDays(t, 12) }),
    mk({ title: '태민 학부모 상담', person: 'taemin', kind: '약속', important: true, all_day: false, start_time: '16:00', start_date: addDays(t, 7), end_date: addDays(t, 7) }),
  ];
}

export const api = {
  async list(): Promise<Ev[]> {
    if (DEMO) return demoRows.map((r) => ({ ...r }));
    const { data, error } = await sb!.from('fam_events').select('*').order('start_date');
    if (error) throw error;
    return (data as Ev[]).map((r) => ({ ...r, skip_dates: r.skip_dates ?? [], important: !!r.important }));
  },
  async add(v: EvInput) {
    if (DEMO) { demoRows.push({ ...v, id: String(demoSeq++) }); demoListeners.forEach((f) => f()); return; }
    const { error } = await sb!.from('fam_events').insert(v);
    if (error) throw error;
  },
  async update(id: string, v: Partial<EvInput>) {
    if (DEMO) { demoRows = demoRows.map((r) => (r.id === id ? { ...r, ...v } : r)); demoListeners.forEach((f) => f()); return; }
    const { error } = await sb!.from('fam_events').update({ ...v, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  },
  async remove(id: string) {
    if (DEMO) { demoRows = demoRows.filter((r) => r.id !== id); demoListeners.forEach((f) => f()); return; }
    const { error } = await sb!.from('fam_events').delete().eq('id', id);
    if (error) throw error;
  },
  subscribe(cb: () => void) {
    if (DEMO) { demoListeners.add(cb); return () => { demoListeners.delete(cb); }; }
    const ch = sb!.channel('fam_events').on('postgres_changes', { event: '*', schema: 'public', table: 'fam_events' }, cb).subscribe();
    return () => { sb!.removeChannel(ch); };
  },
};

/* ───────── 기기 설정 ───────── */
export const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};
