const API = "https://api.trongrid.io";
const USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const API_PAGE_SIZE = 200;
const TRANSFER_PAGE_LIMIT = 6;
const OUTGOING_PAGE_LIMIT = 4;
const MONTHLY_FEE_LIMIT = 200;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAINNET = "0x2b6653dc";
const state = { address: "", addressHex: "", transfers: [], fees: new Map(), loading: false, truncated: false, walletProvider: null, walletAddress: "", requestId: 0, analysisStage: "idle", lastUpdated: null };
const el = (id) => document.getElementById(id);
const formatUSDT = (value) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
const formatTRX = (value) => new Intl.NumberFormat("zh-CN", { minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2, maximumFractionDigits: 4 }).format(value);
const formatInteger = (value) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const short = (address) => `${address.slice(0, 6)}…${address.slice(-6)}`;
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function showMessage(message, error = false) {
  const node = el("message");
  node.textContent = message;
  node.classList.toggle("error", error);
  node.hidden = !message;
}

function clearReport() {
  for (const id of ["inValue", "outValue", "feeValue", "reportFee", "reportTxCount", "reportAverage", "reportEnergy"]) el(id).textContent = "—";
  el("inCount").textContent = "正在同步";
  el("outCount").textContent = "正在同步";
  el("feeSubtitle").textContent = "等待链上执行数据";
  el("reportStatus").textContent = "分析中";
  el("reportNote").textContent = "手续费以链上执行数据为准；无法核实的交易不会按 0 计算。";
  el("ledgerCount").textContent = "同步中";
  el("ledgerBody").innerHTML = '<tr><td colspan="5" class="table-empty">正在同步链上流水…</td></tr>';
  el("trendChart").classList.add("empty-chart");
  el("trendChart").innerHTML = '<div class="chart-empty">正在同步链上流水…</div>';
}

function setAnalysisLoading(loading) {
  for (const id of ["summaryGrid", "reportSurface"]) {
    el(id).classList.toggle("is-loading", loading);
    el(id).setAttribute("aria-busy", String(loading));
  }
}

function setAnalysisStage(stage) {
  state.analysisStage = stage;
  updateAddressContext();
}

function finishAnalysis(failed, omitted) {
  state.lastUpdated = new Date();
  setAnalysisLoading(false);
  setAnalysisStage((failed + omitted > 0 || selectedMonthIncomplete()) ? "partial" : "complete");
}

function buildMonths() {
  const select = el("monthSelect");
  const now = new Date();
  for (let offset = 0; offset < 12; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const option = document.createElement("option");
    option.value = monthKey(date);
    option.textContent = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
    select.append(option);
  }
}

async function decodeAddress(address) {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw new Error("请输入有效的 TRON 地址（T 开头，共 34 位）。");
  let number = 0n;
  for (const char of address) number = number * 58n + BigInt(ALPHABET.indexOf(char));
  const bytes = new Uint8Array(25);
  for (let i = 24; i >= 0; i--) { bytes[i] = Number(number & 255n); number >>= 8n; }
  if (number !== 0n || bytes[0] !== 0x41) throw new Error("TRON 地址格式不正确。");
  const first = await crypto.subtle.digest("SHA-256", bytes.slice(0, 21));
  const second = new Uint8Array(await crypto.subtle.digest("SHA-256", first));
  if (!bytes.slice(21).every((byte, index) => byte === second[index])) throw new Error("TRON 地址校验失败，请检查是否复制完整。");
  return Array.from(bytes.slice(0, 21), (byte) => byte.toString(16).padStart(2, "0")).join("").toLowerCase();
}

async function apiGet(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await fetch(`${API}${path}`, { headers: { accept: "application/json" } }); }
    catch { throw new Error("链上数据暂时无法获取，请检查网络后重试。"); }
    if (response.status === 429 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(response.status === 429 ? "链上查询过于频繁，请稍后重试。" : "链上数据暂时无法获取，请稍后重试。");
    const data = await response.json();
    if (data.success === false) throw new Error("链上数据暂时无法获取，请稍后重试。");
    return data;
  }
}

