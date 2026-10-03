// jstatSubset 对拍脚本：逐位比对 src/vendor/jstatSubset.js 与 node_modules/jstat 1.9.6 运行时输出。
// 覆盖项目实际使用的 6 个 API 及宽参数域。要求：误差为 0（Object.is 级一致）。
import { createRequire } from 'module';
import * as subset from '../src/vendor/jstatSubset.js';

const require = createRequire(import.meta.url);
const jstat = require('jstat');

let checks = 0;
let mismatches = 0;
let maxDiff = 0;
let maxDiffWhere = '';

function compare(label, a, b) {
  checks += 1;
  const same =
    Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b));
  if (!same) {
    mismatches += 1;
    const diff = Math.abs((a ?? NaN) - (b ?? NaN));
    if (Number.isFinite(diff) && diff > maxDiff) {
      maxDiff = diff;
      maxDiffWhere = `${label}: ref=${a} subset=${b}`;
    }
    if (mismatches <= 10) console.log(`MISMATCH ${label}: ref=${a} subset=${b}`);
  }
}

// 确定性伪随机（可复现）
let seed = 42n;
function rnd() {
  seed = (seed * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
  return Number(seed >> 11n) / 2 ** 53;
}

// ---- gamma.cdf / gamma.inv ----
const shapes = [0.1, 0.5, 1, 1.5, 2, 3.3, 5, 10, 20, 50, 100, 200, 0.25];
for (const shape of shapes) {
  for (const x of [0, 1e-9, 0.001, 0.5, 1, 2, 5, 10, 50, 100, 400, 1000, 100000]) {
    compare(`gamma.cdf(${x},${shape},1)`, jstat.gamma.cdf(x, shape, 1), subset.gamma.cdf(x, shape, 1));
  }
  for (const p of [1e-6, 0.001, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 0.999, 1 - 1e-9]) {
    for (const scale of [1, 0.5, 2.5, 1000]) {
      compare(`gamma.inv(${p},${shape},${scale})`, jstat.gamma.inv(p, shape, scale), subset.gamma.inv(p, shape, scale));
    }
  }
}
// 随机域
for (let i = 0; i < 20000; i += 1) {
  const shape = 0.05 + rnd() * 300;
  const x = rnd() * 2000;
  compare(`gamma.cdf rand`, jstat.gamma.cdf(x, shape, 1), subset.gamma.cdf(x, shape, 1));
  const p = rnd();
  const scale = 0.3 + rnd() * 10;
  compare(`gamma.inv rand`, jstat.gamma.inv(p, shape, scale), subset.gamma.inv(p, shape, scale));
}

// ---- studentt.cdf / studentt.inv ----
const dofs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 30, 60, 120];
for (const dof of dofs) {
  for (const x of [-1e6, -100, -12.7, -5, -1, -0.1, 0, 0.1, 1, 5, 12.7, 100, 1e6]) {
    compare(`studentt.cdf(${x},${dof})`, jstat.studentt.cdf(x, dof), subset.studentt.cdf(x, dof));
  }
  for (const p of [0.5, 0.75, 0.9, 0.95, 0.975, 0.99, 0.999]) {
    compare(`studentt.inv(${p},${dof})`, jstat.studentt.inv(p, dof), subset.studentt.inv(p, dof));
  }
}
for (let i = 0; i < 20000; i += 1) {
  const dof = 1 + rnd() * 200;
  const x = (rnd() - 0.5) * 100;
  compare(`studentt.cdf rand`, jstat.studentt.cdf(x, dof), subset.studentt.cdf(x, dof));
  const p = 0.5 + rnd() * 0.4999;
  compare(`studentt.inv rand`, jstat.studentt.inv(p, dof), subset.studentt.inv(p, dof));
}

// ---- inv / multiply（强化转移矩阵形态：对角占优的 21x21 内） ----
for (let n = 1; n <= 24; n += 1) {
  for (let trial = 0; trial < 60; trial += 1) {
    // 生成对角占优矩阵（接近强化转移矩阵的性质）
    const m = [];
    for (let r = 0; r < n; r += 1) {
      const row = [];
      let offsum = 0;
      for (let c = 0; c < n; c += 1) {
        const v = rnd() * 2;
        row.push(v);
        if (c !== r) offsum += v;
      }
      row[r] = 1 + offsum + rnd();
      m.push(row);
    }
    const refInv = jstat.inv(m);
    const subInv = subset.inv(m);
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        compare(`inv n=${n} [${r}][${c}]`, refInv[r][c], subInv[r][c]);
      }
    }
    const vec = [];
    for (let r = 0; r < n; r += 1) vec.push([rnd() * 10]);
    const refProd = jstat.multiply(refInv, vec);
    const subProd = subset.multiply(subInv, vec);
    if (n === 1) {
      compare(`multiply n=1 scalar`, refProd, subProd);
    } else {
      for (let r = 0; r < n; r += 1) {
        compare(`multiply n=${n} [${r}]`, refProd[r][0], subProd[r][0]);
      }
    }
  }
}
// n=1 的标量分支
compare('multiply n=1 scalar', jstat.multiply([[2]], [[3]]), subset.multiply([[2]], [[3]]));

console.log('----');
console.log(`checks=${checks} mismatches=${mismatches}`);
if (mismatches) {
  console.log(`maxDiff=${maxDiff} @ ${maxDiffWhere}`);
  process.exitCode = 1;
} else {
  console.log('逐位一致（Object.is）');
}
