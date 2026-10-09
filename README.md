# 维达知识助手（扫码版）

这是面向客户经理的静态知识问答页面。知识数据以 PBKDF2 + AES-GCM 加密后发布，邀请码不会写入网页源码。问答支持业务域约束、排除词、连续追问和低置信度转人工。

站点通过 GitHub Pages 发布。更新知识后，使用 `scripts/encrypt-knowledge.mjs` 在本地重新生成 `knowledge.enc.json` 再提交；不要向仓库提交明文知识数据、邀请码或其他凭据。