async function apiPost(path, value) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try { response = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) }); }
    catch { throw new Error("交易回执暂时无法获取，请检查网络后重试。"); }
    if (response.status === 429 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error("交易回执暂时无法获取。");
    return response.json();
  }
}

async function fetchTransfers(address) {
  const earliest = new Date();
  earliest.setMonth(earliest.getMonth() - 16, 1);
  earliest.setHours(0, 0, 0, 0);
  let fingerprint = "";
  const transfers = [];
  let truncated = false;
  for (let page = 0; page < TRANSFER_PAGE_LIMIT; page++) {
    const params = new URLSearchParams({ only_confirmed: "true", limit: String(API_PAGE_SIZE), contract_address: USDT });
    if (fingerprint) params.set("fingerprint", fingerprint);
    const result = await apiGet(`/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?${params}`);
    const rows = Array.isArray(result.data) ? result.data : [];
    for (const row of rows) {
      if (row.type !== "Transfer" || row.token_info?.address !== USDT) continue;
      if (row.block_timestamp >= earliest.getTime()) transfers.push(row);
    }
    if (rows.length < API_PAGE_SIZE || !result.meta?.fingerprint || (rows.length && rows[rows.length - 1].block_timestamp < earliest.getTime())) break;
    if (page === TRANSFER_PAGE_LIMIT - 1) truncated = true;
    fingerprint = result.meta.fingerprint;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { transfers, truncated };
}

function monthTransfers() {
  const selected = el("monthSelect").value;
  return state.transfers.filter((row) => monthKey(new Date(row.block_timestamp)) === selected);
}

function selectedMonthIncomplete() {
  if (!state.truncated || !state.transfers.length) return false;
  const oldest = Math.min(...state.transfers.map((row) => row.block_timestamp));
  return el("monthSelect").value <= monthKey(new Date(oldest));
}

function renderSummary() {
  const rows = monthTransfers();
  const incoming = rows.filter((row) => row.to === state.address && row.from !== state.address);
  const outgoing = rows.filter((row) => row.from === state.address);
  const sum = (items) => items.reduce((total, row) => total + Number(row.value) / 1e6, 0);
  const incomplete = selectedMonthIncomplete();
  el("inValue").textContent = incomplete && !incoming.length ? "—" : `${formatUSDT(sum(incoming))}${incomplete ? "+" : ""}`;
  el("outValue").textContent = incomplete && !outgoing.length ? "—" : `${formatUSDT(sum(outgoing))}${incomplete ? "+" : ""}`;
  el("inCount").textContent = `${incoming.length}${incomplete ? "+" : ""} 笔转入${incomplete ? " · 数据不完整" : ""}`;
  el("outCount").textContent = `${outgoing.length}${incomplete ? "+" : ""} 笔转出${incomplete ? " · 数据不完整" : ""}`;
  el("ledgerCount").textContent = `${rows.length} 笔`;
  renderTrend();
  renderLedger(rows);
}

function renderTrend() {
  if (state.truncated) {
    el("trendChart").classList.add("empty-chart");
    el("trendChart").innerHTML = '<div class="chart-empty">该地址交易较多，趋势数据不完整</div>';
    return;
  }
  const selected = el("monthSelect").value;
  const [year, month] = selected.split("-").map(Number);
  const months = Array.from({ length: 6 }, (_, index) => new Date(year, month - 6 + index, 1));
  const totals = months.map((date) => {
    const rows = state.transfers.filter((row) => monthKey(new Date(row.block_timestamp)) === monthKey(date));
    return { date, incoming: rows.filter((row) => row.to === state.address && row.from !== state.address).reduce((n, row) => n + Number(row.value) / 1e6, 0), outgoing: rows.filter((row) => row.from === state.address).reduce((n, row) => n + Number(row.value) / 1e6, 0) };
  });
  const max = Math.max(1, ...totals.flatMap((item) => [item.incoming, item.outgoing]));
  const chart = el("trendChart");
  chart.classList.remove("empty-chart");
  chart.innerHTML = totals.map((item) => `<div class="chart-group"><div class="chart-bars"><span class="chart-bar in" style="height:${Math.max(2, item.incoming / max * 100)}%" title="转入 ${formatUSDT(item.incoming)} USDT"></span><span class="chart-bar out" style="height:${Math.max(2, item.outgoing / max * 100)}%" title="转出 ${formatUSDT(item.outgoing)} USDT"></span></div><span class="chart-month">${item.date.getMonth() + 1} 月</span></div>`).join("");
  chart.setAttribute("aria-label", `最近六个月 USDT 收支趋势。${totals.map((item) => `${item.date.getMonth() + 1} 月转入 ${formatUSDT(item.incoming)}，转出 ${formatUSDT(item.outgoing)}`).join("；")}`);
}

function renderLedger(rows) {
  const body = el("ledgerBody");
  if (!rows.length) { body.innerHTML = '<tr><td colspan="5" class="table-empty">这个月还没有 USDT 转账记录</td></tr>'; return; }
  const seenFees = new Set();
  body.innerHTML = rows.slice().sort((a, b) => b.block_timestamp - a.block_timestamp).map((row) => {
    const outgoing = row.from === state.address;
    const counterparty = outgoing ? row.to : row.from;
    const amount = Number(row.value) / 1e6;
    const fee = state.fees.get(row.transaction_id);
    let feeText = "—";
    if (outgoing && fee && !seenFees.has(row.transaction_id)) {
      feeText = fee.paidByAddress ? `${formatTRX(fee.trx)} TRX` : "他人支付";
      seenFees.add(row.transaction_id);
    } else if (outgoing && seenFees.has(row.transaction_id)) feeText = "同笔交易";
    const id = /^[0-9a-fA-F]{64}$/.test(row.transaction_id) ? row.transaction_id : "";
    const date = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(row.block_timestamp));
    return `<tr><td><span class="tx-kind"><span class="tx-dot ${outgoing ? "out" : "in"}">${outgoing ? "↗" : "↙"}</span><a href="https://tronscan.org/#/transaction/${id}" target="_blank" rel="noopener noreferrer">${outgoing ? "转出" : "转入"}</a></span></td><td class="address-cell" title="${escapeHTML(counterparty)}">${escapeHTML(short(counterparty))}</td><td>${date}</td><td class="num ${outgoing ? "amount-out" : "amount-in"}">${outgoing ? "−" : "+"}${formatUSDT(amount)}</td><td class="num">${feeText}</td></tr>`;
  }).join("");
}

