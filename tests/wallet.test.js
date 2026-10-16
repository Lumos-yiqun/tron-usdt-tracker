const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "../dist/app.js"), "utf8");
const markup = fs.readFileSync(path.join(__dirname, "../dist/index.html"), "utf8");
const address = "TVqciEhqdir53x5fEX8SNf6MuCcaKpKbUc";
const otherAddress = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

function createPage(injections = {}) {
  const elements = new Map();
  const makeClassList = () => {
    const values = new Set();
    return {
      add(value) { values.add(value); },
      remove(value) { values.delete(value); },
      toggle(value, force) { if (force === undefined ? !values.has(value) : force) values.add(value); else values.delete(value); },
      contains(value) { return values.has(value); },
    };
  };
  const document = {
    body: { classList: makeClassList() },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          textContent: "",
          disabled: false,
          hidden: false,
          dataset: {},
          listeners: {},
          classList: makeClassList(),
          addEventListener(type, handler) { this.listeners[type] = handler; },
          setAttribute(name, value) { this[name] = value; },
          focus() { this.focusCount = (this.focusCount || 0) + 1; },
          append() {},
        });
      }
      return elements.get(id);
    },
    createElement() { return {}; },
    addEventListener() {},
  };
  const window = { ...injections, addEventListener() {}, dispatchEvent() {} };
  const context = vm.createContext({
    window,
    document,
    Event: class Event {},
    crypto: webcrypto,
    navigator: injections.navigator || {},
    URLSearchParams,
    setTimeout(callback) { callback(); },
  });
  vm.runInContext(source, context);
  vm.runInContext("viewAddress = async (value) => { globalThis.viewed = { value }; }", context);
  return { context, elements };
}

test("imToken injected tronweb connects without a TronLink provider", async () => {
  const { context, elements } = createPage({ tronweb: { defaultAddress: { base58: address }, fullNode: { host: "https://api.trongrid.io" } } });
  await vm.runInContext("connectWallet()", context);
  assert.equal(context.viewed.value, address);
  assert.equal(elements.get("walletButton").textContent, "已连接");
  assert.equal(elements.get("walletButton").classList.contains("connected"), true);
});

test("TronLink provider still requests account access", async () => {
  const calls = [];
  const provider = { request: async (args) => { calls.push(args.method); return [address]; }, tronWeb: { defaultAddress: { base58: address } } };
  const { context } = createPage({ tron: provider });
  await vm.runInContext("connectWallet()", context);
  assert.deepEqual(calls, ["eth_requestAccounts"]);
  assert.equal(context.viewed.value, address);
});

test("missing TRON wallet shows an actionable message", async () => {
  const { context, elements } = createPage();
  await vm.runInContext("connectWallet()", context);
  assert.match(elements.get("message").textContent, /imToken.*TRON 钱包/);
  assert.equal(elements.get("walletButton").textContent, "连接钱包");
});

test("connected wallet and another address remain clearly distinguished", async () => {
  const { context, elements } = createPage();
  vm.runInContext(`state.walletAddress = "${address}"; state.address = "${otherAddress}"; state.analysisStage = "fees"; updateAddressContext()`, context);
  assert.equal(elements.get("addressMode").textContent, "其他地址 · 只读查询");
  assert.equal(elements.get("addressTitle").textContent, "正在核算手续费");
  assert.equal(elements.get("activeAddress").textContent, otherAddress);
  assert.equal(elements.get("addressLine").hidden, false);
  assert.equal(elements.get("returnWalletButton").hidden, false);
  await elements.get("returnWalletButton").listeners.click();
  assert.equal(context.viewed.value, address);
  vm.runInContext(`state.address = "${address}"; updateAddressContext()`, context);
  assert.equal(elements.get("addressMode").textContent, "当前分析地址");
  assert.equal(elements.get("returnWalletButton").hidden, true);
});

