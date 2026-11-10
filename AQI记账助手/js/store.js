/* ============================================================================
 * store.js —— 数据模型 / 持久化
 * 数据保存在浏览器 localStorage；另支持整体导出/导入 JSON 备份。
 * 金额一律用字符串保存（如 "35.50"），绝不经过浮点数。
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Store = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var KEY = 'jizhang.data.v1';
  var VERSION = 1;
  var Util = (typeof window !== 'undefined' && window.Util) || (typeof require !== 'undefined' ? require('./util.js') : null);
  var Money = (typeof window !== 'undefined' && window.Money) || (typeof require !== 'undefined' ? require('./money.js') : null);

  /* ---------------------------------------------------------------- 变更记录
   * 每次「数据修改」都会在同一个 tick 内合并成一条记录；只保存在内存里（不写进
   * localStorage，也不进导出 JSON），刷新页面即清空。
   * 流程：mutator 第一行 mark(label) 捕获改动前快照 → 改动 → 界面 render() 时提交。 */
  var HIST_MAX = 80;
  var _hist = [];            // [{ label, at, state }]（state 是改动前的状态 JSON 串）
  var _open = false;
  var _openLabel = '';
  var _openBefore = null;

  function _snap() { try { return JSON.stringify(Store.state); } catch (e) { return ''; } }

  function defaults() {
    return {
      version: VERSION,
      bills: [],
      trash: [],
      groups: [],
      customCategories: [],
      customRules: [],
      customMerchants: [],
      customSources: [],
      wallets: [],
      transfers: [],
      merchantExcludes: [],
      settings: { currency: '¥', lastSource: 'alipay', hideExcluded: true, exclCollapsed: true, navOrder: [], tutorial: '', updatedAt: null },
      createdAt: Util ? Util.nowISO() : '',
      updatedAt: Util ? Util.nowISO() : ''
    };
  }

  var Store = {
    state: defaults(),
    available: true,
    _adapter: null,
    _listeners: [],

    /* 允许注入存储适配器（便于测试 / 无 localStorage 环境降级） */
    init: function (adapter) {
      this._adapter = adapter || this._defaultAdapter();
      this.available = !!this._adapter;
      this.load();
      return this;
    },

    _defaultAdapter: function () {
      try {
        var t = '__jz_test__';
        localStorage.setItem(t, '1');
        localStorage.removeItem(t);
        return {
          get: function (k) { return localStorage.getItem(k); },
          set: function (k, v) { localStorage.setItem(k, v); },
          remove: function (k) { localStorage.removeItem(k); }
        };
      } catch (e) {
        return null;
      }
    },

    onChange: function (fn) { this._listeners.push(fn); },
    _emit: function () { this._listeners.forEach(function (f) { try { f(); } catch (e) {} }); },

    load: function () {
      _hist = []; _open = false; _openLabel = ''; _openBefore = null;
      if (!this._adapter) { this.state = defaults(); return this.state; }
      try {
        var raw = this._adapter.get(KEY);
        if (!raw) { this.state = defaults(); return this.state; }
        var data = JSON.parse(raw);
        var d = defaults();
        this.state = Object.assign(d, data);
        if (!Array.isArray(this.state.bills)) this.state.bills = [];
        if (!Array.isArray(this.state.trash)) this.state.trash = [];
        if (!Array.isArray(this.state.groups)) this.state.groups = [];
        if (!Array.isArray(this.state.customCategories)) this.state.customCategories = [];
        if (!Array.isArray(this.state.customRules)) this.state.customRules = [];
        if (!Array.isArray(this.state.customMerchants)) this.state.customMerchants = [];
        if (!Array.isArray(this.state.customSources)) this.state.customSources = [];
        if (!Array.isArray(this.state.wallets)) this.state.wallets = [];
        if (!Array.isArray(this.state.transfers)) this.state.transfers = [];
        if (!Array.isArray(this.state.merchantExcludes)) this.state.merchantExcludes = [];
        this.state.settings = Object.assign(d.settings, data.settings || {});
      } catch (e) {
        console.warn('[Store] 读取失败，使用空数据', e);
        this.state = defaults();
      }
      return this.state;
    },

    save: function () {
      this.state.updatedAt = Util ? Util.nowISO() : '';
      if (this._adapter) {
        try { this._adapter.set(KEY, JSON.stringify(this.state)); }
        catch (e) { console.error('[Store] 保存失败（可能是空间已满）', e); return false; }
      }
      this._emit();
      return true;
    },

    /* ---------------------------------------------------------- 变更记录 / 撤销
     * mark() 在每次数据修改前调用，捕获「改之前」的快照；同一 tick 只开一条。
     * 界面 render() 时调用 _commitNow() 收尾，写入历史。 */
    mark: function (label) {
      if (_open) return;                  // 同一批操作只记一次，保留最先给的标签
      _open = true;
      _openLabel = label || '修改';
      _openBefore = _snap();
    },
    _commitNow: function () {
      if (!_open) return;
      _open = false;
      var label = _openLabel, before = _openBefore;
      _openLabel = ''; _openBefore = null;
      var now = _snap();
      if (before !== null && now !== before) {
        _hist.push({ label: label, at: Date.now(), state: before });
        if (_hist.length > HIST_MAX) _hist.shift();
      }
    },
    canUndo: function () { this._commitNow(); return _hist.length > 0; },
    historyCount: function () { this._commitNow(); return _hist.length; },
    historyList: function () {
      this._commitNow();
      return _hist.map(function (h, i) { return { i: i, label: h.label, at: h.at }; }).reverse();
    },
    clearHistory: function () { _hist = []; _open = false; _openLabel = ''; _openBefore = null; },
    _applyState: function (snap) {
      var st = this.state, k;
      for (k in st) if (Object.prototype.hasOwnProperty.call(st, k)) delete st[k];
      for (k in snap) if (Object.prototype.hasOwnProperty.call(snap, k)) st[k] = snap[k];
      this.save();                        // 不 mark：撤销本身不进历史
      return this.state;
    },
    /* 撤销上一步 */
    undo: function () {
      this._commitNow();
      if (!_hist.length) return null;
      var h = _hist.pop();
      this._applyState(JSON.parse(h.state));
      return h;
    },
    /* 回到第 idx 步「之前」（撤销这一条及之后所有记录） */
    revertTo: function (idx) {
      this._commitNow();
      if (idx < 0 || idx >= _hist.length) return null;
      var target = _hist[idx];
      var steps = _hist.length - idx;
      _hist = _hist.slice(0, idx);
      this._applyState(JSON.parse(target.state));
      return { steps: steps, label: target.label };
    },

    /* ---------------------------------------------------------- 账单操作 */
    addBills: function (list) {
      var self = this;
      (list || []).forEach(function (b) {
        if (!b.id) b.id = Util.uid('bill');
        if (!b.createdAt) b.createdAt = Util.nowISO();
        self.state.bills.push(b);
      });
      this.save();
      return list;
    },

    getBill: function (id) {
      return this.state.bills.find(function (b) { return b.id === id; });
    },

    updateBill: function (id, patch) {
      var b = this.getBill(id);
      if (!b) return null;
      Object.assign(b, patch);
      this.save();
      return b;
    },

    updateBills: function (ids, patch) {
      var self = this, set = {};
      ids.forEach(function (i) { set[i] = 1; });
      this.state.bills.forEach(function (b) { if (set[b.id]) Object.assign(b, patch); });
      this.save();
    },

    /* ---------------------------------------------------------- 标签 */
    addTags: function (ids, tags) {
      var set = {}, add = (tags || []).map(function (t) { return String(t).trim(); }).filter(Boolean);
      ids.forEach(function (i) { set[i] = 1; });
      var n = 0;
      this.state.bills.forEach(function (b) {
        if (!set[b.id]) return;
        var t = Array.isArray(b.tags) ? b.tags.slice() : [];
        add.forEach(function (x) { if (t.indexOf(x) === -1) t.push(x); });
        b.tags = t; n++;
      });
      this.save();
      return n;
    },
    removeTags: function (ids, tags) {
      var set = {}, rm = (tags || []).map(function (t) { return String(t).trim(); }).filter(Boolean);
      ids.forEach(function (i) { set[i] = 1; });
      this.state.bills.forEach(function (b) {
        if (!set[b.id]) return;
        var t = Array.isArray(b.tags) ? b.tags : [];
        b.tags = t.filter(function (x) { return rm.indexOf(x) === -1; });
      });
      this.save();
    },
    allTags: function () {
      var m = {};
      this.state.bills.forEach(function (b) {
        (Array.isArray(b.tags) ? b.tags : []).forEach(function (t) { m[t] = (m[t] || 0) + 1; });
      });
      return Object.keys(m).sort().map(function (k) { return { tag: k, count: m[k] }; });
    },

    removeBills: function (ids) {
      var set = {};
      ids.forEach(function (i) { set[i] = 1; });
      var before = this.state.bills.length;
      this.state.bills = this.state.bills.filter(function (b) { return !set[b.id]; });
      this.save();
      return before - this.state.bills.length;
    },

    /* ---------------------------------------------------------- 回收站
     * 删除先入回收站，可恢复；「彻底删除」才真正移除。 */
    trashBills: function (ids) {
      var self = this, set = {}, moved = [];
      ids.forEach(function (i) { set[i] = 1; });
      this.state.bills.forEach(function (b) {
        if (set[b.id]) { b.deletedAt = Util.nowISO(); moved.push(b); }
      });
      if (!moved.length) return 0;
      this.state.bills = this.state.bills.filter(function (b) { return moved.indexOf(b) === -1; });
      if (!Array.isArray(this.state.trash)) this.state.trash = [];
      this.state.trash = moved.concat(this.state.trash);
      this.save();
      return moved.length;
    },
    getTrash: function () {
      if (!Array.isArray(this.state.trash)) this.state.trash = [];
      return this.state.trash;
    },
    restoreBills: function (ids) {
      var set = {}, moved = [];
      ids.forEach(function (i) { set[i] = 1; });
      this.getTrash().forEach(function (b) { if (set[b.id]) moved.push(b); });
      if (!moved.length) return 0;
      this.state.trash = this.state.trash.filter(function (b) { return moved.indexOf(b) === -1; });
      moved.forEach(function (b) { delete b.deletedAt; });
      this.state.bills = this.state.bills.concat(moved);
      this.save();
      return moved.length;
    },
    purgeBills: function (ids) {
      var set = {}, before = this.getTrash().length;
      ids.forEach(function (i) { set[i] = 1; });
      this.state.trash = this.state.trash.filter(function (b) { return !set[b.id]; });
      this.save();
      return before - this.state.trash.length;
    },
    emptyTrash: function () {
      var n = this.getTrash().length;
      this.state.trash = [];
      this.save();
      return n;
    },

    allBills: function () { return this.state.bills; },

    /* ---------------------------------------------------------- 分组 */
    createGroup: function (name, color) {
      var g = { id: Util.uid('grp'), name: name || '未命名分组', color: color || '#4fc3f7', createdAt: Util.nowISO() };
      this.state.groups.push(g);
      this.save();
      return g;
    },
    renameGroup: function (id, name) {
      var g = this.state.groups.find(function (x) { return x.id === id; });
      if (g) { g.name = name; this.save(); }
      return g;
    },
    deleteGroup: function (id) {
      this.state.groups = this.state.groups.filter(function (g) { return g.id !== id; });
      this.state.bills.forEach(function (b) { if (b.groupId === id) b.groupId = null; });
      this.save();
    },
    getGroup: function (id) {
      return this.state.groups.find(function (g) { return g.id === id; });
    },

    /* ---------------------------------------------------------- 自定义分类/规则 */
    addCategory: function (cat) {
      cat.id = cat.id || Util.uid('cat');
      this.state.customCategories.push(cat);
      this.save();
      return cat;
    },
    updateCategory: function (id, patch) {
      var c = this.state.customCategories.filter(function (x) { return x.id === id; })[0];
      if (!c) return null;
      Object.assign(c, patch || {});
      this.save();
      return c;
    },
    /* 删除自定义分类：该分类下的账单改成「其他」（收入改成「其他收入」），相关规则也一起改掉 */
    removeCategory: function (id) {
      var i = -1;
      this.state.customCategories.forEach(function (x, k) { if (x.id === id && i === -1) i = k; });
      if (i === -1) return 0;
      var name = this.state.customCategories[i].name;
      this.state.customCategories.splice(i, 1);
      var n = 0;
      this.state.bills.forEach(function (b) {
        if (b.category === id) { b.category = (b.type === 'income' ? 'other_in' : 'other'); n++; }
      });
      this.state.customRules.forEach(function (r) { if (r.cat === id) r.cat = 'other'; });
      this.save();
      return n;
    },
    countCategory: function (id) {
      var n = 0;
      this.state.bills.forEach(function (b) { if (b.category === id) n++; });
      return n;
    },

    /* ---------------------------------------------------------- 自定义商户 / 对方
     * 只是「筛选面板里可选的名字」，账单数据不受影响。 */
    _merchantOfBill: function (b) {
      var cp = b.counterparty ? String(b.counterparty).trim() : '';
      return cp || (b.item ? String(b.item).trim() : '');
    },
    addMerchant: function (name) {
      var n = String(name || '').trim();
      if (!n) return null;
      if (this.state.customMerchants.indexOf(n) === -1) {
        this.state.customMerchants.push(n);
        this.save();
      }
      return n;
    },
    removeMerchant: function (name) {
      var i = this.state.customMerchants.indexOf(String(name || '').trim());
      if (i === -1) return false;
      this.state.customMerchants.splice(i, 1);
      this.save();
      return true;
    },
    /* 改名 / 合并：自定义列表 + 所有账单的「对方」（账单没填对方时按项目名匹配，跟筛选口径一致） */
    renameMerchant: function (oldName, newName) {
      var a = String(oldName || '').trim(), b = String(newName || '').trim();
      if (!a || !b || a === b) return 0;
      var i = this.state.customMerchants.indexOf(a);
      if (i !== -1) this.state.customMerchants.splice(i, 1);
      if (this.state.customMerchants.indexOf(b) === -1) this.state.customMerchants.push(b);
      var self = this, n = 0;
      this.state.bills.forEach(function (x) {
        if (self._merchantOfBill(x) === a) { x.counterparty = b; n++; }
      });
      this.save();
      return n;
    },
    countMerchant: function (name) {
      var self = this, n = 0;
      this.state.bills.forEach(function (x) { if (self._merchantOfBill(x) === name) n++; });
      return n;
    },
    isCustomMerchant: function (name) {
      return this.state.customMerchants.indexOf(String(name || '').trim()) !== -1;
    },

    /* ---------------------------------------------------------- 自定义来源
     * 导入时可选、可新建；来源 id 存在账单的 source 字段里。 */
    getSource: function (id) {
      return this.state.customSources.filter(function (x) { return x.id === id; })[0] || null;
    },
    addSource: function (src) {
      src = src || {};
      var o = {
        id: src.id || Util.uid('src'),
        name: String(src.name || '').trim(),
        icon: src.icon || '📱'
      };
      if (!o.name) return null;
      this.state.customSources.push(o);
      this.save();
      return o;
    },
    updateSource: function (id, patch) {
      var s = this.getSource(id);
      if (!s) return null;
      Object.assign(s, patch || {});
      this.save();
      return s;
    },
    /* 删除自定义来源：用过它的账单回落成「通用/未知」，返回改动条数
     * keepBills=true 时（内置来源的改名覆盖层）账单不动。 */
    removeSource: function (id, keepBills) {
      var i = -1;
      this.state.customSources.forEach(function (x, k) { if (x.id === id && i === -1) i = k; });
      if (i === -1) return 0;
      this.state.customSources.splice(i, 1);
      var n = 0;
      if (!keepBills) {
        this.state.bills.forEach(function (b) { if (b.source === id) { b.source = 'generic'; n++; } });
      }
      this.save();
      return n;
    },
    countSource: function (id) {
      var n = 0;
      this.state.bills.forEach(function (b) { if (b.source === id) n++; });
      return n;
    },
    addRule: function (word, cat, type) {
      var r = { word: word, cat: cat, type: type || 'expense' };
      this.state.customRules.push(r);
      this.save();
      return r;
    },
    removeRule: function (idx) {
      this.state.customRules.splice(idx, 1);
      this.save();
    },

    /* ---------------------------------------------------------- 商户排除规则
     * 命中的商户（对方名 / 项目名包含关键词）会从账单、统计、图表中整体筛掉。 */
    addMerchantExclude: function (word) {
      word = String(word || '').trim();
      if (!word) return null;
      if (this.state.merchantExcludes.indexOf(word) === -1) {
        this.state.merchantExcludes.push(word);
        this.save();
      }
      return word;
    },
    removeMerchantExclude: function (word) {
      var i = this.state.merchantExcludes.indexOf(word);
      if (i !== -1) { this.state.merchantExcludes.splice(i, 1); this.save(); }
    },
    clearMerchantExcludes: function () {
      this.state.merchantExcludes = [];
      this.save();
    },

    /* ---------------------------------------------------------- 钱包 / 账户
     * 一个钱包 = 一个平台或银行卡。自动余额 = 初始余额 + 收入 − 支出（按关联来源的账单算）；
     * manual 不为空时以手动填的余额为准。 */
    getWallet: function (id) {
      if (!Array.isArray(this.state.wallets)) this.state.wallets = [];
      return this.state.wallets.filter(function (x) { return x.id === id; })[0] || null;
    },
    addWallet: function (w) {
      if (!Array.isArray(this.state.wallets)) this.state.wallets = [];
      w = w || {};
      function amt(v, allowEmpty) {
        var s = String(v === null || v === undefined ? '' : v).trim();
        if (!s) return allowEmpty ? null : '0';
        if (!Money) return s;
        var b = Money.parse(s);
        if (b === null) return allowEmpty ? null : '0';
        return Money.str(Money.abs(b));
      }
      var o = {
        id: w.id || Util.uid('wal'),
        name: String(w.name || '').trim(),
        icon: w.icon || '💳',
        kind: w.kind || 'platform',
        init: amt(w.init),
        manual: amt(w.manual, true),
        sources: Array.isArray(w.sources) ? w.sources.slice() : [],
        createdAt: Util.nowISO()
      };
      if (!o.name) return null;
      this.state.wallets.push(o);
      this.save();
      return o;
    },
    updateWallet: function (id, patch) {
      var w = this.getWallet(id);
      if (!w) return null;
      Object.assign(w, patch || {});
      this.save();
      return w;
    },
    removeWallet: function (id) {
      if (!Array.isArray(this.state.wallets)) this.state.wallets = [];
      var i = -1;
      this.state.wallets.forEach(function (x, k) { if (x.id === id && i === -1) i = k; });
      if (i === -1) return false;
      this.state.wallets.splice(i, 1);
      /* 钱包删了，和它相关的转账也一并清掉，避免「一边转出、另一边已没了」把钱算丢 */
      if (!Array.isArray(this.state.transfers)) this.state.transfers = [];
      this.state.transfers = this.state.transfers.filter(function (t) { return t.from !== id && t.to !== id; });
      this.save();
      return true;
    },

    /* ---------------------------------------------------------- 钱包互相转账
     * 内部转账：一端转出、一端转入，「资产合计」不变。amount 存字符串（如 "50"）。 */
    getTransfer: function (id) {
      if (!Array.isArray(this.state.transfers)) this.state.transfers = [];
      return this.state.transfers.filter(function (x) { return x.id === id; })[0] || null;
    },
    addTransfer: function (t) {
      if (!Array.isArray(this.state.transfers)) this.state.transfers = [];
      t = t || {};
      var from = String(t.from || '').trim();
      var to = String(t.to || '').trim();
      if (!from || !to || from === to) return null;
      if (!this.getWallet(from) || !this.getWallet(to)) return null;
      var amt = Money ? Money.parse(t.amount) : null;
      if (amt === null) return null;
      amt = Money.abs(amt);
      if (amt === 0n) return null;
      var o = {
        id: t.id || Util.uid('trf'),
        from: from,
        to: to,
        amount: Money ? Money.str(amt) : String(t.amount || ''),
        date: String(t.date || '').trim() || (Util ? Util.todayISO() : ''),
        note: String(t.note || '').trim(),
        createdAt: Util ? Util.nowISO() : ''
      };
      this.state.transfers.push(o);
      this.save();
      return o;
    },
    removeTransfer: function (id) {
      if (!Array.isArray(this.state.transfers)) this.state.transfers = [];
      var before = this.state.transfers.length;
      this.state.transfers = this.state.transfers.filter(function (x) { return x.id !== id; });
      if (this.state.transfers.length === before) return false;
      this.save();
      return true;
    },
    /* ---------------------------------------------------------- 备份 */
    exportJSON: function () { return JSON.stringify(this.state, null, 2); },

    importJSON: function (text, mode) {
      var data = JSON.parse(text);
      if (!data || !Array.isArray(data.bills)) throw new Error('文件格式不正确：缺少 bills 数组');
      if (mode === 'replace') {
        var d = defaults();
        this.state = Object.assign(d, data);
      } else {
        // 合并（按 id 去重，新数据覆盖旧数据）
        var byId = {};
        this.state.bills.forEach(function (b) { byId[b.id] = b; });
        (data.bills || []).forEach(function (b) {
          if (!b.id) b.id = Util.uid('bill');
          byId[b.id] = b;
        });
        this.state.bills = Object.keys(byId).map(function (k) { return byId[k]; });
        var gids = {};
        this.state.groups.forEach(function (g) { gids[g.id] = 1; });
        (data.groups || []).forEach(function (g) { if (!gids[g.id]) { this.state.groups.push(g); gids[g.id] = 1; } }, this);
        if (!Array.isArray(this.state.trash)) this.state.trash = [];
        var tids = {};
        this.state.trash.forEach(function (b) { tids[b.id] = 1; });
        (data.trash || []).forEach(function (b) { if (!tids[b.id]) { this.state.trash.push(b); tids[b.id] = 1; } });
        if (!Array.isArray(this.state.transfers)) this.state.transfers = [];
        var tfids = {};
        this.state.transfers.forEach(function (x) { tfids[x.id] = 1; });
        (data.transfers || []).forEach(function (x) { if (x && x.id && !tfids[x.id]) { this.state.transfers.push(x); tfids[x.id] = 1; } });
      }
      if (!Array.isArray(this.state.transfers)) this.state.transfers = [];
      this.save();
      return this.state.bills.length;
    },

    reset: function () {
      this.state = defaults();
      if (this._adapter) this._adapter.remove(KEY);
      this.save();
    }
  };

  /* 给数据修改方法统一挂上「变更记录」标签（集中一处，避免散落各处漏记） */
  (function wrapMutators() {
    var labels = {
      addBills: '新增 / 导入账单', updateBill: '修改账单', updateBills: '批量修改账单',
      addTags: '添加标签', removeTags: '移除标签', removeBills: '删除账单',
      trashBills: '移入回收站', restoreBills: '恢复账单', purgeBills: '彻底删除账单', emptyTrash: '清空回收站',
      createGroup: '新建分组', renameGroup: '重命名分组', deleteGroup: '删除分组',
      addCategory: '新建分类', updateCategory: '修改分类', removeCategory: '删除分类',
      addMerchant: '新增商户', removeMerchant: '删除商户', renameMerchant: '重命名商户',
      addSource: '新增来源', updateSource: '修改来源', removeSource: '删除来源',
      addRule: '新增规则', removeRule: '删除规则',
      addMerchantExclude: '排除商户', removeMerchantExclude: '恢复排除商户', clearMerchantExcludes: '清空排除商户',
      addWallet: '新建钱包', updateWallet: '修改钱包', removeWallet: '删除钱包',
      addTransfer: '钱包转账', removeTransfer: '删除转账',
      importJSON: '导入备份', reset: '清空全部数据'
    };
    Object.keys(labels).forEach(function (k) {
      var fn = Store[k];
      if (typeof fn !== 'function') return;
      Store[k] = function () {
        Store.mark(labels[k]);
        return fn.apply(Store, arguments);
      };
    });
  })();

  return Store;
});