async function feeForTransaction(txId) {
  const info = await apiPost("/wallet/gettransactioninfobyid", txId);
  if (!info?.id) throw new Error("交易回执缺失");
  const actualFee = Number(info.fee || 0) / 1e6;
  const energy = Number(info.receipt?.energy_usage_total || 0);
  const tx = await apiPost("/wallet/gettransactionbyid", txId);
  if (!tx?.txID) throw new Error("交易详情缺失");
  const owner = String(tx.raw_data?.contract?.[0]?.parameter?.value?.owner_address || "").toLowerCase();
  if (!owner) throw new Error("无法确认手续费支付方");
  return { paidByAddress: owner === state.addressHex, trx: owner === state.addressHex ? actualFee : 0, energy };
}

async function fetchOutgoingTransactions(address, month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(year, monthNumber - 1, 1).getTime();
  const end = new Date(year, monthNumber, 1).getTime() - 1;
  const transactions = new Map();
  let fingerprint = "";
  for (let page = 0; page < OUTGOING_PAGE_LIMIT; page++) {
    const params = new URLSearchParams({ only_confirmed: "true", only_from: "true", limit: String(API_PAGE_SIZE), min_timestamp: String(start), max_timestamp: String(end) });
    if (fingerprint) params.set("fingerprint", fingerprint);
    const result = await apiGet(`/v1/accounts/${encodeURIComponent(address)}/transactions?${params}`);
    const rows = Array.isArray(result.data) ? result.data : [];
    for (const row of rows) if (row.txID) transactions.set(row.txID, row);
    if (rows.length < API_PAGE_SIZE || !result.meta?.fingerprint) return { transactions, complete: true };
    fingerprint = result.meta.fingerprint;
  }
  return { transactions, complete: false };
}

