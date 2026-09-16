#!/usr/bin/env node
/**
 * seo-check · 한 페이지의 기본 SEO 신호를 터미널에서 바로 확인한다.
 * 의존성 없음 · Node 18 이상
 *
 *   node seo-check.mjs https://example.com
 *   node seo-check.mjs https://example.com --json
 *
 * 검사 항목: title(한글 폭 기준 길이) · meta description · canonical(리디렉션 여부까지 실제 요청)
 *           h1 개수 · OG 태그 · robots meta · lang · viewport · JSON-LD · robots.txt 의 Googlebot/Yeti 허용
 */

const UA = 'Mozilla/5.0 (compatible; seo-check/1.0; +https://github.com/tryoreum/seo-check)';
const TIMEOUT = 10000;

const raw = process.argv[2];
const asJson = process.argv.includes('--json');
if (!raw) {
  console.error('사용법: node seo-check.mjs <url> [--json]');
  process.exit(1);
}

/* ── 유틸 ─────────────────────────────────────────── */
function toUrl(s) {
  try { return new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); }
  catch { console.error('주소 형식이 올바르지 않습니다:', s); process.exit(1); }
}

async function get(url, { manual = false, method = 'GET' } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      method, signal: ac.signal, redirect: manual ? 'manual' : 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5', Accept: 'text/html,*/*;q=0.8' }
    });
    const body = method === 'HEAD' ? '' : await r.text();
    return { ok: r.ok, status: r.status, url: r.url || url, body, location: r.headers.get('location') || '' };
  } catch (e) {
    return { ok: false, status: 0, url, body: '', err: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally { clearTimeout(t); }
}

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').trim();

/* 한글·한자·가나는 검색결과에서 영문 2글자 폭을 차지한다. 구글은 픽셀 폭으로 자르므로
   "글자 수" 보다 "폭" 이 정확하다. 영문 1, 전각 2 로 환산한 값이 약 60 을 넘으면 잘린다. */
function width(s) {
  let w = 0;
  for (const ch of String(s || '')) w += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-￯]/.test(ch) ? 2 : 1;
  return w;
}

function meta(html, attr, name) {
  const re = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re);
  if (!tag) return '';
  const c = tag[0].match(/content=["']([^"']*)["']/i);
  return c ? decode(c[1]) : '';
}

function parse(html) {
  const head = html.slice(0, 200000);
  const title = decode((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1]);
  const canonical = (head.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)
    || head.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i) || [, ''])[1];
  return {
    title,
    titleWidth: width(title),
    description: meta(head, 'name', 'description'),
    canonical,
    h1: (html.match(/<h1[\s>]/gi) || []).length,
    og: {
      title: meta(head, 'property', 'og:title'),
      description: meta(head, 'property', 'og:description'),
      image: meta(head, 'property', 'og:image'),
      url: meta(head, 'property', 'og:url')
    },
    robotsMeta: meta(head, 'name', 'robots'),
    lang: (head.match(/<html[^>]+lang=["']([^"']+)["']/i) || [, ''])[1],
    viewport: !!meta(head, 'name', 'viewport'),
    jsonld: (html.match(/<script[^>]+application\/ld\+json/gi) || []).length
  };
}

