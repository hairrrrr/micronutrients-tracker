# 文档目录

这里是本项目的说明文档。页面本身在 `docs/`，文档放在顶层的 `documentation/`
（GitHub Pages 只发布 `docs/`，所以文档不会出现在网站上）。

## 从这里开始

完全不写代码的人可以直接从 `EXPLAINED.md` 开始。想了解数字是怎么算出来的、或想改代码和数据的人：
先看整体结构（`ARCHITECTURE.md`），再看具体算法（`KEY_IMPLEMENTATION.md`），
遇到不认识的词随时回术语表（`GLOSSARY.md`）查。

## 目录

| 文档 | 一句话说明 |
|---|---|
| [`../README.md`](../README.md) | 项目首页：这个网站做什么、数据来源、怎么在本地运行和跑测试。 |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 架构：整体结构和三张图（总览、数据构建、模块划分），每个文件夹和数据文件的字段。 |
| [`KEY_IMPLEMENTATION.md`](KEY_IMPLEMENTATION.md) | 关键实现：目标查找、摄入合计、家庭计量与带骨换算、排序、详情排名、数据构建规则和测试策略。 |
| [`EXPLAINED.md`](EXPLAINED.md) | 入门讲解：写给没写过代码的人，用真实数字走一遍「点一个食物到卡片上的数字」。 |
| [`GLOSSARY.md`](GLOSSARY.md) | 术语表：DRI、RNI、AI、UL、RAE、NE、DFE、常见度、包装标签等词的中文解释和在本项目里的含义。 |
| [`diagrams/`](diagrams/) | 图表：`build.mjs` 加 5 张图（`overview`、`data-build`、`modules`、`ordering`、`intake`），源文件 `.dot`，渲染结果 `.svg`。 |

## 改完文档检查一下

文档里的相对链接、图片路径，以及用反引号写出来的仓库路径，都可以用 `npm run docs:check`
检查（脚本是 `tools/check_docs.mjs`）。它还会确认 `docs/` 里没有混进说明文档，
因为 GitHub Pages 只发布 `docs/`。有找不到的链接或路径时，脚本会列出文件和问题并以 1 退出。

## 看图说明

图都用 `documentation/diagrams/build.mjs` 生成，改了图要运行 `npm run docs:diagrams`。
每张图自带图例：黄色是输入和输出，蓝色是本项目代码，绿色是外部来源，
红色是被拒绝或出错的分支，紫色圆柱是存储的数据。显示图的文档里会再写一次这个图例。

遇到不认识的词，随时回术语表（[`GLOSSARY.md`](GLOSSARY.md)）查。