async function loadFees(requestId) {
  setAnalysisLoading(true);
  setAnalysisStage("fees");
  const outgoing = monthTransfers().filter((row) => row.from === state.address);
  const ids = [...new Set(outgoing.map((row) => row.transaction_id))];
  if (!ids.length) { renderReport([], 0, 0); finishAnalysis(0, 0); return; }
  el("reportStatus").textContent = "核算中";
  el("feeValue").textContent = "…";
  el("reportFee").textContent = "…";
  const selectedIds = ids.slice(0, MONTHLY_FEE_LIMIT);
  const omitted = Math.max(0, ids.length - selectedIds.length);
  if (selectedIds.every((id) => state.fees.has(id) && state.fees.get(id).energy !== null)) {
    renderReport(ids, 0, omitted);
    renderLedger(monthTransfers());
    finishAnalysis(0, omitted);
    return;
  }
  try {
    const { transactions, complete } = await fetchOutgoingTransactions(state.address, el("monthSelect").value);
    if (requestId !== state.requestId) return;
    for (const id of selectedIds) {
      const tx = transactions.get(id);
      if (!tx && complete) {
        state.fees.set(id, { paidByAddress: false, trx: 0, energy: 0 });
        continue;
      }
      const fee = Number(tx?.ret?.[0]?.fee);
      const energy = Number(tx?.energy_usage_total);
      const owner = String(tx?.raw_data?.contract?.[0]?.parameter?.value?.owner_address || "").toLowerCase();
      if (tx && Number.isFinite(fee) && fee >= 0 && owner === state.addressHex) {
        state.fees.set(id, { paidByAddress: true, trx: fee / 1e6, energy: Number.isFinite(energy) && tx.energy_usage_total != null ? energy : null });
      }
    }
    const pending = selectedIds.filter((id) => !state.fees.has(id) || state.fees.get(id).energy === null);
    const missingFees = selectedIds.filter((id) => !state.fees.has(id)).length;
    renderReport(ids, missingFees, omitted, pending.length > 0);
    renderLedger(monthTransfers());
    if (!missingFees) finishAnalysis(0, omitted);
    if (!pending.length) return;
  } catch {
    if (requestId !== state.requestId) return;
    el("feeSubtitle").textContent = "批量查询不可用，正在逐笔核算";
  }
  // The account transaction list contains fees and Energy. Query receipts only
  // when a batch entry is missing or lacks the fields needed for this report.
  void hydrateReceipts(ids, selectedIds, omitted, requestId);
}

async function hydrateReceipts(ids, selectedIds, omitted, requestId) {
  const pendingIds = selectedIds.filter((id) => !state.fees.has(id) || state.fees.get(id).energy === null);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(2, pendingIds.length) }, async () => {
    while (cursor < pendingIds.length) {
      const id = pendingIds[cursor++];
      try {
        const current = state.fees.get(id);
        let fee;
        if (current) {
          if (current.energy !== null) continue;
          const info = await apiPost("/wallet/gettransactioninfobyid", id);
          if (info?.id !== id) throw new Error("交易回执缺失");
          fee = { ...current, energy: Number(info.receipt?.energy_usage_total || 0) };
        } else fee = await feeForTransaction(id);
        if (requestId !== state.requestId) return;
        state.fees.set(id, fee);
      } catch { /* Keep the fee unknown; retry once after the first pass. */ }
    }
  });
  await Promise.all(workers);
  if (requestId !== state.requestId) return;
  for (const id of selectedIds.filter((id) => !state.fees.has(id))) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    try { state.fees.set(id, await feeForTransaction(id)); } catch { /* Show an incomplete report below. */ }
    if (requestId !== state.requestId) return;
  }
  const failed = selectedIds.filter((id) => !state.fees.has(id)).length;
  renderReport(ids, failed, omitted);
  renderLedger(monthTransfers());
  finishAnalysis(failed, omitted);
}

