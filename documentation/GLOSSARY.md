# 术语表

这份表解释文档、页面和代码里反复出现的词。写文档时遇到这些词，就用这里的说法，
不要另起一套。每行四列：术语、英文全称、中文、它在本项目里具体指什么。

数值和名字都能在仓库里对应上：营养数据在 `docs/data/foods.json`，参考摄入量在
`docs/data/dri.json`，数据来源在 `data-src/`，代码在 `docs/js/` 和 `tools/`。

## 一、参考摄入量（每天该吃多少）

| 术语 | 英文全称 | 中文 | 在本项目里 |
|---|---|---|---|
| DRI | Dietary Reference Intakes | 膳食营养素参考摄入量 | 官方给出的一组「每天大概该吃多少」的参考数字。页面上每张卡片里的「每日目标」，就是从这张表里查出来的那个数字；数据在 `docs/data/dri.json`，由 `tools/build_dri.py` 从 `data-src/dri/*.csv` 生成。 |
| RNI | Recommended Nutrient Intake | 推荐摄入量 | 中国标准的数值类型之一。`data-src/dri/cn2023.csv` 的 `target_type` 写作 `RNI`；中国表 220 个数值格里有 160 个是 RNI。 |
| RDA | Recommended Dietary Allowance | 推荐膳食供给量 | 美国标准的数值类型之一。`data-src/dri/us.csv` 的 `target_type` 写作 `RDA`；美国表 220 个数值格里有 170 个是 RDA。 |
| AI | Adequate Intake | 适宜摄入量 | 证据不足、算不出 RNI 或 RDA 时给出的参考值。中国和美国标准都用 AI（例如钾）；中国表 60 格、美国表 50 格是 AI。 |
| UL | Tolerable Upper Intake Level | 可耐受最高摄入量 | 长期每天吃也不该超过的量。`dri.json` 每个数值带 `ul` 字段，超过时目标卡片给出上限警告。 |
| EAR | Estimated Average Requirement | 平均需要量 | 官方推算 RNI 或 RDA 时用的中间值。本站不显示也不计算 EAR，`data-src/dri/*.csv` 里没有这一列。 |
| RAE | Retinol Activity Equivalents | 视黄醇活性当量（维生素 A 的一种计量方式） | 简单理解：这是把不同来源的维生素 A 换算成同一种单位后的数字。页面写作 `ug RAE`；数值直接取 USDA 营养素 1106。 |
| NE | Niacin Equivalents | 烟酸当量 | 简单理解：烟酸当量是把食物里的烟酸和身体能用色氨酸转成的烟酸加在一起。页面写作 `mg NE`。`tools/build_foods.py` 按「烟酸毫克 + 色氨酸克 × 1000 / 60」计算（常量 `NIACIN_NE_DIVISOR = 60.0`）；缺色氨酸时只用烟酸，并记下 `niacinNoTryptophan` 标记。 |
| DFE | Dietary Folate Equivalents | 膳食叶酸当量 | 简单理解：膳食叶酸当量是把天然叶酸和添加的叶酸折算成同一单位。页面写作 `ug DFE`；数值直接取 USDA 营养素 1190。 |
| alpha-TE | alpha-Tocopherol Equivalents | α-生育酚当量 | 简单理解：这是把不同形式的维生素 E 折算成同一种单位后的数字。中国维生素 E 目标用的单位。食物数据只提供 α-生育酚（USDA 1109），`data-src/nutrients.csv` 的备注写明了这个差别。 |
| 数值类型 | value type | 数值类型 | `dri.json` 里每个营养素的 `type`：中国只出现 `RNI` 和 `AI`，美国只出现 `RDA` 和 `AI`，页面在数字后用括号标出，例如「800 mg (RNI)」。 |
| 上限是否适用于食物 | UL applies to food | 上限适用对象 | `dri.json` 的 `ulAppliesToFood`。为 `false` 时（例如两国的维生素 A、叶酸），上限只针对补充剂或强化剂，食物摄入不触发警告。 |
| 年龄组 | DRI age group | 年龄组 | `dri.json` 里的一个组：`sex`、`ageMin`、`ageMax`、`lifeStage`。中国和美国各 10 组，`docs/js/core/dri.js` 的 `findGroup()` 按性别和年龄找到它。 |
| 每日目标 | daily target | 每日目标 | 当前标准、性别、年龄下某个营养素的一个数值；页面上方每个营养素一张卡片显示它。 |

## 二、食物数据

