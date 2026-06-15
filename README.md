# 字距 Chinese Semantle

一个中文 Semantle 风格的语义猜词游戏。玩家输入词库中的词，系统用词向量余弦相似度判断它和隐藏目标词的距离。

## 功能

- 单人模式：独立猜一个隐藏的中文词。
- 大厅模式：创建房间并分享链接，多人实时猜同一个目标词。
- 现代中文界面：响应式布局、相似度进度条、冷热反馈、猜词历史。
- Word2Vec 管线：使用腾讯 AI Lab 中文词向量（200 维）构建词语义词库。

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

游戏使用腾讯 AI Lab 中文词向量（200 维）。默认使用 text2vec 提供的轻量版（约 14 万词）；如有官方全量文件也可切换。

```bash
# 1. 下载轻量版腾讯词向量（111MB，ModelScope 镜像）
curl -L -o data/raw/light_Tencent_AILab_ChineseEmbedding.bin \
  "https://www.modelscope.cn/models/lili666/text2vec-word2vec-tencent-chinese/resolve/master/light_Tencent_AILab_ChineseEmbedding.bin"

# 2. 提取全部词条，生成运行时词库
npm run prepare:tencent
```

如有官方全量 `Tencent_AILab_ChineseEmbedding.txt`（约 880 万词条），可改用：

```bash
npm run prepare:tencent:full
```

预处理会：

- 扫描腾讯词向量文件中的全部词条。
- 保留数据集中的 1 到 4 字词（更长的词会被跳过）。
- 默认只保留最常见的 10,000 个四字词，把总数据量控制在 100MB 以下；可用 `--max-four-char-words=0` 去掉全部四字词，或 `--max-four-char-words=17450` 尽量填满预算。
- 跳过文件头与无效行。
- 归一化向量，方便运行时快速计算余弦相似度。

目标词仍由 `data/target-words.json` 控制（二字词）；猜词接受词库中 1 到 4 字的词。

`data/raw/` 和大体积原始模型文件默认不会进入 git。

## 大厅模式说明

大厅使用 Socket.IO 和内存状态。房间没有账号系统，也不会持久化；所有玩家离开后房间会被清理。这适合 MVP 和本地部署，后续可以接 Redis 或数据库来支持多实例部署和历史记录。
