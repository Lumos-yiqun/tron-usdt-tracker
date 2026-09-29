# TRON USDT 记账本

一个只读的 TRON-USDT 地址账本 MVP。支持连接 TronLink，或输入地址查看公开链上流水、月度收支和手续费报告。页面适配桌面与移动端。

## 本地运行

项目是静态网页，无需构建。使用任意本地 HTTP 服务打开 `dist/`，例如：

```sh
python3 -m http.server 8765 --directory dist
```

然后访问 `http://localhost:8765/`。钱包连接需在安装了 TronLink 的浏览器或 TronLink 内置浏览器中使用。

## 数据与限制

- 仅统计 TRON 主网的 USDT（TRC-20）转账。
- 流水和交易回执来自公开的 TronGrid 接口；公开接口限流时，页面会提示数据不完整。
- 月度手续费统计该地址发起交易实际支付的 TRX。已使用或获委托的 Energy 不会计为 TRX 支出。
- 高频地址最多加载最近 800 笔流水，较早月份可能不完整；页面会标明这一情况。
- 本项目只读，不请求转账签名，也不保存钱包私钥。

站点部署配置保存在 `.openai/hosting.json`。
