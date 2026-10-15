# TRON USDT Tracker

一个只读的 TRON-USDT 转账追踪工具。支持连接 imToken 或 TronLink，也可输入地址查看公开链上流水、月度收支和手续费报告。页面适配桌面与移动端。

连接钱包后会自动分析当前钱包地址，页面完整显示分析地址并提供复制按钮。首页的“分析其他地址”会打开地址输入界面；查询其他地址不会切换钱包，可随时返回已连接的钱包地址。分析期间使用加载状态，避免把尚未完成的结果误显示为 0。

在线访问：[tron-usdt-tracker.vercel.app](https://tron-usdt-tracker.vercel.app/)。

## 本地运行

项目是静态网页，无需构建。使用任意本地 HTTP 服务打开 `dist/`，例如：

```sh
python3 -m http.server 8765 --directory dist
```

然后访问 `http://localhost:8765/`。在 imToken 中使用时，请先切换到 TRON 钱包，并从 imToken 的“浏览”页打开网站；也可使用安装了 TronLink 的浏览器或 TronLink 内置浏览器。

## 数据与限制

- 仅统计 TRON 主网的 USDT（TRC-20）转账。
- 流水、交易执行数据和必要的回执来自公开的 TronGrid 接口；公开接口限流时，页面会提示数据不完整。
- 月度手续费统计该地址发起交易实际支付的 TRX。已使用或获委托的 Energy 不会计为 TRX 支出。
- 高频地址最多加载最近 1,200 笔流水，较早月份可能不完整；每月最多核算 200 笔不同的转出交易手续费，超出部分会标明为未核实。页面会标明数据不完整的情况。
- 本项目只读，不请求转账签名，也不保存钱包私钥。

站点部署配置保存在 `.openai/hosting.json`。