function renderReport(ids, failed, omitted, energyLoading = false) {
  const known = ids.map((id) => state.fees.get(id)).filter(Boolean);
  const total = known.reduce((sum, item) => sum + item.trx, 0);
  const knownEnergy = known.filter((item) => item.energy !== null);
  const energy = knownEnergy.reduce((sum, item) => sum + item.energy, 0);
  const unresolved = failed + omitted;
  const incomplete = selectedMonthIncomplete();
  el("feeValue").textContent = unresolved || incomplete ? `${formatTRX(total)}+` : formatTRX(total);
  el("reportFee").textContent = unresolved || incomplete ? `${formatTRX(total)}+` : formatTRX(total);
  el("reportTxCount").textContent = `${ids.length}${incomplete ? "+" : ""} 笔`;
  el("reportAverage").textContent = known.length ? `${formatTRX(total / known.length)} TRX` : "—";
  el("reportEnergy").textContent = knownEnergy.length ? `${formatInteger(energy)}${knownEnergy.length < known.length ? "+" : ""}` : energyLoading ? "同步中" : "—";
  el("reportStatus").textContent = unresolved || incomplete ? "部分数据" : knownEnergy.length < known.length ? "费用已核算" : "已核算";
  el("feeSubtitle").textContent = unresolved ? `${unresolved} 笔费用尚未核实` : `${ids.length} 笔转出交易费用已核算${incomplete ? " · 流水不完整" : ""}`;
  el("reportNote").textContent = unresolved || incomplete
    ? `${unresolved ? `有 ${unresolved} 笔费用未取得链上执行数据` : ""}${unresolved && incomplete ? "，且" : ""}${incomplete ? "该月流水未全部载入" : ""}；当前金额仅为已核实部分。`
    : knownEnergy.length < known.length
      ? `手续费已按地址交易记录核算；Energy ${energyLoading ? "正在后台同步" : "仅取得部分回执"}。`
    : "实际手续费为该地址发起交易所燃烧的 TRX。使用已有或受委托 Energy 时，仍会记录资源消耗，但不计为 TRX 支出。";
}

function updateAddressContext() {
  const hasAddress = Boolean(state.address);
  const isOwnWallet = hasAddress && state.address === state.walletAddress;
  const isOtherAddress = hasAddress && Boolean(state.walletAddress) && !isOwnWallet;
  const mode = el("addressMode");
  const title = el("addressTitle");
  const description = el("addressDescription");
  const activeAddress = el("activeAddress");
  const status = el("addressStatus");
  const icon = el("addressStatusIcon");
  const stage = state.analysisStage;
  mode.textContent = isOtherAddress ? "其他地址 · 只读查询" : hasAddress && !isOwnWallet ? "当前分析地址 · 只读查询" : "当前分析地址";
  activeAddress.textContent = hasAddress ? state.address : "";
  el("addressLine").hidden = !hasAddress;
  el("returnWalletButton").hidden = !isOtherAddress;
  status.dataset.stage = stage;
  icon.className = `status-mark ${stage}`;
  icon.textContent = stage === "complete" ? "✓" : stage === "partial" || stage === "error" ? "!" : stage === "idle" ? "⌁" : "";
  if (!hasAddress) {
    title.textContent = "连接钱包，自动分析交易";
    description.textContent = "连接钱包后自动查看 USDT 流水和月度手续费。";
  } else if (stage === "transfers") {
    title.textContent = "正在获取交易记录";
    description.textContent = "完成后自动更新本月报告。";
  } else if (stage === "fees") {
    title.textContent = "正在核算手续费";
    description.textContent = "USDT 流水已获取，完成后自动更新本月报告。";
  } else if (stage === "complete") {
    const month = Number(el("monthSelect").value.split("-")[1]);
    title.textContent = `${month} 月账本已更新`;
    const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(state.lastUpdated || new Date());
    description.textContent = `手续费已核算 · 最近更新 ${time}`;
  } else if (stage === "partial") {
    title.textContent = "部分数据已更新";
    description.textContent = "有交易或费用尚未核实，请查看下方报告提示。";
  } else if (stage === "error") {
    title.textContent = "分析暂时失败";
    description.textContent = "链上数据未能载入，请稍后重新查询。";
  } else {
    title.textContent = "准备分析这个地址";
    description.textContent = "即将读取公开链上交易记录。";
  }
}

