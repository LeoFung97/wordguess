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

## 准备语义知识缓存

在 `prepare:fasttext` 之后运行：

```bash
npm run prepare:semantic:setup
npm run prepare:semantic
```

这会处理 `prepare:fasttext` 生成的全部词库（`data/words.json`），并用 fastText 余弦相似度生成近邻同义词边。词库大小由 `prepare:fasttext --top-k` 控制，semantic 不再单独筛词。

`data/raw/` 和大体积原始模型文件默认不会进入 git。

## 大厅模式说明

大厅使用 Socket.IO 和内存状态。房间没有账号系统，也不会持久化；所有玩家离开后房间会被清理。这适合 MVP 和本地部署，后续可以接 Redis 或数据库来支持多实例部署和历史记录。
