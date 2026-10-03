// jstat 最小子集（移植自 jstat 1.9.6，MIT License，Copyright (c) 2013 jStat）。
//
// 背景：全项目只在两处使用 jstat（enhancementSimulator.js 与 triggerOptimizerScoring.js），
// 共 6 个调用点——矩阵 inv/multiply、gamma.cdf/inv、studentt.cdf/inv。全量 jstat 会被
// 打包进主 bundle 与 enhancementWorker（压缩前约 127KB），而实际只用到一个零头。
//
// 本模块只保留这 6 个 API 及其依赖闭包（gammaln / lowRegGamma / betacf / gammapinv /
// ibeta / ibetainv / 矩阵 gauss_jordan / identity / zeros / map / aug）。函数体与
// jstat 1.9.6 源码逐字一致（仅去掉 jStat 命名空间前缀），保证数值结果逐位不变。
//
// 维护约定：
//   1. 除升级 jstat 版本外不要改动算法细节——数值口径被增强模拟（百分位、期望成本）与
//      技能优化器（t 检验 p 值、临界值）的测试锚定；
//   2. jstat 包现为 devDependency，仅供对拍脚本使用（src 运行时只引用本子集）；
//   3. 如确需新增 jstat 函数，从对应版本的 src 目录原样搬运，并用对拍脚本核验
//      （scripts/verify-jstat-subset.mjs，逐位比对 node_modules/jstat 运行时输出；
//      运行命令 npm run verify:jstat-subset）；
//   4. 上游入口：node_modules/jstat/src/{core,linearalgebra,special,distribution}.js。

const isArray = Array.isArray;

function isNumber(num) {
  return typeof num === 'number' ? num - num === 0 : false;
}

// core.js: create
function create(rows, cols, func) {
  var res = new Array(rows);
  var i, j;
  if (typeof cols === 'function') {
    func = cols;
    cols = rows;
  }
  for (i = 0; i < rows; i++) {
    res[i] = new Array(cols);
    for (j = 0; j < cols; j++) res[i][j] = func(i, j);
  }
  return res;
}

function retZero() {
  return 0;
}

function retIdent(i, j) {
  return i === j ? 1 : 0;
}

// core.js: zeros
function zeros(rows, cols) {
  if (!isNumber(cols)) cols = rows;
  return create(rows, cols, retZero);
}

// core.js: identity
function identity(rows, cols) {
  if (!isNumber(cols)) cols = rows;
  return create(rows, cols, retIdent);
}

// core.js: map
function map(arr, func, toAlter) {
  var row, nrow, ncol, res, col;
  if (!isArray(arr[0])) arr = [arr];
  nrow = arr.length;
  ncol = arr[0].length;
  res = toAlter ? arr : new Array(nrow);
  for (row = 0; row < nrow; row++) {
    if (!res[row]) res[row] = new Array(ncol);
    for (col = 0; col < ncol; col++) res[row][col] = func(arr[row][col], row, col);
  }
  return res.length === 1 ? res[0] : res;
}

// linearalgebra.js: aug
function aug(a, b) {
  var newarr = [];
  var i;
  for (i = 0; i < a.length; i++) {
    newarr.push(a[i].slice());
  }
  for (i = 0; i < newarr.length; i++) {
    Array.prototype.push.apply(newarr[i], b[i]);
  }
  return newarr;
}

// linearalgebra.js: gauss_jordan
function gaussJordan(a, b) {
  var m = aug(a, b);
  var h = m.length;
  var w = m[0].length;
  var c = 0;
  var x, y, y2;
  // find max pivot
  for (y = 0; y < h; y++) {
    var maxrow = y;
    for (y2 = y + 1; y2 < h; y2++) {
      if (Math.abs(m[y2][y]) > Math.abs(m[maxrow][y])) maxrow = y2;
    }
    var tmp = m[y];
    m[y] = m[maxrow];
    m[maxrow] = tmp;
    for (y2 = y + 1; y2 < h; y2++) {
      c = m[y2][y] / m[y][y];
      for (x = y; x < w; x++) {
        m[y2][x] -= m[y][x] * c;
      }
    }
  }
  // backsubstitute
  for (y = h - 1; y >= 0; y--) {
    c = m[y][y];
    for (y2 = 0; y2 < y; y2++) {
      for (x = w - 1; x > y - 1; x--) {
        m[y2][x] -= (m[y][x] * m[y2][y]) / c;
      }
    }
    m[y][y] /= c;
    for (x = h; x < w; x++) {
      m[y][x] /= c;
    }
  }
  return m;
}