test("full active address can be copied from the small button", async () => {
  const copied = [];
  const { context, elements } = createPage({ navigator: { clipboard: { writeText: async (value) => copied.push(value) } } });
  vm.runInContext(`state.address = "${address}"; updateAddressContext()`, context);
  await elements.get("copyAddressButton").listeners.click();
  assert.deepEqual(copied, [address]);
  assert.equal(elements.get("activeAddress").textContent, address);
});

test("other-address input opens on demand and validates before closing", async () => {
  const { context, elements } = createPage();
  elements.get("openAddressDialog").listeners.click();
  assert.equal(elements.get("addressDialog").hidden, false);
  elements.get("addressInput").value = "invalid";
  await elements.get("addressForm").listeners.submit({ preventDefault() {} });
  assert.equal(elements.get("addressDialog").hidden, false);
  assert.match(elements.get("addressDialogError").textContent, /TRON 地址/);
  elements.get("addressInput").value = otherAddress;
  await elements.get("addressForm").listeners.submit({ preventDefault() {} });
  assert.equal(elements.get("addressDialog").hidden, true);
  assert.equal(context.viewed.value, otherAddress);
});

test("mobile address dialog does not open the keyboard immediately", () => {
  const { context, elements } = createPage({ matchMedia: (query) => ({ matches: query === "(max-width: 640px)" }) });
  elements.get("openAddressDialog").listeners.click();
  assert.equal(elements.get("addressDialog").hidden, false);
  assert.equal(vm.runInContext('el("addressInput").focusCount || 0', context), 0);
});

test("fee analysis keeps results in loading state instead of displaying zero", () => {
  const { context, elements } = createPage();
  vm.runInContext(`state.address = "${address}"; clearReport(); setAnalysisLoading(true); setAnalysisStage("fees")`, context);
  assert.equal(elements.get("addressTitle").textContent, "正在核算手续费");
  assert.equal(elements.get("inValue").textContent, "—");
  assert.equal(elements.get("ledgerCount").textContent, "同步中");
  assert.equal(elements.get("summaryGrid").classList.contains("is-loading"), true);
  assert.equal(elements.get("reportSurface").classList.contains("is-loading"), true);
});

test("monthly fee total and details appear in one report card", () => {
  const report = markup.split('id="reportSurface"')[1]?.split("</article>")[0] || "";
  assert.doesNotMatch(markup, /id="feeValue"/);
  for (const id of ["reportFee", "feeSubtitle", "reportEnergyFee", "reportNetFee", "reportBreakdownStatus", "reportTxCount", "reportAverage"]) {
    assert.match(report, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(report, /id="reportEnergy"|消耗 Energy/);
  assert.match(report, /平均每笔手续费/);
});

test("fee components use chain-provided sun values and keep other fees separate", () => {
  const { context, elements } = createPage();
  const parts = vm.runInContext("feeBreakdown({ energy_fee: 340000, net_fee: 5000 }, 350000)", context);
  assert.deepEqual(JSON.parse(JSON.stringify(parts)), { energyFee: 0.34, netFee: 0.005, otherFee: 0.005 });
  assert.equal(vm.runInContext("feeBreakdown({}, 350000)", context), null);
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("feeBreakdown({ receipt: {} }, 0)", context))), { energyFee: 0, netFee: 0, otherFee: 0 });
  vm.runInContext(`
    state.fees.set("tx-1", { paidByAddress: true, trx: 0.35, breakdown: feeBreakdown({ energy_fee: 340000, net_fee: 5000 }, 350000) });
    renderReport(["tx-1"], 0, 0);
  `, context);
  assert.equal(elements.get("reportFee").textContent, "0.35");
  assert.equal(elements.get("reportEnergyFee").textContent, "0.34 TRX");
  assert.equal(elements.get("reportNetFee").textContent, "0.0050 TRX");
  assert.equal(elements.get("reportOtherFee").textContent, "0.0050 TRX");
  assert.equal(elements.get("reportOtherFeeItem").hidden, false);
});

