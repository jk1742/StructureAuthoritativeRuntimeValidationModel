/**
 * 논문 6장 - Case 1: Runtime State Forgery Detection
 *
 * 비교 모델
 *  (A) Baseline (MetaTag Model)
 *      - 진실값(truth)을 DOM 내부 <meta> tag에 저장
 *      - input.value vs meta[content] 직접 비교
 *      - 검증 기준이 DOM mutable surface 위에 있음
 *
 *  (B) Proposed (Registry Model)
 *      - indexMap     : id(키) -> entity(metadata, truth)
 *      - weakNodeMap  : DOM node(키) -> id
 *      - 검증 기준이 DOM 외부 registry에 위치
 *
 * 공격 시나리오
 *  S1. 단순 property forgery       : input.value 직접 변조
 *  S2. checkbox.checked forgery    : 직접 변조
 *  S3. textarea.value forgery      : 직접 변조
 *  S4. Evasion forgery             : property + <meta> 동시 변조
 *                                    (Baseline 우회 시도)
 */

const { JSDOM } = require("jsdom");

// ============================================================
// 0. 실행 환경 준비 (browser-like)
// ============================================================
const dom = new JSDOM(`<!doctype html><html><head></head><body>
  <input id="username" type="text" />
  <input id="agree" type="checkbox" />
  <textarea id="memo"></textarea>
</body></html>`);

const document = dom.window.document;
const HTMLInputElement = dom.window.HTMLInputElement;

// ============================================================
// 1. Baseline (A) - MetaTag Model
// ============================================================
const MetaTagModel = {
  /**
   * 진실값을 <meta name="truth:{id}" content="..."> 형태로 DOM 안에 기록
   */
  setTruth(id, value) {
    let meta = document.querySelector(`meta[name="truth:${id}"]`);
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", `truth:${id}`);
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", String(value));
  },

  /**
   * 검증 : DOM input의 현재 property vs DOM meta content
   * - 둘 다 DOM 위에 있으므로 동일한 mutable surface 위에 있음
   */
  validate(id) {
    const node = document.getElementById(id);
    const meta = document.querySelector(`meta[name="truth:${id}"]`);
    const truth = meta ? meta.getAttribute("content") : null;

    let current;
    if (node.type === "checkbox" || node.type === "radio") {
      current = String(!!node.checked);
      // truth도 boolean 문자열로 정규화
      const truthBool = String(truth === "true");
      return {
        valid: current === truthBool,
        domValue: current,
        truthValue: truthBool,
        truthSource: "meta tag (in-DOM)",
      };
    } else {
      current = String(node.value ?? "");
      return {
        valid: current === String(truth ?? ""),
        domValue: current,
        truthValue: String(truth ?? ""),
        truthSource: "meta tag (in-DOM)",
      };
    }
  },
};

// ============================================================
// 2. Proposed (B) - Registry Model (indexMap + weakNodeMap)
// ============================================================
const RegistryModel = (function () {
  // DOM 외부 closure scope. 외부 script가 직접 손댈 수 없음.
  const indexMap = new Map();       // id -> entity { id, truth, tag, type }
  const weakNodeMap = new WeakMap(); // DOM node -> id

  let _seq = 0;
  function _genId(prefix) {
    return `${prefix}-${(++_seq).toString(36)}`;
  }

  return {
    /**
     * registry에 node를 등록하면서 임의 id를 부여하고
     * indexMap에 truth를 보관한다.
     */
    register(node, truth) {
      const id = _genId("e");
      const tag = String(node.tagName || "").toLowerCase();
      const type = String(node.type || "").toLowerCase();
      const entity = { id, truth, tag, type };
      indexMap.set(id, entity);
      weakNodeMap.set(node, id);
      return id;
    },

    /**
     * truth 갱신은 정규 인터페이스(=정상 interaction propagation)로만 가능
     * 외부 script는 이 함수에 접근할 수 없는 객체 graph 위에 있음
     */
    propagate(node, truth) {
      const id = weakNodeMap.get(node);
      if (!id) return false;
      const entity = indexMap.get(id);
      if (!entity) return false;
      entity.truth = truth;
      return true;
    },

    /**
     * 검증 : DOM node -> weakNodeMap -> indexMap -> truth
     */
    validate(node) {
      const id = weakNodeMap.get(node);
      if (!id) {
        return {
          valid: false,
          reason: "UNREGISTERED_NODE",
          truthSource: "registry (out-of-DOM)",
        };
      }
      const entity = indexMap.get(id);
      if (!entity) {
        return {
          valid: false,
          reason: "MISSING_ENTITY",
          truthSource: "registry (out-of-DOM)",
        };
      }

      let current;
      let truth;
      if (entity.tag === "input" && (entity.type === "checkbox" || entity.type === "radio")) {
        current = !!node.checked;
        truth = !!entity.truth;
      } else {
        current = String(node.value ?? "");
        truth = String(entity.truth ?? "");
      }

      return {
        valid: current === truth,
        domValue: current,
        truthValue: truth,
        truthSource: "registry (out-of-DOM)",
        entityId: id,
      };
    },
  };
})();

// ============================================================
// 3. 초기 truth 셋업 (정상 propagation 시점)
// ============================================================
const usernameNode = document.getElementById("username");
const agreeNode    = document.getElementById("agree");
const memoNode     = document.getElementById("memo");

// 정상 입력 결과로 가정하는 값
const INIT_USERNAME = "alice";
const INIT_AGREE    = false;
const INIT_MEMO     = "hello world";

// DOM에 정상값 반영 (정상 interaction이라고 가정)
usernameNode.value   = INIT_USERNAME;
agreeNode.checked    = INIT_AGREE;
memoNode.value       = INIT_MEMO;

