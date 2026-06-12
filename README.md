# 字距 Chinese Semantle

一个中文 Semantle 风格的语义猜词游戏。玩家输入两个汉字的常用词，系统用词向量余弦相似度判断它和隐藏目标词的距离。

## 功能

- 单人模式：独立猜一个隐藏的二字中文词。
- 大厅模式：创建房间并分享链接，多人实时猜同一个目标词。
- 现代中文界面：响应式布局、相似度进度条、冷热反馈、猜词历史。
- Word2Vec 管线：先使用小型示例词库开发，可从公开中文词向量中预处理常用二字词。

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

MVP 默认使用 `data/sample-words.json`，方便立即运行。准备真实词库时，可以下载公开中文词向量，例如 Tencent AI Lab Chinese Embeddings，并把原始文件放在 `data/raw/`。

```bash
npm run prepare:vectors -- --input=data/raw/tencent-ailab-embedding.txt --common=data/common-words.txt --output=data/prepared-words.json --limit=5000
```

预处理会：

- 只保留两个汉字的词。
- 只保留常用词列表中的词。
- 跳过数字、拉丁字符、标点和短语分隔符。
- 归一化向量，方便运行时快速计算余弦相似度。

`data/raw/` 和大体积原始模型文件默认不会进入 git。

## 大厅模式说明

大厅使用 Socket.IO 和内存状态。房间没有账号系统，也不会持久化；所有玩家离开后房间会被清理。这适合 MVP 和本地部署，后续可以接 Redis 或数据库来支持多实例部署和历史记录。
