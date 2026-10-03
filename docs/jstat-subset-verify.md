# jstat 子集逐位一致性验证留档

- 验证目的：证明 `src/vendor/jstatSubset.js`（jstat 1.9.6 最小子集）与 `node_modules/jstat` 1.9.6 运行时输出逐位一致（`Object.is` 级），作为 jstat 全量替换的数值一致性证据。
- 验证命令：`npm run verify:jstat-subset`（等价于 `node scripts/verify-jstat-subset.mjs`）
- 验证日期：2026-10-03
- 退出码：0

## 输出

```text
----
checks=393010 mismatches=0
逐位一致（Object.is）
```

## 覆盖范围

- 6 个 API：`inv`、`multiply`、`gamma.cdf`、`gamma.inv`、`studentt.cdf`、`studentt.inv`
- 确定性网格：gamma 形状 0.1-200 与 x/p/scale 多档、studentt 自由度 1-120 与 x/p 多档
- 随机域：gamma 与 studentt 各 20000 点（合计 40000 随机点）
- 矩阵：1-24 阶对角占优矩阵各 60 次试验（覆盖 `inv` 与 `multiply`）

## 复现方式

1. `npm install`（jstat 为 devDependency，随常规安装一并安装）
2. `npm run verify:jstat-subset`
3. 期望输出 `checks=393010 mismatches=0` 与 `逐位一致（Object.is）`，退出码 0
