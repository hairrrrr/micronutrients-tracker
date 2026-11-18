# 文档目录

这里是本项目的说明文档。页面本身在 `docs/`，文档放在顶层的 `documentation/`
（GitHub Pages 只发布 `docs/`，所以文档不会出现在网站上）。

## 从这里开始

第一次接触这个项目、也不写代码：先看 `EXPLAINED.md`，再看术语表，遇到不认识的词就查。

想改代码或数据：按下面的顺序读，`ARCHITECTURE.md` 讲整体结构，
`KEY_IMPLEMENTATION.md` 讲关键算法，最后回到 `GLOSSARY.md` 对词。

## 目录

| 文档 | 一句话说明 |
|---|---|
| [`../README.md`](../README.md) | 项目首页：这个网站做什么、数据来源、怎么在本地运行和跑测试。 |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 架构：整体结构和三张图（总览、数据构建、模块划分），每个文件夹和数据文件的字段。 |
| [`KEY_IMPLEMENTATION.md`](KEY_IMPLEMENTATION.md) | 关键实现：目标查找、摄入合计、家庭计量与带骨换算、排序、详情排名、数据构建规则和测试策略。 |
| [`EXPLAINED.md`](EXPLAINED.md) | 入门讲解：写给没写过代码的人，用真实数字走一遍「点一个食物到卡片上的数字」。 |
| [`GLOSSARY.md`](GLOSSARY.md) | 术语表：DRI、RNI、AI、UL、RAE、NE、DFE、常见度、包装标签等词的中文解释和在本项目里的含义。 |
| [`diagrams/`](diagrams/) | 图表：`build.mjs` 加 5 张图（`overview`、`data-build`、`modules`、`ordering`、`intake`），源文件 `.dot`，渲染结果 `.svg`。 |

## 看图说明

图都用 `documentation/diagrams/build.mjs` 生成，改了图要运行 `npm run docs:diagrams`。
每张图自带图例：黄色是输入和输出，蓝色是本项目代码，绿色是外部来源，
红色是被拒绝或出错的分支，紫色圆柱是存储的数据。显示图的文档里会再写一次这个图例。
