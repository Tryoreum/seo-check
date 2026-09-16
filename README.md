# seo-check

한 페이지의 기본 SEO 신호를 터미널에서 5초 만에 확인하는 스크립트. 의존성 없음, Node 18 이상.

한국 사이트에 맞춰 만들었습니다. **한글 제목 폭**으로 잘림을 판정하고, **네이버 크롤러(Yeti)** 허용 여부를 보고, **canonical 이 리디렉션되는지 실제로 요청**해 확인합니다. 해외 도구들이 한국어 사이트에서 자주 틀리는 세 지점입니다.

```
node seo-check.mjs https://example.com
```

```
https://example.com/

  title        예시 회사 | 서비스 소개  [폭 22]
  description  (없음)
  canonical    https://example.com  → HTTP 301 → https://example.com/
  h1           1개
  og           title ✓ · description ✗ · image ✓
  robots meta  (없음)
  lang         ko   viewport ✓   JSON-LD 0개
  robots.txt   Googlebot 허용 · Yeti(네이버) 차단 · Bingbot 허용

  ▲ meta description 이 없습니다
  ✖ canonical 이 리디렉션됩니다 → https://example.com/ (구글이 "리디렉션이 포함된 페이지" 로 분류)
  ▲ OG 태그(title/description/image) 가 불완전합니다 · 카톡·SNS 미리보기가 깨집니다
  ✖ robots.txt 가 Yeti 을 막고 있습니다
```

`--json` 을 붙이면 JSON 으로 나옵니다. CI 에서 쓰면 `err` 가 하나라도 있을 때 exit code 3 으로 끝납니다.

```
node seo-check.mjs https://example.com --json
```

## 검사 항목

| 항목 | 기준 |
|---|---|
| title | 없음 / 폭 60 초과(한글 약 30자, 검색결과에서 잘림) / 폭 20 미만 |
| meta description | 없음 / 폭 160 초과 |
| canonical | 없음 / **실제 요청해서 3xx 면 오류** (끝 슬래시 불일치가 대표적) / 404 |
| h1 | 0개 또는 2개 이상 |
| meta robots | noindex |
| OG | og:title · og:description · og:image 누락, og:image 상대주소 |
| lang / viewport / JSON-LD | 유무 |
| robots.txt | Googlebot · Yeti(네이버) · Bingbot 이 `Disallow: /` 로 막혔는지 |

## 왜 만들었나

정적 사이트를 Netlify 에 올리고 나서 서치콘솔에 "리디렉션이 포함된 페이지" 가 56개 잡혔습니다. canonical 과 사이트맵에 끝 슬래시를 안 붙였고, 호스팅은 슬래시 붙은 주소로 301 시키고 있었습니다. 사이트는 멀쩡히 열려서 눈으로는 절대 못 찾는 문제였습니다. 배포 직후 한 번 돌려보면 잡히는 것들을 모아둔 게 이 스크립트입니다.

전체 사이트를 크롤해서 8개 영역 점수와 페이지별 감점 내역까지 보려면 웹 버전인 [오름 무료 SEO 진단](https://tryoreum.com/)을 쓰시면 됩니다. 이 스크립트는 그중 한 페이지짜리 핵심만 떼어 온 것입니다.

## 한계

- robots.txt 판정은 `Disallow: /` 만 봅니다. 경로별 규칙·Allow 우선순위는 계산하지 않습니다.
- 자바스크립트를 실행하지 않습니다. SPA 는 서버가 주는 HTML 기준으로만 봅니다 (검색 크롤러 대부분도 그렇습니다).
- 해외 IP 를 막는 호스팅이면 이 스크립트도 막힙니다. 그건 스크립트 문제가 아니라 크롤러도 같이 막히고 있다는 신호입니다.

## License

MIT
