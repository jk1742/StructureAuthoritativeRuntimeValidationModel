/* =====================================================================
 * bench/builders.mjs — overhead 측정용 N-스케일 트리 빌더 (공용)
 * ---------------------------------------------------------------------
 * 시간(Chromium)·payload(Node) 가 같은 빌더를 써 '측정==배포 형식 일치'.
 * 모든 자식은 동일 구조(input, name=f{i})이고 모델 차이는 '식별자 필드'뿐.
 *
 * variant: 변경-있는 재구성용. 지정 시 모든 노드에 data-rev=variant 부여.
 *   timed 측정은 두 변형(예: "a"/"b")을 번갈아 적용 → 매 회 모든 노드의 data-rev
 *   가 달라져 setAttribute 가 N 번 실제 발생(식별자는 동일 → 재사용 경로 유지).
 *   variant 미지정(기본) = data-rev 없음 → payload 수치 보존(동결된 값 유지).
 * ===================================================================== */
export const NODE_COUNTS = [10, 50, 100, 500, 1000, 2000];

function attrsOf(i, variant) {
  const a = { type: "text", name: `f${i}` };
  if (variant != null) a["data-rev"] = variant; // 변경-있는 재구성 시 모든 노드가 바뀌는 속성
  return a;
}

export function htmlN(n, variant) {
  let s = "";
  const rev = variant != null ? ` data-rev="${variant}"` : "";
  for (let i = 0; i < n; i++) s += `<input type="text" name="f${i}"${rev}>`;
  return s;
}
export function keyedTreeN(n, variant) {
  const children = [];
  for (let i = 0; i < n; i++) children.push({ key: `k${i}`, tag: "input", attrs: attrsOf(i, variant) });
  return { children };
}
export function serverIdTreeN(n, variant) {
  const children = [];
  for (let i = 0; i < n; i++) children.push({ serverId: `s${i}`, tag: "input", attrs: attrsOf(i, variant) });
  return { children };
}
export function shapeN(n, variant) {
  const children = [];
  for (let i = 0; i < n; i++) children.push({ slot: `f${i}`, tag: "input", attrs: attrsOf(i, variant) });
  return { children };
}
// React 참조선 payload(props 데이터). variant 시 rev 포함(렌더 입력에 변경 반영).
export function reactPropsN(n, variant) {
  const items = [];
  for (let i = 0; i < n; i++) items.push({ key: `k${i}`, name: `f${i}`, value: "", rev: variant != null ? variant : 0 });
  return { items };
}