test("unverified components are not inferred from the total fee", () => {
  const { context, elements } = createPage();
  vm.runInContext(`
    state.fees.set("tx-1", { paidByAddress: true, trx: 0.35, breakdown: null });
    renderReport(["tx-1"], 0, 0, true);
  `, context);
  assert.equal(elements.get("reportFee").textContent, "0.35");
  assert.equal(elements.get("reportEnergyFee").textContent, "核算中");
  assert.match(elements.get("reportBreakdownStatus").textContent, /已核实 0\/1 笔/);
});

test("batch fee components populate the monthly report without receipt requests", async () => {
  const { context, elements } = createPage();
  const timestamp = new Date();
  const month = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, "0")}`;
  elements.get("monthSelect").value = month;
  vm.runInContext(`
    state.address = "${address}";
    state.addressHex = "41abc";
    state.transfers = [{ from: "${address}", to: "${otherAddress}", value: "1000000", block_timestamp: ${timestamp.getTime()}, transaction_id: "tx-1" }];
    fetchOutgoingTransactions = async () => ({ complete: true, transactions: new Map([["tx-1", { ret: [{ fee: 350000 }], energy_fee: 340000, net_fee: 10000, raw_data: { contract: [{ parameter: { value: { owner_address: "41abc" } } }] } }]]) });
    apiPost = async () => { throw new Error("unexpected receipt request"); };
  `, context);
  await vm.runInContext("loadFees(0)", context);
  assert.equal(elements.get("reportEnergyFee").textContent, "0.34 TRX");
  assert.equal(elements.get("reportNetFee").textContent, "0.01 TRX");
  assert.equal(elements.get("reportStatus").textContent, "已核算");
  assert.match(elements.get("ledgerBody").innerHTML, /Energy 0\.34 · 带宽 0\.01/);
});

test("missing batch components are filled from a receipt", async () => {
  const { context, elements } = createPage();
  vm.runInContext(`
    state.fees.set("tx-1", { paidByAddress: true, trx: 0.35, breakdown: null });
    apiPost = async () => ({ id: "tx-1", fee: 350000, receipt: { energy_fee: 340000, net_fee: 10000 } });
  `, context);
  await vm.runInContext("hydrateReceipts(['tx-1'], ['tx-1'], 0, 0)", context);
  assert.equal(elements.get("reportEnergyFee").textContent, "0.34 TRX");
  assert.equal(elements.get("reportNetFee").textContent, "0.01 TRX");
});

test("transfer history stops after six 200-item pages and marks older data incomplete", async () => {
  const { context } = createPage();
  const result = await vm.runInContext(`
    globalThis.pageCalls = 0;
    apiGet = async () => {
      pageCalls++;
      return {
        data: Array.from({ length: 200 }, () => ({ type: "Transfer", token_info: { address: USDT }, block_timestamp: Date.now() })),
        meta: { fingerprint: "next-page" }
      };
    };
    fetchTransfers("${address}");
  `, context);
  assert.equal(context.pageCalls, 6);
  assert.equal(result.transfers.length, 1200);
  assert.equal(result.truncated, true);
});

test("fee report caps verification at 200 outgoing transactions", async () => {
  const { context, elements } = createPage();
  const timestamp = new Date();
  const month = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, "0")}`;
  const rows = Array.from({ length: 250 }, (_, index) => ({
    from: address,
    to: otherAddress,
    value: "1000000",
    block_timestamp: timestamp.getTime(),
    transaction_id: index.toString(16).padStart(64, "0"),
  }));
  elements.get("monthSelect").value = month;
  vm.runInContext(`
    state.address = "${address}";
    state.transfers = ${JSON.stringify(rows)};
    state.fees = new Map(state.transfers.slice(0, 200).map((row) => [row.transaction_id, { paidByAddress: true, trx: 1, breakdown: { energyFee: 1, netFee: 0, otherFee: 0 } }]));
  `, context);
  await vm.runInContext("loadFees(0)", context);
  assert.equal(elements.get("reportStatus").textContent, "部分数据");
  assert.match(elements.get("feeSubtitle").textContent, /50 笔费用尚未核实/);
});