/* robots.txt 에서 특정 UA 가 루트를 막혔는지 (단순 판정 · Disallow: / 만 본다) */
function robotsAllows(txt, bot) {
  if (!txt) return { known: false, allowed: true };
  // "User-agent: a\nUser-agent: b\nDisallow: /" 처럼 묶인 그룹은 하나의 블록으로 합친다
  const parts = txt.split(/\n(?=\s*user-agent\s*:)/i);
  const blocks = []; let pend = [];
  for (const p of parts) {
    pend.push(p);
    if (!/^\s*user-agent\s*:[^\n]*\s*$/i.test(p)) { blocks.push(pend.join('\n')); pend = []; }
  }
  if (pend.length) blocks.push(pend.join('\n'));
  let star = null, mine = null;
  for (const b of blocks) {
    const uas = [...b.matchAll(/user-agent\s*:\s*([^\n#]+)/gi)].map((m) => m[1].trim().toLowerCase());
    if (!uas.length) continue;
    const disallowAll = /^\s*disallow\s*:\s*\/\s*$/im.test(b);
    if (uas.includes('*')) star = !disallowAll;
    if (uas.includes(bot.toLowerCase())) mine = !disallowAll;
  }
  return { known: true, allowed: mine !== null ? mine : (star !== null ? star : true) };
}

/* ── 실행 ─────────────────────────────────────────── */
const u = toUrl(raw);
const page = await get(u.href);
if (!page.ok) {
  const msg = page.status ? `HTTP ${page.status}` : (page.err || '연결 실패');
  if (asJson) console.log(JSON.stringify({ url: u.href, ok: false, error: msg }, null, 2));
  else console.error(`✖ 페이지를 가져오지 못했습니다: ${msg}\n  브라우저에서는 열리는데 여기서 실패한다면 해외 IP·봇 차단을 의심하세요. 검색 크롤러도 같은 이유로 막힙니다.`);
  process.exit(2);
}

const P = parse(page.body);
const finalUrl = page.url;
const origin = new URL(finalUrl).origin;

// canonical 은 실제로 200 을 돌려주는 최종 주소여야 한다 (끝 슬래시 불일치가 대표적 실수)
let canonicalCheck = null;
if (P.canonical) {
  let abs = '';
  try { abs = new URL(P.canonical, finalUrl).href; } catch {}
  if (abs && abs !== finalUrl) {
    const r = await get(abs, { manual: true, method: 'HEAD' });
    canonicalCheck = { target: abs, status: r.status, redirectsTo: r.location || null };
  } else if (abs) canonicalCheck = { target: abs, status: 200, sameAsFinal: true };
}

const rob = await get(origin + '/robots.txt');
const robotsTxt = rob.ok ? rob.body.slice(0, 20000) : '';
const bots = {
  Googlebot: robotsAllows(robotsTxt, 'Googlebot'),
  Yeti: robotsAllows(robotsTxt, 'Yeti'),
  Bingbot: robotsAllows(robotsTxt, 'Bingbot')
};

/* ── 판정 ─────────────────────────────────────────── */
const findings = [];
const F = (level, msg) => findings.push({ level, msg });

if (!P.title) F('err', 'title 태그가 없습니다');
else if (P.titleWidth > 60) F('warn', `title 이 검색결과에서 잘릴 수 있습니다 (폭 ${P.titleWidth}, 한글 약 30자 기준)`);
else if (P.titleWidth < 20) F('warn', `title 이 짧습니다 (폭 ${P.titleWidth})`);
if (!P.description) F('warn', 'meta description 이 없습니다');
else if (width(P.description) > 160) F('info', `meta description 이 깁니다 (폭 ${width(P.description)}) · 뒤가 잘립니다`);
if (P.h1 === 0) F('warn', 'h1 이 없습니다');
else if (P.h1 > 1) F('warn', `h1 이 ${P.h1}개입니다 (1개 권장)`);
if (!P.canonical) F('info', 'canonical 이 없습니다');
else if (canonicalCheck && canonicalCheck.status >= 300 && canonicalCheck.status < 400)
  F('err', `canonical 이 리디렉션됩니다 → ${canonicalCheck.redirectsTo || '?'} (구글이 "리디렉션이 포함된 페이지" 로 분류)`);
else if (canonicalCheck && canonicalCheck.status === 404) F('err', 'canonical 주소가 404 입니다');
if (/noindex/i.test(P.robotsMeta)) F('err', 'meta robots 에 noindex 가 있습니다 · 검색에서 제외됩니다');
if (!P.og.title || !P.og.description || !P.og.image) F('warn', 'OG 태그(title/description/image) 가 불완전합니다 · 카톡·SNS 미리보기가 깨집니다');
else if (!/^https?:\/\//i.test(P.og.image)) F('warn', 'og:image 가 절대주소가 아닙니다');
if (!P.lang) F('info', '<html lang> 이 없습니다 (한국어 사이트면 lang="ko")');
if (!P.viewport) F('warn', 'viewport 메타가 없습니다 · 모바일 평가에 불리');
if (P.jsonld === 0) F('info', '구조화 데이터(JSON-LD) 가 없습니다');
if (!rob.ok) F('info', 'robots.txt 가 없습니다 (없으면 전체 허용으로 취급)');
for (const [name, b] of Object.entries(bots)) if (b.known && !b.allowed) F('err', `robots.txt 가 ${name} 을 막고 있습니다`);

/* ── 출력 ─────────────────────────────────────────── */
const result = { url: u.href, finalUrl, page: P, canonicalCheck, robots: bots, findings };
if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

const cut = (s, n = 90) => (s && s.length > n ? s.slice(0, n) + '…' : (s || '(없음)'));
console.log(`\n${finalUrl}${finalUrl !== u.href ? `  (← ${u.href})` : ''}\n`);
console.log(`  title        ${cut(P.title)}  [폭 ${P.titleWidth}]`);
console.log(`  description  ${cut(P.description)}`);
console.log(`  canonical    ${P.canonical || '(없음)'}${canonicalCheck && !canonicalCheck.sameAsFinal ? `  → HTTP ${canonicalCheck.status}${canonicalCheck.redirectsTo ? ' → ' + canonicalCheck.redirectsTo : ''}` : ''}`);
console.log(`  h1           ${P.h1}개`);
console.log(`  og           title ${P.og.title ? '✓' : '✗'} · description ${P.og.description ? '✓' : '✗'} · image ${P.og.image ? '✓' : '✗'}`);
console.log(`  robots meta  ${P.robotsMeta || '(없음)'}`);
console.log(`  lang         ${P.lang || '(없음)'}   viewport ${P.viewport ? '✓' : '✗'}   JSON-LD ${P.jsonld}개`);
console.log(`  robots.txt   Googlebot ${bots.Googlebot.allowed ? '허용' : '차단'} · Yeti(네이버) ${bots.Yeti.allowed ? '허용' : '차단'} · Bingbot ${bots.Bingbot.allowed ? '허용' : '차단'}`);
console.log('');
if (!findings.length) console.log('  ✓ 기본 항목에 문제가 없습니다.\n');
else {
  const icon = { err: '✖', warn: '▲', info: '·' };
  for (const f of findings) console.log(`  ${icon[f.level]} ${f.msg}`);
  console.log('');
}
process.exit(findings.some((f) => f.level === 'err') ? 3 : 0);