function openAddressDialog() {
  el("addressDialogError").textContent = "";
  el("addressDialogError").hidden = true;
  el("addressDialog").hidden = false;
  document.body.classList.add("address-dialog-open");
  el("addressInput").focus();
}

function closeAddressDialog() {
  el("addressDialog").hidden = true;
  document.body.classList.remove("address-dialog-open");
  el("openAddressDialog").focus();
}

async function copyAddress() {
  if (!state.address) return;
  try {
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(state.address); copied = true; }
      catch { /* Some wallet browsers deny Clipboard API; try the selection fallback. */ }
    }
    if (!copied) {
      const helper = document.createElement("textarea");
      helper.value = state.address;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      copied = document.execCommand("copy");
      helper.remove();
      if (!copied) throw new Error("复制失败");
    }
    const button = el("copyAddressButton");
    button.classList.add("copied");
    button.setAttribute("aria-label", "已复制");
    button.title = "已复制";
    setTimeout(() => {
      button.classList.remove("copied");
      button.setAttribute("aria-label", "复制地址");
      button.title = "复制地址";
    }, 1600);
  } catch {
    showMessage("复制失败，请长按地址选择复制。", true);
  }
}

async function viewAddress(address) {
  const trimmed = address.trim();
  const hex = await decodeAddress(trimmed);
  const requestId = ++state.requestId;
  state.address = trimmed;
  state.addressHex = hex;
  state.transfers = [];
  state.fees = new Map();
  state.loading = true;
  state.truncated = false;
  state.lastUpdated = null;
  clearReport();
  setAnalysisLoading(true);
  el("addressInput").value = "";
  setAnalysisStage("transfers");
  showMessage("");
  try {
    const result = await fetchTransfers(trimmed);
    if (requestId !== state.requestId) return;
    state.transfers = result.transfers;
    state.truncated = result.truncated;
    state.loading = false;
    renderSummary();
    showMessage(result.truncated ? `该地址交易较多，仅载入最近 ${TRANSFER_PAGE_LIMIT * API_PAGE_SIZE} 笔。较早月份的统计可能不完整。` : "");
    await loadFees(requestId);
  } catch (error) {
    if (requestId !== state.requestId) return;
    state.loading = false;
    setAnalysisLoading(false);
    setAnalysisStage("error");
    el("inCount").textContent = "数据未载入";
    el("outCount").textContent = "数据未载入";
    el("ledgerCount").textContent = "未载入";
    el("reportStatus").textContent = "加载失败";
    el("ledgerBody").innerHTML = '<tr><td colspan="5" class="table-empty">链上数据暂时无法获取，请稍后重试</td></tr>';
    el("trendChart").innerHTML = '<div class="chart-empty">链上数据暂时无法获取</div>';
    showMessage(error.message || "加载失败，请稍后重试。", true);
    throw error;
  }
}

function discoverWallet() {
  if (state.walletProvider) return state.walletProvider;
  if (window.tron?.request) state.walletProvider = window.tron;
  window.dispatchEvent(new Event("TIP6963:requestProvider"));
  return state.walletProvider;
}

function injectedTronWeb() {
  return [window.tronweb, window.tronWeb, window.tron?.tronWeb, window.tronLink?.tronWeb]
    .find((wallet) => typeof wallet?.defaultAddress?.base58 === "string" && wallet.defaultAddress.base58);
}

