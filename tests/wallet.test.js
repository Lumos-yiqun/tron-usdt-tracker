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
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          textContent: "",
          disabled: false,
          hidden: false,
          listeners: {},
          classList: { toggle() {} },
          addEventListener(type, handler) { this.listeners[type] = handler; },
          append() {},
        });
      }
      return elements.get(id);
    },
    createElement() { return {}; },
  };
  const window = { ...injections, addEventListener() {}, dispatchEvent() {} };
  const context = vm.createContext({
    window,
    document,
    Event: class Event {},
    crypto: webcrypto,
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
  assert.match(elements.get("walletButton").textContent, /^已连接 /);
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
  vm.runInContext(`state.walletAddress = "${address}"; state.address = "${otherAddress}"; updateAddressContext()`, context);
  assert.equal(elements.get("addressTitle").textContent, "正在查看其他地址");
  assert.equal(elements.get("activeAddress").textContent, otherAddress);
  assert.equal(elements.get("returnWalletButton").hidden, false);
  await elements.get("returnWalletButton").listeners.click();
  assert.equal(context.viewed.value, address);
  vm.runInContext(`state.address = "${address}"; updateAddressContext()`, context);
  assert.equal(elements.get("addressTitle").textContent, "正在分析我的钱包地址");
  assert.equal(elements.get("returnWalletButton").hidden, true);
});
