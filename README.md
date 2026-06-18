# 字距 Chinese Semantle

一个中文 Semantle 风格的语义猜词游戏。玩家输入词库中的词，系统用词向量余弦相似度判断它和隐藏目标词的距离。

## 功能

- 单人模式：独立猜一个隐藏的中文词。
- 大厅模式：创建房间并分享链接，多人实时猜同一个目标词。
- 现代中文界面：响应式布局、相似度进度条、冷热反馈、猜词历史。
- fastText 管线：使用 Facebook fastText 中文词向量（300 维）与 SUBTLEX-CH 词频交集构建 5 万词语义词库。

## 开发

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 脚本

```bash
npm run test
npm run lint
npm run build
```

## 准备词向量

游戏使用 fastText 中文词向量（`cc.zh.300`，300 维）与 `data/raw/multi_domain_total_word_freq.txt` 词频表生成交集词库。

支持的词频表格式：
- 带表头：`token` + `count`（或 `Word` + `WCount`，tab/逗号分隔）
- 无表头两列：`词\t频率`
- 单列：每行一个词，越靠前越常见

```bash
# 词频表已放在 data/raw/multi_domain_total_word_freq.txt

# 下载 fastText 中文词向量（文本格式，约 1.2GB 压缩）
curl -L -o data/raw/cc.zh.300.vec.gz \
  "https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.zh.300.vec.gz"

# 生成交集词库与向量（默认 50k，可改 80k 等）
npm run prepare:fasttext
npm run prepare:fasttext -- --top-k=80k
```

预处理会：

- 按词频表从高到低遍历。
- 跳过不在 fastText 词表中的词，继续取下一个。
- 直到凑满 `--top-k` 个有向量的词（如 `50k`、`80k`）。
- 写入 `data/words.json` 与 `data/vectors.f32`。

目标词仍由 `data/target-words.json` 控制（二字词）；猜词接受词库中 1 到 4 字的词。

## 准备目标词列表

在 `prepare:fasttext`（以及可选的 `prepare:semantic`）之后，可用 BCC 词频表生成本地可玩的二字目标词候选：

```bash
npm run prepare:targets
npm run prepare:targets:write   # 同时覆盖 data/target-words.json
```

输出：

- `data/generated/target-words-ranked.json` — 按综合分排序的保留词及分数
- `data/generated/target-words-filtered.json` — 被过滤词及原因
- `data/generated/target-words-debug.tsv` — 完整诊断表

`data/generated/` 为可再生的管线输出目录（已在 `.gitignore` 中忽略）。

常用阈值（均可通过 CLI 覆盖）：

```bash
npm run prepare:targets -- --min-frequency-rank=80 --max-frequency-rank=25000 --output-limit=2000
```

综合分以词频为主（默认权重 0.62），并结合可玩性启发式与 embedding / 语义缓存近邻质量重排。`weight-freshness` 预留供后续新语料加成，当前默认为 0。


在 `prepare:fasttext` 之后运行：

```bash
npm run prepare:semantic:setup
npm run prepare:semantic
```

这会处理 `prepare:fasttext` 生成的全部词库（`data/words.json`），并用 fastText 余弦相似度生成近邻同义词边。词库大小由 `prepare:fasttext --top-k` 控制，semantic 不再单独筛词。

`data/raw/` 和大体积原始模型文件默认不会进入 git。

### 语义 artifact 格式（schema v2）

`prepare:semantic` 会写入：

- `data/semantic-word-cache.json` — 每词 OpenHowNet 特征与可选元数据
- `data/semantic-graph.json` — 加权边列表，供运行时 Dijkstra 使用

**Word cache 字段（向后兼容）：**

| 字段 | 说明 |
|------|------|
| `sememes` | 全部义原（核心 + 扩展），旧版 artifact 仍可用 |
| `core_sememes` | 直接挂载义原（主信号） |
| `expanded_sememes` | 树/上位扩展义原（弱信号） |
| `domain` | 主导语义域，如 `weather/climate` |
| `usage_bias` | `literal` / `figurative` / `mixed` / `unknown` |
| `sense_count` | OpenHowNet 义项数 |
| `synonyms` / `concepts` / `synonym_weights` | 同现有逻辑 |

旧 artifact 缺少新字段时，运行时会回退：`core_sememes` ← `sememes`，`domain` ← `abstract/general`。

**重建步骤（部署前离线执行一次）：**

```bash
npm run prepare:fasttext          # 若词库/向量有变
npm run prepare:semantic:setup    # 首次或依赖变更
npm run prepare:semantic          # 重建 cache + graph
npm run test
```

**调试某对 (目标, 猜测) 的打分组成：**

```bash
tsx scripts/explain-hybrid-score.ts 气候 天气
```

运行时仅读取预构建 JSON，不在 Railway 上调用 OpenHowNet 或写持久化文件。

## 大厅模式说明

大厅使用 Socket.IO 和内存状态。房间没有账号系统，也不会持久化；所有玩家离开后房间会被清理。这适合 MVP 和本地部署，后续可以接 Redis 或数据库来支持多实例部署和历史记录。