async function connectWallet() {
  const button = el("walletButton");
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "连接中…";
  showMessage("正在读取钱包地址…");
  let connected = false;
  try {
    let provider;
    let tronWeb;
    for (let attempt = 0; attempt < 6; attempt++) {
      provider = discoverWallet();
      tronWeb = injectedTronWeb();
      if (provider || tronWeb) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!provider && !tronWeb) throw new Error("未检测到 TRON 钱包。请在 imToken 中切换到 TRON 钱包并从“浏览”页打开本站，或使用 TronLink；也可点“分析其他地址”手动查询。");
    let address = tronWeb?.defaultAddress?.base58;
    if (provider) {
      showMessage("请在钱包中确认连接…");
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      address = accounts?.[0] || provider.tronWeb?.defaultAddress?.base58 || address;
      tronWeb = provider.tronWeb || tronWeb;
    }
    if (!address) throw new Error("钱包未返回地址，请解锁后重试。");
    const host = String(tronWeb?.fullNode?.host || "").toLowerCase();
    if (/shasta|nile/.test(host)) throw new Error("请先在钱包中切换到 TRON 主网。");
    await decodeAddress(address);
    state.walletAddress = address;
    button.textContent = "已连接";
    button.classList.add("connected");
    connected = true;
    await viewAddress(address);
  } catch (error) {
    showMessage(error?.code === 4001 ? "你已取消连接钱包。仍可点“分析其他地址”只读查看。" : (error.message || "钱包连接失败，请重试。"), true);
  } finally {
    button.disabled = false;
    if (!connected) {
      button.textContent = state.walletAddress ? "已连接" : "连接钱包";
      button.classList.toggle("connected", Boolean(state.walletAddress));
    }
  }
}

function registerWebMCP() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const tools = [
    { name: "view_tron_usdt_address", title: "查看 TRON USDT 账本", description: "按 TRON 主网地址加载 USDT 账本和当前月份手续费报告。只读取公开链上数据。", inputSchema: { type: "object", properties: { address: { type: "string" } }, required: ["address"], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, async execute(input) { if (!input || typeof input.address !== "string") throw new Error("需要 TRON 地址"); await viewAddress(input.address); return { address: state.address, month: el("monthSelect").value, transfers: monthTransfers().length }; } },
    { name: "select_ledger_month", title: "选择账本月份", description: "在已加载的账本中选择近 12 个月的一个月份，并更新月度报告。", inputSchema: { type: "object", properties: { month: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" } }, required: ["month"], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, async execute(input) { if (!state.address) throw new Error("请先选择地址"); if (!input || ![...el("monthSelect").options].some((option) => option.value === input.month)) throw new Error("月份不在可选范围内"); el("monthSelect").value = input.month; const requestId = ++state.requestId; renderSummary(); await loadFees(requestId); return { address: state.address, month: input.month, transfers: monthTransfers().length, feeTRX: el("reportFee").textContent }; } }
  ];
  for (const tool of tools) Promise.resolve(context.registerTool(tool)).catch(() => {});
}

window.addEventListener("TIP6963:announceProvider", (event) => {
  if (event.detail?.info?.rdns === "org.tronlink.www" || event.detail?.info?.name === "TronLink") state.walletProvider = event.detail.provider;
});
buildMonths();
discoverWallet();
registerWebMCP();
el("walletButton").addEventListener("click", connectWallet);
el("openAddressDialog").addEventListener("click", openAddressDialog);
el("closeAddressDialog").addEventListener("click", closeAddressDialog);
el("addressDialogBackdrop").addEventListener("click", closeAddressDialog);
el("copyAddressButton").addEventListener("click", copyAddress);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !el("addressDialog").hidden) closeAddressDialog();
});
el("returnWalletButton").addEventListener("click", async () => {
  if (!state.walletAddress) return;
  try { await viewAddress(state.walletAddress); } catch (error) { showMessage(error.message || "返回钱包地址失败，请重试。", true); }
});
el("addressForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const address = el("addressInput").value.trim();
  try { await decodeAddress(address); }
  catch (error) {
    el("addressDialogError").textContent = error.message || "地址格式不正确。";
    el("addressDialogError").hidden = false;
    return;
  }
  closeAddressDialog();
  try { await viewAddress(address); } catch (error) { showMessage(error.message || "地址查询失败。", true); }
});
el("monthSelect").addEventListener("change", async () => {
  if (!state.address || state.loading) return;
  const requestId = ++state.requestId;
  renderSummary();
  await loadFees(requestId);
});
