# 部署指南

本仓库的站点是**纯静态文件**：没有框架、没有打包器、没有构建步骤，也没有任何 GitHub Actions 工作流。
GitHub Pages 直接从 `main` 分支的 `/docs` 文件夹发布这些文件。也就是说，`docs/` 里提交了什么，
线上就是什么；推送 `main` 之后一两分钟内自动更新。

- 仓库：`hairrrrr/micronutrients-tracker`（public）
- 线上地址：`https://hairrrrr.github.io/micronutrients-tracker/`
- 站点目录：`docs/`（`docs/index.html`、`docs/css/`、`docs/js/`、`docs/data/*.json`）
- 计划中的最终域名：`micronutrients.lianboji.club`（见第 3 节，暂未启用）

---

## 1. GitHub Pages 设置（一次性）

1. 打开仓库页面，进入 **Settings**。
2. 左侧选择 **Pages**。
3. 在 **Build and deployment** 下，**Source** 选择 **Deploy from a branch**。
4. **Branch** 选择 `main`，文件夹选择 `/docs`，然后点 **Save**。
5. 等待约 1 分钟，页面顶部会显示发布地址；**Visit site** 可直接打开。

> 不要选择 **GitHub Actions** 作为 Source，本仓库没有也不需要任何 workflow 文件。
> 令牌没有 `workflow` 权限，添加 `.github/workflows/*.yml` 反而会导致推送失败。

发布后的检查（命令）：

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://hairrrrr.github.io/micronutrients-tracker/
curl -s -o /dev/null -w '%{http_code}\n' https://hairrrrr.github.io/micronutrients-tracker/data/foods.json
```

两个都应返回 `200`。因为页面全部使用相对路径，站点在 `https://host/` 和
`https://host/任意/子/路径/` 下都能正常工作。

### 线上自检（可选）

`tests/e2e` 的 Playwright 用例默认会自己起本地静态服务器；也可以直接对线上站点跑一遍：

```sh
BASE_URL=https://hairrrrr.github.io/micronutrients-tracker/ npx playwright test
```

---

## 2. 在本地重建数据并验证（每次推送前）

站点的数据文件 `docs/data/foods.json`、`docs/data/dri.json`、`docs/data/nutrients.json`、
`docs/data/meta.json` 都是脚本生成的，**不要手工编辑**。`data-src/` 里的人工输入改动之后，
按下面的顺序重建并检查：

```sh
python3 tools/build_foods.py     # data-src/*.csv + data-raw/ -> docs/data/foods.json, nutrients.json, meta.json
python3 tools/build_dri.py       # data-src/dri/*.csv -> docs/data/dri.json
python3 tools/validate_data.py   # data checks; exits 1 on any failure
npm test                         # unit tests (node --test)
npx playwright test              # e2e smoke tests + screenshots
```

说明：

- `build_foods.py` 需要 `data-raw/` 里的 USDA SR Legacy CSV。如果这台机器上还没有，
  先运行 `bash tools/fetch_usda.sh` 下载并校验（`data-raw/` 不入库）。
- `build_dri.py` 要求 `data-src/dri/*.csv` 的每一行都已填写 `verified_by`，否则会拒绝写入
  （这是有意的保护）。没有权限填值时可以用 `python3 tools/build_dri.py --allow-unverified`
  只做校验，它不会写 `docs/`。
- 可选的独立抽查：`python3 tools/check_values.py` 会重新读取原始 CSV 并和 `foods.json` 对比。
- 数据没变时，重建结果是字节级一致的；如果 `git status` 里出现 `docs/data/*.json` 的意外改动，
  先确认是不是改动了 `data-src/`。

全部通过后再提交、推送：

```sh
git status
git add -A
git commit -m "chore(data): rebuild data files"
git push origin main
```

推送后 Pages 会自动重新发布，不需要任何构建命令。

---

## 3. 自定义子域名（以后再做，现在不要提前添加）

目标：把站点从 `https://hairrrrr.github.io/micronutrients-tracker/` 改到
`https://micronutrients.lianboji.club/`。这一步涉及 DNS，需要域名所有者在
`lianboji.club` 的 DNS 服务商处操作。

### 3.1 在仓库里添加 CNAME 文件

在 `docs/` 下新建文件 `CNAME`（无扩展名），内容只有一行，结尾换行：

```sh
printf 'micronutrients.lianboji.club\n' > docs/CNAME
```

提交并推送：

```sh
git add docs/CNAME
git commit -m "chore(deploy): add custom domain CNAME"
git push origin main
```

> 现在**不要**添加这个文件：域名解析还没配好时提前加，线上地址会暂时打不开。
> 等 DNS 记录生效后再添加。

### 3.2 在 DNS 服务商处添加 CNAME 记录

在 `lianboji.club` 的 DNS 管理页面新建一条记录：

| 类型 | 主机记录（Name） | 记录值（Value / Target） | TTL |
|---|---|---|---|
| `CNAME` | `micronutrients` | `hairrrrr.github.io` | 默认（如 3600） |

- 主机记录只填 `micronutrients`，不要写成完整域名（多数服务商会自动补上 `.lianboji.club`）。
- 记录值结尾不要加 `.`，也不要写 `https://`。
- 这条记录不要和同名的 `A`/`AAAA` 记录并存。

检查是否生效（命令）：

```sh
dig +short micronutrients.lianboji.club CNAME
```

应输出 `hairrrrr.github.io.`。DNS 通常几分钟生效，偶尔需要几小时。

### 3.3 在 GitHub 上设置自定义域名并开启 HTTPS

1. 仓库 **Settings** -> **Pages**。
2. **Custom domain** 填入 `micronutrients.lianboji.club`，点 **Save**。
   （GitHub 会做一次 DNS 检查；刚加完记录时可能需要等一会儿再点。）
3. 等证书签发完成（通常几分钟到几十分钟），勾选 **Enforce HTTPS**。
4. 建议同时保留默认地址可用，或按需在 **Settings** -> **Pages** 里确认
   `https://hairrrrr.github.io/micronutrients-tracker/` 仍然可访问。

### 3.4 不需要改代码

站点只使用相对路径：`index.html` 里的 `css/…`、`js/…`、`data/…`，
以及 `fetch('data/foods.json')` 之类的请求，都不以 `/` 开头。
因此换域名、换子路径都不需要修改任何代码或配置，`docs/CNAME` 是唯一的额外文件。

### 3.5 回滚

如果自定义域名出问题：

```sh
git rm docs/CNAME
git commit -m "chore(deploy): remove custom domain CNAME"
git push origin main
```

然后在 **Settings** -> **Pages** 里清空 **Custom domain**，站点会回到
`https://hairrrrr.github.io/micronutrients-tracker/`。

---

## 4. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 线上还是旧数据 | Pages 发布有延迟；看 **Settings** -> **Pages** 顶部的最近一次部署状态，或等一两分钟再刷新（可用 `Ctrl/Cmd + Shift + R` 强刷）。 |
| 页面空白、控制台报 404 | 数据文件没提交：确认 `docs/data/foods.json`、`dri.json`、`nutrients.json`、`meta.json` 都在仓库里。 |
| 页面样式丢失 | 检查是不是有以 `/` 开头的路径被引入：详情见第 3.4 节，`docs/` 里不应出现以 `/` 开头的 `src`/`href` 或 `fetch` 路径。 |
| 自定义域名保存后打不开 | DNS 还没生效或主机记录写错；用 3.2 的 `dig` 命令确认，必要时删掉记录重加。 |
| 想加 GitHub Actions | 不需要。本仓库的部署方式就是 branch + `/docs`，也没有 `workflow` 权限。 |
