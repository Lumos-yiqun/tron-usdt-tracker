const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "../dist/app.js"), "utf8");
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
          focus() {},
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

test("fee analysis keeps results in loading state instead of displaying zero", () => {
  const { context, elements } = createPage();
  vm.runInContext(`state.address = "${address}"; clearReport(); setAnalysisLoading(true); setAnalysisStage("fees")`, context);
  assert.equal(elements.get("addressTitle").textContent, "正在核算手续费");
  assert.equal(elements.get("inValue").textContent, "—");
  assert.equal(elements.get("ledgerCount").textContent, "同步中");
  assert.equal(elements.get("summaryGrid").classList.contains("is-loading"), true);
  assert.equal(elements.get("reportSurface").classList.contains("is-loading"), true);
});