// linearalgebra.js: inv
export function inv(a) {
  var rows = a.length;
  var cols = a[0].length;
  var b = identity(rows, cols);
  var c = gaussJordan(a, b);
  var result = [];
  var i = 0;
  var j;
  // We need to copy the inverse portion to a new matrix to rid G-J artifacts
  for (; i < rows; i++) {
    result[i] = [];
    for (j = cols; j < c[0].length; j++) result[i][j - cols] = c[i][j];
  }
  return result;
}

// linearalgebra.js: multiply
export function multiply(arr, arg) {
  var row, col, nrescols, sum, nrow, ncol, res, rescols;
  // eg: arr = 2 arg = 3 -> 6 for res[0][0] statement closure
  if (arr.length === undefined && arg.length === undefined) {
    return arr * arg;
  }
  nrow = arr.length;
  ncol = arr[0].length;
  nrescols = isArray(arg) ? arg[0].length : ncol;
  res = zeros(nrow, nrescols);
  rescols = 0;
  if (isArray(arg)) {
    for (; rescols < nrescols; rescols++) {
      for (row = 0; row < nrow; row++) {
        sum = 0;
        for (col = 0; col < ncol; col++) sum += arr[row][col] * arg[col][rescols];
        res[row][rescols] = sum;
      }
    }
    return nrow === 1 && rescols === 1 ? res[0][0] : res;
  }
  return map(arr, function (value) {
    return value * arg;
  });
}

// special.js: gammaln （Log-gamma function）
function gammaln(x) {
  var j = 0;
  var cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  var ser = 1.000000000190015;
  var xx, y, tmp;
  tmp = (y = xx = x) + 5.5;
  tmp -= (xx + 0.5) * Math.log(tmp);
  for (; j < 6; j++) ser += cof[j] / ++y;
  return Math.log((2.5066282746310005 * ser) / xx) - tmp;
}

// special.js: lowRegGamma （The lower regularized incomplete gamma function, P(a,x)）
function lowRegGamma(a, x) {
  var aln = gammaln(a);
  var ap = a;
  var sum = 1 / a;
  var del = sum;
  var b = x + 1 - a;
  var c = 1 / 1.0e-30;
  var d = 1 / b;
  var h = d;
  var i = 1;
  // calculate maximum number of itterations required for a
  var ITMAX = -~(Math.log(a >= 1 ? a : 1 / a) * 8.5 + a * 0.4 + 17);
  var an;

  if (x < 0 || a <= 0) {
    return NaN;
  } else if (x < a + 1) {
    for (; i <= ITMAX; i++) {
      sum += del *= x / ++ap;
    }
    return sum * Math.exp(-x + a * Math.log(x) - aln);
  }

  for (; i <= ITMAX; i++) {
    an = -i * (i - a);
    b += 2;
    d = an * d + b;
    c = b + an / c;
    d = 1 / d;
    h *= d * c;
  }

  return 1 - h * Math.exp(-x + a * Math.log(x) - aln);
}

// special.js: betacf （Continued fraction for incomplete beta function, modified Lentz's method）
function betacf(x, a, b) {
  var fpmin = 1e-30;
  var m = 1;
  var qab = a + b;
  var qap = a + 1;
  var qam = a - 1;
  var c = 1;
  var d = 1 - (qab * x) / qap;
  var m2, aa, del, h;

  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  h = d;

  for (; m <= 100; m++) {
    m2 = 2 * m;
    aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    // One step (the even one) of the recurrence
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    // Next step of the recurrence (the odd one)
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    del = d * c;
    h *= del;
    if (Math.abs(del - 1.0) < 3e-7) break;
  }

  return h;
}