| 术语 | 英文全称 | 中文 | 在本项目里 |
|---|---|---|---|
| SR Legacy | USDA FoodData Central SR Legacy | 美国农业部 SR Legacy 数据集 | 食物营养数值的唯一来源，2018-04 版。原始 CSV 下载到 `data-raw/`（不提交），由脚本抽成 `docs/data/foods.json`；591 个食物里有 588 个来自它。 |
| FDC ID | FoodData Central ID | FDC 编号 | SR Legacy 给每种食物的数字编号。`data-src/foods_curated.csv` 用 `fdc_id` 选食物，`foods.json` 里叫 `fdcId`，食物 id 形如 `fdc:167862`。 |
| 每 100 g | per 100 g | 每 100 克 | 所有营养数值的统一基准，对应 `foods.json` 的 `per100g`；普通食物卡片上写「每 100 g」。 |
| 每 10 g | per 10 g | 每 10 克 | 调味料、香辛料、食用油和干货每次吃得很少，改用 10 g 作为比较份量：`foods.json` 的 `amountBasisG` 为 10，名单来自 `data-src/small_portion_foods.csv`，共 58 个食物，卡片写「每 10 g」。其余食物的 `amountBasisG` 是 100。 |
| 废弃率 | refuse percentage | 不可食部分比例 | USDA 记录的骨头等不能吃的部分占多少。15 个带骨食物写在 `data-src/bone_in_foods.csv`，构建后是 `foods.json` 的 `refusePct`。 |
| 带骨重量 | with-bone weight | 带骨重量 | 带骨食物按整块（含骨）称重，家庭计量和手动克数都是这个重量。 |
| 可食部 | edible portion | 可食部分 | 真正吃下去的部分，也是营养数值的基准。`docs/js/core/measures.js` 的 `edibleGrams()` 按「带骨克数 × (1 − refusePct / 100)」换算，卡片显示「可食部约 70 g」。 |
| 估算依据 | basis | 估算依据 | `data-src/measures.csv` 的 `basis` 列：`usda_portion:<编号>` 表示来自 USDA 的份量记录，`estimate:` 开头表示人工估算。 |
| 空值 | null | 无数据 | `foods.json` 里写 `null` 表示这个食物这个营养素没有数据。算总量时按 0 处理，同时这个食物也不会出现在该营养素的食物列表里——没有数据的食物不参与比较。注意「没有数据」和「含量为零」（写着 0）是两回事。列表过滤见 `docs/js/core/order.js`。 |
| 包装标签食物 | package label food | 包装标签食物 | `source.type` 为 `package_label` 的食物，本站有 3 个用户自有牛奶：钙取包装标签值，其余营养素按同类 USDA 食物（`source.baseFdcId`）估算；卡片带「包装标签」徽章。 |
| 常见度 | commonness tier | 常见度（1–5 档，档位越高越常见） | AI 模型估算、人工复核的日常常见程度，写在 `data-src/commonness.csv`，构建时只把整数放进 `foods.json` 的 `commonness`。5 档是最常见（例如西瓜、五花肉、鸡蛋），4 档是很常见，1 档是罕见、进口或小众。普通食物列表先按它从高到低排（已选和置顶的除外）；5 档卡片标「★常见」，4 档标「常见」（`docs/js/ui/foods.js` 的 `COMMON_BADGES`）。 |
| 置顶食物 | pinTop | 置顶营养素列表 | `foods.json` 的 `pinTop` 数组。3 个自有牛奶写的是 `["calcium"]`，未选中时排在钙列表最前面；选中后就进入已选组（`docs/js/core/order.js` 的 `partitionFoods()`）。 |
| 营养素 id | nutrient id | 营养素编号 | `data-src/nutrients.csv` 第一列的英文短名，例如 `vitA`、`calcium`；共 22 个，代码和数据都用它对齐。 |
| 营养素元数据 | nutrient metadata | 营养素信息 | `docs/data/nutrients.json`：中文名、英文名、单位、颜色、维生素或矿物分类，由 `tools/build_foods.py` 生成。 |

## 三、代码与工具

| 术语 | 英文全称 | 中文 | 在本项目里 |
|---|---|---|---|
| ES 模块 | ECMAScript module | ES 模块 | 把脚本拆成几个小文件，浏览器按需要一个个读进来（技术名：ES 模块）。站点不用打包器：`docs/index.html` 用 `<script type="module">` 加载 `docs/js/app.js`，模块之间用 `import` / `export`。 |
| 纯函数模块 | pure module | 纯函数模块 | `docs/js/core/*.js` 不碰页面、不发请求，只按传入的数据算结果，所以 `node --test` 能直接导入测试。 |
| 静态站点 | static site | 静态网站 | 没有服务器端程序，只有 HTML、CSS、JavaScript 和 JSON 文件；任何静态文件服务器都能托管。 |
| GitHub Pages | GitHub Pages | GitHub 页面托管 | 发布方式：直接拿仓库的 `docs/` 目录当网站根目录，所以新文档放在顶层的 `documentation/`，不进 `docs/`。 |
| localStorage | localStorage（Web Storage） | 浏览器本地存储 | 就像你自己的笔记本，只留在这台设备上，不会上传：已选食物、数量和设置存在浏览器里，键名 `mnt.state.v1`（`docs/js/core/state.js`），刷新后还在。 |
| 相对路径 | relative path | 相对路径 | 站内所有链接和请求都不以 `/` 开头，因此放在任何子目录（子路径）下也能用。 |
| node --test | Node.js built-in test runner | Node 自带测试器 | `npm test` 运行 `tests/unit/*.test.mjs`，共 257 个单元测试，不需要安装依赖。 |
| Playwright | Playwright | 浏览器自动化测试工具 | devDependency `@playwright/test`，用本机 Chrome 跑 `tests/e2e/` 的 24 个端到端测试，命令 `npx playwright test`。 |
| 数据构建 | data build | 数据构建 | `tools/build_foods.py` 和 `tools/build_dri.py` 读 `data-src/` 与 `data-raw/`，写出 `docs/data/*.json`；命令 `npm run build:data`。 |
| 校验器 | data validator | 数据校验脚本 | `tools/validate_data.py`，检查列名、数值、排序名单、带骨比例等规则，任何一项不合格就以 exit 1 结束；命令 `npm run validate`。 |
| 开发服务器 | local dev server | 本地预览服务器 | `npm run serve` 用 Python 自带的 `python3 -m http.server 8000 -d docs` 在 `http://localhost:8000/` 提供 `docs/`，看完就关掉。 |
| 图表 | diagram | 图 | `documentation/diagrams/` 里 5 张图，源文件 `<名字>.dot`，渲染成 `<名字>.svg`，由 `npm run docs:diagrams` 生成；不要手改生成的文件。 |