// Baseline 등록
MetaTagModel.setTruth("username", INIT_USERNAME);
MetaTagModel.setTruth("agree",    INIT_AGREE);
MetaTagModel.setTruth("memo",     INIT_MEMO);

// Proposed 등록
RegistryModel.register(usernameNode, INIT_USERNAME);
RegistryModel.register(agreeNode,    INIT_AGREE);
RegistryModel.register(memoNode,     INIT_MEMO);

// ============================================================
// 4. 실험 유틸
// ============================================================
const results = [];

function runScenario(name, attackFn, targets) {
  // 매 시나리오 시작 전 정상값으로 복원
  usernameNode.value = INIT_USERNAME;
  agreeNode.checked  = INIT_AGREE;
  memoNode.value     = INIT_MEMO;
  MetaTagModel.setTruth("username", INIT_USERNAME);
  MetaTagModel.setTruth("agree",    INIT_AGREE);
  MetaTagModel.setTruth("memo",     INIT_MEMO);
  RegistryModel.propagate(usernameNode, INIT_USERNAME);
  RegistryModel.propagate(agreeNode,    INIT_AGREE);
  RegistryModel.propagate(memoNode,     INIT_MEMO);

  // attacker가 외부에서 DOM mutation 수행
  attackFn();

  for (const t of targets) {
    const node = document.getElementById(t.id);
    const a = MetaTagModel.validate(t.id);
    const b = RegistryModel.validate(node);

    results.push({
      scenario: name,
      target: t.id,
      attack: t.attack,
      baseline_meta: {
        detected: !a.valid,
        domValue: a.domValue,
        truthValue: a.truthValue,
      },
      proposed_registry: {
        detected: !b.valid,
        domValue: b.domValue,
        truthValue: b.truthValue,
      },
    });
  }
}

// ============================================================
// 5. 시나리오 정의 & 실행
// ============================================================

// S1. input.value 직접 변조
runScenario(
  "S1: input.value direct forgery",
  () => {
    usernameNode.value = "attacker";
  },
  [{ id: "username", attack: "input.value='attacker'" }]
);

// S2. checkbox.checked 직접 변조
runScenario(
  "S2: checkbox.checked direct forgery",
  () => {
    agreeNode.checked = true;
  },
  [{ id: "agree", attack: "checkbox.checked=true" }]
);

// S3. textarea.value 직접 변조
runScenario(
  "S3: textarea.value direct forgery",
  () => {
    memoNode.value = "INJECTED";
  },
  [{ id: "memo", attack: "textarea.value='INJECTED'" }]
);

// S4. Evasion - property + meta tag 동시 변조
//   공격자가 MutationObserver 또는 단순 비교를 회피하기 위해,
//   DOM 내부에 위치한 검증 기준(meta) 자체도 같이 위조
runScenario(
  "S4: evasion - property + meta tag co-forgery",
  () => {
    // 1) DOM property 위조
    usernameNode.value = "attacker";
    agreeNode.checked  = true;
    memoNode.value     = "INJECTED";

    // 2) 동시에 in-DOM 검증 기준(meta tag) 위조
    document.querySelector('meta[name="truth:username"]').setAttribute("content", "attacker");
    document.querySelector('meta[name="truth:agree"]').setAttribute("content", "true");
    document.querySelector('meta[name="truth:memo"]').setAttribute("content", "INJECTED");

    // 3) registry는 외부 closure scope이므로 접근 불가
    //    (공격자가 RegistryModel.propagate를 직접 호출할 수 없다고 가정.
    //     실 환경에서는 module scope 또는 private symbol 등으로 보호)
  },
  [
    { id: "username", attack: "input.value + meta both" },
    { id: "agree",    attack: "checkbox.checked + meta both" },
    { id: "memo",     attack: "textarea.value + meta both" },
  ]
);

// ============================================================
// 6. 결과 출력
// ============================================================
console.log("\n=== Case 1: Runtime State Forgery Detection ===\n");

const rows = results.map(r => ({
  Scenario: r.scenario,
  Target: r.target,
  Attack: r.attack,
  "Baseline(meta) Detected": r.baseline_meta.detected ? "YES" : "NO  (BYPASSED)",
  "Proposed(registry) Detected": r.proposed_registry.detected ? "YES" : "NO  (BYPASSED)",
}));

console.table(rows);

// 요약
const total = results.length;
const baseDet = results.filter(r => r.baseline_meta.detected).length;
const propDet = results.filter(r => r.proposed_registry.detected).length;

console.log("\n--- Detection Summary ---");
console.log(`Total scenarios : ${total}`);
console.log(`Baseline (meta tag)     detection rate : ${baseDet}/${total} = ${(baseDet / total * 100).toFixed(1)}%`);
console.log(`Proposed (registry)     detection rate : ${propDet}/${total} = ${(propDet / total * 100).toFixed(1)}%`);

// 세부 값 비교
console.log("\n--- Detailed Values ---");
for (const r of results) {
  console.log(`\n[${r.scenario}] target=${r.target} (${r.attack})`);
  console.log(`  baseline   : dom="${r.baseline_meta.domValue}" vs truth(meta)="${r.baseline_meta.truthValue}" -> ${r.baseline_meta.detected ? "DETECTED" : "BYPASSED"}`);
  console.log(`  proposed   : dom="${r.proposed_registry.domValue}" vs truth(reg)="${r.proposed_registry.truthValue}" -> ${r.proposed_registry.detected ? "DETECTED" : "BYPASSED"}`);
}

// JSON 결과도 함께 출력 (논문 표에 사용 가능)
require("fs").writeFileSync(
  "/home/claude/exp_case1/case1_result.json",
  JSON.stringify(results, null, 2)
);
console.log("\nJSON result -> /home/claude/exp_case1/case1_result.json");