// special.js: gammapinv （Inverse of the lower regularized incomplete gamma function）
function gammapinv(p, a) {
  var j = 0;
  var a1 = a - 1;
  var EPS = 1e-8;
  var gln = gammaln(a);
  var x, err, t, u, pp, lna1, afac;

  if (p >= 1) return Math.max(100, a + 100 * Math.sqrt(a));
  if (p <= 0) return 0;
  if (a > 1) {
    lna1 = Math.log(a1);
    afac = Math.exp(a1 * (lna1 - 1) - gln);
    pp = p < 0.5 ? p : 1 - p;
    t = Math.sqrt(-2 * Math.log(pp));
    x = (2.30753 + t * 0.27061) / (1 + t * (0.99229 + t * 0.04481)) - t;
    if (p < 0.5) x = -x;
    x = Math.max(1e-3, a * Math.pow(1 - 1 / (9 * a) - x / (3 * Math.sqrt(a)), 3));
  } else {
    t = 1 - a * (0.253 + a * 0.12);
    if (p < t) x = Math.pow(p / t, 1 / a);
    else x = 1 - Math.log(1 - (p - t) / (1 - t));
  }

  for (; j < 12; j++) {
    if (x <= 0) return 0;
    err = lowRegGamma(a, x) - p;
    if (a > 1) t = afac * Math.exp(-(x - a1) + a1 * (Math.log(x) - lna1));
    else t = Math.exp(-x + a1 * Math.log(x) - gln);
    u = err / t;
    x -= t = u / (1 - 0.5 * Math.min(1, u * ((a - 1) / x - 1)));
    if (x <= 0) x = 0.5 * (x + t);
    if (Math.abs(t) < EPS * x) break;
  }

  return x;
}

// special.js: ibetainv （Inverse of the incomplete beta function）
function ibetainv(p, a, b) {
  var EPS = 1e-8;
  var a1 = a - 1;
  var b1 = b - 1;
  var j = 0;
  var lna, lnb, pp, t, u, err, x, al, h, w, afac;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  if (a >= 1 && b >= 1) {
    pp = p < 0.5 ? p : 1 - p;
    t = Math.sqrt(-2 * Math.log(pp));
    x = (2.30753 + t * 0.27061) / (1 + t * (0.99229 + t * 0.04481)) - t;
    if (p < 0.5) x = -x;
    al = (x * x - 3) / 6;
    h = 2 / (1 / (2 * a - 1) + 1 / (2 * b - 1));
    w = (x * Math.sqrt(al + h)) / h - (1 / (2 * b - 1) - 1 / (2 * a - 1)) * (al + 5 / 6 - 2 / (3 * h));
    x = a / (a + b * Math.exp(2 * w));
  } else {
    lna = Math.log(a / (a + b));
    lnb = Math.log(b / (a + b));
    t = Math.exp(a * lna) / a;
    u = Math.exp(b * lnb) / b;
    w = t + u;
    if (p < t / w) x = Math.pow(a * w * p, 1 / a);
    else x = 1 - Math.pow(b * w * (1 - p), 1 / b);
  }
  afac = -gammaln(a) - gammaln(b) + gammaln(a + b);
  for (; j < 10; j++) {
    if (x === 0 || x === 1) return x;
    err = ibeta(x, a, b) - p;
    t = Math.exp(a1 * Math.log(x) + b1 * Math.log(1 - x) + afac);
    u = err / t;
    x -= t = u / (1 - 0.5 * Math.min(1, u * (a1 / x - b1 / (1 - x))));
    if (x <= 0) x = 0.5 * (x + t);
    if (x >= 1) x = 0.5 * (x + t + 1);
    if (Math.abs(t) < EPS * x && j > 0) break;
  }
  return x;
}

// special.js: ibeta （The incomplete beta function I_x(a,b)）
function ibeta(x, a, b) {
  // Factors in front of the continued fraction.
  var bt =
    x === 0 || x === 1 ? 0 : Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < 0 || x > 1) return false;
  if (x < (a + 1) / (a + b + 2))
    // Use continued fraction directly.
    return (bt * betacf(x, a, b)) / a;
  // else use continued fraction after making the symmetry transformation.
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

// distribution.js: gamma （shape/scale 参数化）
export const gamma = {
  cdf(x, shape, scale) {
    if (x < 0) return 0;
    return lowRegGamma(shape, x / scale);
  },
  inv(p, shape, scale) {
    return gammapinv(p, shape) * scale;
  },
};

// distribution.js: studentt
export const studentt = {
  cdf(x, dof) {
    var dof2 = dof / 2;
    return ibeta((x + Math.sqrt(x * x + dof)) / (2 * Math.sqrt(x * x + dof)), dof2, dof2);
  },
  inv(p, dof) {
    var x = ibetainv(2 * Math.min(p, 1 - p), 0.5 * dof, 0.5);
    x = Math.sqrt((dof * (1 - x)) / x);
    return p > 0.5 ? x : -x;
  },
};
