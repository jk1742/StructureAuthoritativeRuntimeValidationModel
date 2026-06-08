# Case 4 — Component Reconstruction Consistency (R1/R2/R3 × A/B/C/D)

스케치(`case4_ext_sketch.js`)를 바탕으로 구성한 Case 4 패키지입니다. 검토용 후보
패키지이며, 프로젝트 반영(파일 이동·논문 수치 기재)은 작성자가 직접 수행합니다.

## 무엇을 측정하나

| 모델 | 정합성 기준 | R1 보존 | R2 폐기(naive) | R3 적대적 위조 |
|---|---|---|---|---|
| A. innerHTML | 없음(완전 재생성) | 가설: lost | 가설: discarded | 가설: 위장 불가/상태도 못 지킴 |
| B. keyed (React) | developer key (hint) | 가설: preserved | 가설: false reuse | 가설: forged |
| D. server-id | server 발급 id (응답에 실림) | 가설: preserved | 가설: discarded | 가설: forged |
| C. identity (권위) | authority-issued lineage | 가설: preserved | 가설: discarded | 가설: blocked |

입증 메시지: **D가 R1·R2를 다 맞히고도 R3에서 뚫리는 유일한 행** → "서버 id면 충분"을
반박, C만 R3까지 통과 → 권위 발급(클라이언트 도달 불가)의 필요성을 실증.
(근거: `HANDOFF_2026-06-08_case4-extension.md` §2)

> 표의 "가설"은 핸드오프 §2의 예상이며, **실제 결과는 실행 산출값**입니다(placeholder 금지).

## 측정 (공통 엔진: 실 Chromium)

JSDOM 은 사용하지 않습니다. 두 드라이버 모두 실 Chromium 위에서 돕니다.

- **매트릭스 (A/B/C/D × R1/R2/R3)** — `chromium/run-matrix.mjs`. 실 Chromium DOM +
  실 입력 이벤트(fill). A/C/D 로직과 R3 판정 정의를 확정. Model B 는 최소 구현
  keyed(로직 확인용).
- **탐지 (실 React, Model B)** — `react/`. 논문의 Model B 수치는 이 실 React
  측정이 권위. 공통 주 엔진 Chromium, Firefox 는 선택적 교차(HANDOFF §5).

두 드라이버 모두 `src/*.mjs` 를 단일 출처로 import 합니다(측정==구현 코드 일치, §8).

## 구성

```
case_4/
  README.md
  src/
    models.mjs       A(innerHTML)/B(keyed)/D(server-id) reconciler
    identity.mjs     C: Reconstruction Authority + Identity Reconciler
    scenarios.mjs    R1/R2/R3 빌더 + 판정 함수(judgePreserve/Discard/Forgery)
  chromium/
    index.html       매트릭스 하니스 페이지
    harness.mjs      src 를 import 해 setup/apply 를 window 에 노출
    run-matrix.mjs   실 Chromium 드라이버(임시 http 서버) → case4_matrix_result.json
  react/
    index.html       실 React 하니스 페이지 (로컬 UMD)
    case4_react.js   Model B 하니스 (R1/R2/R3 시나리오)
    run.mjs          Playwright 드라이버(Chromium 주, Firefox 선택) → case4_react_result.json
    vendor/          (작성자 배치) react.development.js, react-dom.development.js
```

## 실행

공통 엔진은 실 Chromium 입니다. Playwright 브라우저 바이너리는 샌드박스에서
받을 수 없으므로(§8) 두 드라이버 모두 **작성자 로컬**에서 실행합니다.

매트릭스(A/B/C/D × R1/R2/R3):
```
npm install playwright
npx playwright install chromium
node chromium/run-matrix.mjs
```

탐지(실 React, Model B):
```
npx playwright install chromium      # firefox 는 교차 시에만
# react/vendor/ 에 react UMD 2개 배치
node react/run.mjs
```

## 확정된 설계 결정

1. **위협 모델**: 공격자는 same-origin 권한으로 재구성 응답을 임의 합성·주입할 수
   있으나, 권위의 발급 대장(서버측 비밀)에는 도달 못 한다. 권위 id 탈취는
   Case 1 L5(권위 손상 = supply-chain)로 위협 모델 경계 밖
   (`HANDOFF_2026-06-08_day5.md`의 "Undetected by design" 경계 행과 통일).
2. **R3 처리 = reject-and-drop**: 권위 미발급 id가 검출되면 위조 subtree를
   생성·바인딩하지 않고 폐기하며, 같은 위치의 정당한 이전 노드는 보존한다.
3. **R3 판정 기준**: `forgerySucceeded := (공격자 정의 노드 존재) AND (이전 입력값 탈취)`.
   C는 위조 노드가 DOM에 진입조차 못 하므로 둘 다 거짓 → blocked.

## 불변 원칙 (HANDOFF §8)

- 원본 `model-core.mjs` 불변. 재구성기(authority+reconciler)는 별도 모듈.
- placeholder 금지: 실측 전 수치·결과는 논문/그림에 기재하지 않음.
- 엔진: 공통 실 Chromium (JSDOM 미사용), Firefox 는 선택적 교차.
- 파일 반영·논문 기재는 작성자 직접.

## 통합 전 남은 TODO

- [ ] A의 R3 칸("위장 불가하나 상태도 못 지킴") 표현을 실측 기반으로 정확히 기술
      (현재 측정: 공격자 노드는 존재하나 값은 빈 값 → forgery-blocked, 단 R1도 실패).
- [ ] 결정① 위협 모델을 본문 §2 / Case 1 L5와 명시적으로 묶기(정직성 가드).
- [ ] 그림 구성: 핸드오프 §4 (나) 비대칭 권장 — R1/R2는 A/B/C, R3 열에서만 D 등장.
- [ ] 탐지축 Model B의 R3 수치를 `react/run.mjs` 실 엔진 측정으로 확정.
- [ ] 기존 `case4_experiment.js`(JSDOM, R1/R2)는 본 패키지가 Chromium 으로 대체.
      해당 파일을 본 모듈/드라이버로 교체·폐기할지 작성자 판단.
- [ ] overhead 재측정 시점: Case 4 확정 후 1회(원본 model-core 불변 보증, 표 14 재현).
