<template>
  <GuidePageEn v-if="language !== 'zh'" />
  <div v-else class="space-y-4">
    <section class="surface-panel overflow-hidden">
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end">
        <div class="min-w-0">
          <p class="mb-2 text-xs font-semibold text-primary">MWI 战斗模拟器</p>
          <h2 class="font-heading text-2xl font-semibold text-foreground sm:text-3xl">使用教程</h2>
          <p class="mt-3 max-w-3xl text-sm leading-7 text-foreground/85">
            从导入角色数据开始，完成一次战斗模拟，再逐步使用队列、刷图推荐、强化模拟和生活技能规划。
          </p>
        </div>
        <div class="border-l-2 border-primary/40 pl-4 text-sm leading-6 text-foreground/85">
          <p class="font-semibold text-primary">推荐阅读顺序</p>
          <p class="mt-1">首次使用 → 战斗模拟 → 队列与多轮结果。专项工具可以按需要单独阅读。</p>
        </div>
      </div>

      <Accordion type="single" collapsible class="mt-5 border-t border-border lg:hidden">
        <AccordionItem value="contents">
          <AccordionTrigger>教程目录</AccordionTrigger>
          <AccordionContent>
            <nav class="grid grid-cols-2 gap-x-4 sm:grid-cols-4" aria-label="教程目录">
              <RouterLink
                v-for="item in guideSections"
                :key="item.id"
                :to="{ path: '/guide', hash: `#${item.id}` }"
                class="border-b border-border py-2 text-sm text-foreground/85 hover:text-primary"
              >
                {{ item.label }}
              </RouterLink>
            </nav>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>

    <div class="surface-panel !p-0 lg:grid lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside class="hidden border-r border-border lg:block">
        <nav class="sticky top-36 max-h-[calc(100vh-10rem)] overflow-y-auto px-4 py-5" aria-label="教程目录">
          <p class="px-2 pb-3 text-xs font-semibold text-muted-foreground">教程目录</p>
          <RouterLink
            v-for="item in guideSections"
            :key="item.id"
            :to="{ path: '/guide', hash: `#${item.id}` }"
            class="block border-l-2 border-border px-3 py-2 text-sm text-foreground/85 hover:border-primary/40 hover:text-primary"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
      </aside>

      <article class="min-w-0 px-4 sm:px-6 lg:px-8">
        <section id="quick-start" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">开始前准备</p>
            <h3 class="guide-title">首次使用与数据导入</h3>
            <p class="guide-lead">先把游戏中的当前角色或队伍数据导入模拟器。这样装备、技能、消耗品和各类 Buff 才会与角色现状一致。</p>
          </div>

          <ol class="guide-steps">
            <li>
              <strong>安装主站导入脚本。</strong>
              在主页点击“导入/导出”，再点击“安装脚本”。安装后，游戏主站侧边栏会出现“战斗模拟器”入口。
            </li>
            <li>
              <strong>直接导入当前单人角色。</strong>
              保持游戏主站处于已登录状态，回到模拟器点击“从主站导入”，脚本会直接读取主站当前角色并写入当前玩家。
            </li>
            <li>
              <strong>组队导入前再打开队友资料。</strong>
              只有组队数据需要先在游戏主站逐个打开队友资料。脚本会使用已经手动打开并缓存过资料的队友，缺失成员会被跳过。
            </li>
            <li>
              <strong>确认导入目标。</strong>
              战斗数据进入主页玩家栏，强化数据进入强化模拟，生活技能数据进入生活技能页面。也可以粘贴 JSON 或载入本地文件。
            </li>
          </ol>

          <div class="mt-5 border-l-2 border-success/40 bg-success/10 px-4 py-3 text-sm leading-6 text-foreground/85">
            强化模拟和生活技能导入的角色数据只在当前页面会话中保留。刷新页面后需要重新导入。
          </div>

          <GuideFigure
            class="mt-6"
            src="/tutorial/import-data.png"
            alt="主页导入导出窗口，包含主站脚本安装、组队导入和单人导入区域"
            caption="导入/导出窗口同时支持主站脚本、JSON 文本和本地文件"
            :width="1425"
            :height="990"
          />

          <RouterLink class="guide-route-link" to="/home">打开主页</RouterLink>
        </section>

        <section id="combat" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">核心流程</p>
            <h3 class="guide-title">完成一次战斗模拟</h3>
            <p class="guide-lead">主页工作区分为基础设置、配装与技能、战斗属性。第一次使用时先完成基础设置，其余内容通常由导入数据自动填充。</p>
          </div>

          <div class="guide-topic-grid">
            <div>
              <h4>设置模拟目标</h4>
              <p>选择区域或迷宫、单目标或批量范围、角色档案、难度和模拟时长。批量范围适合横向比较多个区域。</p>
            </div>
            <div>
              <h4>核对战斗条件</h4>
              <p>确认 EXP、掉落等级以及咩卡、社区 EXP、社区掉落等开关。迷宫模式还需要配置楼层、房间等级和补给箱。</p>
            </div>
            <div>
              <h4>调整配装与技能</h4>
              <p>在“配装与技能”中修改装备、强化等级、食物、饮品、技能和触发器。房间、成就和公会神龛用于补充对应加成。</p>
            </div>
            <div>
              <h4>运行并查看结果</h4>
              <p>点击“开始模拟”。右侧先显示 XP/H、死亡/H、收益/H 等关键指标，“查看完整结果”可展开掉落、经验和战斗明细。</p>
            </div>
          </div>

          <GuideFigure
            class="mt-6"
            src="/tutorial/home-workspace.png"
            alt="主页战斗模拟工作区，包含玩家栏、目标配置、模拟按钮和关键结果区域"
            caption="主页基础设置和模拟工作区"
            :width="1425"
            :height="990"
          />

          <div class="mt-6 grid gap-3 sm:grid-cols-2">
            <div class="guide-note">
              <strong>保存玩家配置</strong>
              <span>保存当前玩家的配置快照，之后可从主页恢复。它适合保存常用配装，不等同于多轮比较基线。</span>
            </div>
            <div class="guide-note">
              <strong>实验性功能</strong>
              <span>面向批量文件处理等高级场景。第一次使用模拟器时可以暂时忽略。</span>
            </div>
          </div>

          <RouterLink class="guide-route-link" to="/home">进入战斗模拟</RouterLink>
        </section>

        <section id="queue" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">方案比较</p>
            <h3 class="guide-title">队列与多轮结果</h3>
            <p class="guide-lead">队列用于比较同一目标下的配装或技能变体。系统先记录基线，再对每个变体进行多轮模拟和稳健聚合。</p>
          </div>

          <ol class="guide-steps">
            <li><strong>设为基准。</strong>在主页或队列顶部点击“设为基准”，保存当前角色、目标和配装作为比较起点。</li>
            <li><strong>加入变体。</strong>修改装备、强化等级、技能、消耗品或其他配置，再点击“加入队列”。多个变更会按实际差异生成可识别的比较项。</li>
            <li><strong>运行队列。</strong>检查队列数量后点击“运行队列”。队列页显示基准摘要、队列列表、进度和上次运行状态。</li>
            <li><strong>阅读多轮结果。</strong>重点查看综合评分、收益和经验变化、稳定性、严格成本或综合成本，以及置信度。需要留档时导出 Excel。</li>
          </ol>

          <div class="mt-5 border-l-2 border-warning/60 px-4 py-2 text-sm leading-6 text-foreground/85">
            装备升级成本采用市场定价：目标强化等级没有精确卖单时，会查找同物品、同强化等级的官方小时成交均价和成交量，并在入队前请求确认。确认价会随队列项保存，仅在运行时仍无精确卖单时使用；新卖单优先。没有有效成交数据时仍无法入队。小时均价是统计周期数据，并非最近一笔成交价。
          </div>

          <div class="mt-6 grid gap-5 xl:grid-cols-2">
            <GuideFigure
              src="/tutorial/queue.png"
              alt="队列运行器空状态，显示设为基准、加入队列、运行队列和清空队列操作"
              caption="队列运行器会先提示建立基准"
              :width="1280"
              :height="720"
            />
            <GuideFigure
              src="/tutorial/multi-results.png"
              alt="多轮结果页面，包含评分模型说明和基准摘要"
              caption="完成队列后，多轮结果页会展示排名和汇总数据"
              :width="1265"
              :height="712"
            />
          </div>

          <div class="mt-5 border-l-2 border-primary/40 px-4 py-2 text-sm leading-6 text-foreground/85">
            比较装备收益时尽量一次只改变一个核心因素。这样队列名称和成本差异更容易解释。
          </div>

          <div class="flex flex-wrap gap-2">
            <RouterLink class="guide-route-link" to="/queue">打开队列</RouterLink>
            <RouterLink class="guide-route-link" to="/multi-results">打开多轮结果</RouterLink>
          </div>
        </section>

        <section id="advisor" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">目标筛选</p>
            <h3 class="guide-title">使用刷图推荐器</h3>
            <p class="guide-lead">刷图推荐器会用当前队伍、Buff、成就、房屋和市场价格扫描多个战斗目标，再按你的偏好排序。</p>
          </div>

          <div class="guide-topic-grid">
            <div>
              <h4>选择评分偏好</h4>
              <p>均衡同时考虑收益与经验；收益和经验会提高对应指标权重；稳健更看重波动；自定义允许手动输入权重。</p>
            </div>
            <div>
              <h4>选择扫描范围</h4>
              <p>可扫描单刷区域、星球区域和迷宫。复核数量与复核轮次越高，结果通常越稳定，但耗时也会增加。</p>
            </div>
            <div>
              <h4>查看推荐结果</h4>
              <p>推荐卡片和表格会展示综合分、收益、经验、安全性和置信度。展开评分说明可以查看当前计算口径。</p>
            </div>
            <div>
              <h4>带回主页验证</h4>
              <p>在推荐表格点击“应用到主页”，再用主页的完整结果核对目标详情和掉落构成。</p>
            </div>
          </div>

          <GuideFigure
            class="mt-6"
            src="/tutorial/advisor.png"
            alt="刷图推荐器设置页面，包含评分偏好、扫描范围、复核次数和开始推荐按钮"
            caption="先选择推荐目标和扫描范围，再开始推荐"
            :width="1440"
            :height="1000"
          />

          <RouterLink class="guide-route-link" to="/advisor">打开刷图推荐</RouterLink>
        </section>

        <section id="enhancement" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">强化决策</p>
            <h3 class="guide-title">评估强化成本与风险</h3>
            <p class="guide-lead">强化模拟器用于比较保护阈值、材料价格和风险预算。它独立于战斗模拟，需要导入强化数据或手动完成配置。</p>
          </div>

          <ol class="guide-steps">
            <li><strong>选择目标物品和等级。</strong>设置起始等级、目标等级、强化技能等级，并按实际情况选择强化茶、福气茶和经验茶。</li>
            <li><strong>补充高级配置。</strong>技能与住宅用于填写成功率相关加成，成本与风险用于选择自动或手动保护品、材料价格和分解回收价值。</li>
            <li><strong>比较保护策略。</strong>策略表会列出预计归零次数、动作数、耗时、材料和期望成本，可按投入排序。</li>
            <li><strong>计算风险。</strong>输入预算后运行风险分析，查看不同成本分位和预算内成功率。贤者之镜与分解页用于判断特殊道具价值。</li>
          </ol>

          <GuideFigure
            class="mt-6"
            src="/tutorial/enhancement.png"
            alt="强化模拟器页面，左侧为物品和强化条件，右侧为保护策略、贤者之镜和风险分析标签页"
            caption="强化配置、保护策略和风险分析集中在同一工作区"
            :width="1265"
            :height="712"
          />

          <RouterLink class="guide-route-link" to="/enhancement">打开强化模拟</RouterLink>
        </section>

        <section id="skilling" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">升级路线</p>
            <h3 class="guide-title">规划生活技能升级</h3>
            <p class="guide-lead">生活技能规划会结合当前经验、背包、装备、Buff 和市场价格，为六种生活技能计算逐级路线。</p>
          </div>

          <div class="guide-topic-grid">
            <div>
              <h4>先导入生活技能快照</h4>
              <p>页面必须获得当前角色的等级、经验、背包和穿戴装备。空状态提示“尚无当前角色生活技能快照”时，需要回主站重新导入。</p>
            </div>
            <div>
              <h4>选择优化模式</h4>
              <p>最低净成本/经验优先控制花费；均衡允许在成本容忍度内缩短耗时；速度优先选择更快的有效路线。</p>
            </div>
            <div>
              <h4>设置范围和目标等级</h4>
              <p>可以只计算一项技能，也可以计算全部技能。目标包括采摘、酿造、奶酪锻造、烹饪、制作和裁缝。</p>
            </div>
            <div>
              <h4>查看路线明细</h4>
              <p>总览用于比较技能，技能标签页展示等级区间。明细中可以查看饮品、装备、阶段动作、材料采购和产出回收。</p>
            </div>
          </div>

          <GuideFigure
            class="mt-6"
            src="/tutorial/skilling.png"
            alt="生活技能升级推荐器，包含优化模式、计算范围、价格操作和未导入数据提示"
            caption="导入生活技能快照后，计算按钮和目标等级设置才会完整可用"
            :width="1280"
            :height="720"
          />

          <RouterLink class="guide-route-link" to="/skilling">打开生活技能</RouterLink>
        </section>

        <section id="settings" class="guide-section scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">全局口径</p>
            <h3 class="guide-title">价格、评分与运行设置</h3>
            <p class="guide-lead">设置页决定队列如何评分、使用多少线程和轮次，以及收益计算使用哪一类市场价格。</p>
          </div>

          <div class="guide-topic-grid">
            <div>
              <h4>评分模型</h4>
              <p>性能、稳定和成本三部分权重合计为 100%。性能内部还可以分配收益、经验、DPS 和击杀权重。</p>
            </div>
            <div>
              <h4>执行与线程</h4>
              <p>并行模式速度更快，串行模式便于控制资源占用。并行线程上限同时影响主页的批量区域和迷宫模拟。</p>
            </div>
            <div>
              <h4>采样与统计</h4>
              <p>队列轮次控制变体采样，基准轮次控制基线采样。中位混合越高，汇总结果越不容易被极端轮次带偏。</p>
            </div>
            <div>
              <h4>价格与装备方案</h4>
              <p>刷新市场价格后可选择消耗品和掉落物的计价口径，也可按物品手动覆盖。装备方案用于保存和恢复常用配置。</p>
            </div>
          </div>

          <GuideFigure
            class="mt-6"
            src="/tutorial/settings.png"
            alt="设置页面，包含评分模型、执行与线程、采样与统计配置"
            caption="队列评分、线程和采样设置会直接影响运行耗时与结果口径"
            :width="1265"
            :height="712"
          />

          <RouterLink class="guide-route-link" to="/settings">打开设置</RouterLink>
        </section>

        <section id="troubleshooting" class="scroll-mt-36 py-8">
          <div class="guide-section-heading">
            <p class="guide-kicker">常见问题</p>
            <h3 class="guide-title">遇到空状态或按钮不可用</h3>
            <p class="guide-lead">多数空状态来自缺少对应角色快照、尚未建立基线，或还没有完成队列运行。</p>
          </div>

          <div class="mt-5 border-y border-border">
            <details class="guide-faq" open>
              <summary>为什么“设为基准”或专项计算不可用？</summary>
              <p>先确认当前玩家已经导入对应数据，并在顶部勾选参与模拟的玩家。强化和生活技能需要导入各自的数据目标，主页战斗数据不能代替。</p>
            </details>
            <details class="guide-faq">
              <summary>为什么多轮结果没有排名？</summary>
              <p>先建立基准，至少加入一个变体，然后完成队列运行。多轮结果页不会自动使用主页最近一次单轮模拟。</p>
            </details>
            <details class="guide-faq">
              <summary>为什么刷新后强化或生活技能数据消失？</summary>
              <p>这两类导入数据按设计只保留在当前页面会话，刷新后需要重新从主站导入。已经保存的全局设置不受影响。</p>
            </details>
            <details class="guide-faq">
              <summary>教程截图与当前界面略有不同怎么办？</summary>
              <p>以当前页面的字段说明和按钮状态为准。版本更新可能调整布局，但“导入、配置、运行、查看结果”的主流程保持一致。</p>
            </details>
          </div>

          <div class="mt-6 flex flex-wrap gap-2">
            <RouterLink class="button-primary" to="/home">开始一次模拟</RouterLink>
            <RouterLink class="button-secondary" to="/settings">检查运行设置</RouterLink>
          </div>
        </section>
      </article>
    </div>
  </div>
</template>

<script setup>
import GuideFigure from "../components/guide/GuideFigure.vue";
import GuidePageEn from "./GuidePageEn.vue";
import { useI18nText } from "../composables/useI18nText.js";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../components/ui/accordion/index.js";
import "../guide.css";

const { language } = useI18nText();

const guideSections = [
  { id: "quick-start", label: "首次使用" },
  { id: "combat", label: "战斗模拟" },
  { id: "queue", label: "队列与多轮" },
  { id: "advisor", label: "刷图推荐" },
  { id: "enhancement", label: "强化模拟" },
  { id: "skilling", label: "生活技能" },
  { id: "settings", label: "设置" },
  { id: "troubleshooting", label: "常见问题" },
];
</script>
