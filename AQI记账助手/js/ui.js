/* ============================================================================
 * ui.js —— 记账助手 界面主程序
 * 纯原生 JS，无框架。渲染方式：状态 -> innerHTML 重绘 + 事件委托。
 * ==========================================================================*/
(function () {
  'use strict';

  /* ------------------------------------------------------------------ 依赖 */
  var Money = window.Money, Util = window.Util, Parse = window.Parse,
    Categorize = window.Categorize, Store = window.Store, Filters = window.Filters,
    Dedupe = window.Dedupe, Importer = window.Importer, Charts = window.Charts,
    ExportImage = window.ExportImage;

  function esc(s) { return Util.escapeHtml(s); }
  function fmt(v) { return Money.fmt(v); }
  function cat(id) {
    var custom = (Store.state.customCategories || []).filter(function (x) { return x.id === id; })[0];
    return custom || Categorize.getCategory(id);
  }
  function typeName(t) { return t === 'income' ? '收入' : (t === 'transfer' ? '转账' : '支出'); }
  /* 来源名称：自定义来源优先，再回落内置表 */
  function srcName(s) {
    var c = s ? Store.getSource(s) : null;
    if (c) return c.icon ? (c.icon + ' ' + c.name) : c.name;
    return Parse.SOURCE_LABELS[s] || s || '—';
  }
  function srcLabel(s) {
    var c = s ? Store.getSource(s) : null;
    if (c) return c.name;
    return Parse.SOURCE_LABELS[s] || s || '—';
  }
  /* 可选的来源 id 列表：内置 + 自定义（+ 账单里出现过的怪值） */
  function allSourceIds() {
    var ids = Parse.SOURCE_KEYS.slice();
    (Store.state.customSources || []).forEach(function (s) { if (ids.indexOf(s.id) === -1) ids.push(s.id); });
    Store.allBills().forEach(function (b) { if (b.source && ids.indexOf(b.source) === -1) ids.push(b.source); });
    return ids;
  }

  /* 快捷剔除：字段 → 增 / 恢复 / 全部恢复 的动作名 + 中文名 */
  var EXCL_FIELDS = {
    excludeCategories: { on: 'f-excat', off: 'f-remove-excat', clear: 'f-excat-clear', word: '分类' },
    excludeCounterparties: { on: 'f-mexc', off: 'f-remove-mexc', clear: 'f-mexc-clear', word: '商户 / 对方' },
    excludeSources: { on: 'f-sexc', off: 'f-remove-sexc', clear: 'f-sexc-clear', word: '来源' },
    excludeGroups: { on: 'f-gexc', off: 'f-remove-gexc', clear: 'f-gexc-clear', word: '分组' }
  };
  var EXCL_SEL = {
    excludeCategories: 'categories',
    excludeCounterparties: 'counterparties',
    excludeSources: 'sources',
    excludeGroups: 'groups'
  };
  var EXCL_ACTS = {}, EXCL_OFF_ACTS = {}, EXCL_CLEAR_ACTS = {};
  Object.keys(EXCL_FIELDS).forEach(function (k) {
    EXCL_ACTS[EXCL_FIELDS[k].on] = k;
    EXCL_OFF_ACTS[EXCL_FIELDS[k].off] = k;
    EXCL_CLEAR_ACTS[EXCL_FIELDS[k].clear] = k;
  });
  var EXCL_SEL_INV = {};
  Object.keys(EXCL_SEL).forEach(function (k) { EXCL_SEL_INV[EXCL_SEL[k]] = k; });
  function exList(field) {
    if (!Array.isArray(S.filters[field])) S.filters[field] = [];
    return S.filters[field];
  }
  function exLabelText(field, v) {
    if (field === 'excludeCategories') return cat(v).icon + cat(v).name;
    if (field === 'excludeSources') return srcLabel(v);
    if (field === 'excludeGroups') {
      if (v === Filters.NONE) return '未分组';
      return Store.getGroup(v) ? Store.getGroup(v).name : String(v);
    }
    return String(v);
  }
  /* 剔除一项：加进剔除表，同时从「选中」里移除（两者互斥） */
  function exAdd(field, val, silent) {
    val = String(val === null || val === undefined ? '' : val);
    if (!val) { toast('这一条没有内容，无法剔除', 'err'); return; }
    var ex = exList(field);
    if (ex.indexOf(val) === -1) ex.push(val);
    var sel = S.filters[EXCL_SEL[field]];
    if (sel) {
      var i = sel.indexOf(val);
      if (i !== -1) sel.splice(i, 1);
    }
    S.listLimit = 200;
    if (!silent) toast('已剔除「' + exLabelText(field, val) + '」：整类不参与筛选与统计', 'ok');
    saveExclusions();
    render();
  }
  function exRemove(field, val) {
    var ex = exList(field);
    var i = ex.indexOf(String(val === null || val === undefined ? '' : val));
    if (i !== -1) ex.splice(i, 1);
    saveExclusions();
    render();
  }
  /* ⊘ 剔除的清单自动记住：存进 settings.exclusions，下次打开还在 */
  function saveExclusions() {
    if (!Store.state.settings) Store.state.settings = {};
    var box = {};
    Object.keys(EXCL_SEL).forEach(function (k) { box[k] = (S.filters[k] || []).slice(); });
    Store.state.settings.exclusions = box;
    Store.save();
  }
  function loadExclusions() {
    var box = (Store.state.settings && Store.state.settings.exclusions) || null;
    if (!box) return;
    Object.keys(EXCL_SEL).forEach(function (k) {
      if (Array.isArray(box[k])) S.filters[k] = box[k].slice();
    });
  }
  /* 剔除提示行（红色项，点一下恢复；多了可缩略） */
  function exclHint(field) {
    var cfg = EXCL_FIELDS[field], ex = exList(field);
    if (!ex.length) return '';
    var collapsed = Store.state.settings.exclCollapsed === true;
    var shown = collapsed ? ex.slice(0, 4) : ex;
    return '<div class="frow wrap"><div class="fgroup"><span class="flabel">⊘ 已剔除 ' + ex.length + ' 个' + cfg.word +
      '（红色项，点一下恢复；会自动记住）' +
      (ex.length > 4 ? '<button class="mini" data-act="excl-hint-toggle" title="展开 / 缩略">' + (collapsed ? '▾ 展开全部' : '▴ 缩略') + '</button>' : '') +
      '</span><div class="chips">' +
      shown.map(function (v) {
        return '<button class="chip no" data-act="' + cfg.off + '" data-val="' + esc(v) + '" title="点击恢复">⊘ ' + esc(exLabelText(field, v)) + '</button>';
      }).join('') +
      (collapsed && ex.length > 4 ? '<span class="hint">还有 ' + (ex.length - 4) + ' 个…</span>' : '') +
      (ex.length > 1 ? '<button class="ghost" data-act="' + cfg.clear + '">全部恢复</button>' : '') +
      '</div></div></div>';
  }
  /* 已排除的商户（总账单关键词排除）：可展开 / 缩略 */

  /* ------------------------------------------------------------------ 状态 */
  var THEME_KEY = 'jizhang.theme';
  function readTheme() {
    try { var t = localStorage.getItem(THEME_KEY); if (t === 'light' || t === 'dark') return t; } catch (e) {}
    return 'dark';
  }
  function setTheme(t) {
    S.theme = (t === 'light') ? 'light' : 'dark';
    try { document.documentElement.setAttribute('data-theme', S.theme); } catch (e) {}
    try { localStorage.setItem(THEME_KEY, S.theme); } catch (e) {}
    render();
  }
  function themeLabel() { return S.theme === 'light' ? '🌙 夜间模式' : '☀️ 日间模式'; }

  var S = {
    tab: 'bills',
    theme: 'dark',
    filters: { dateFrom: '', dateTo: '', types: [], categories: [], excludeCategories: [], sources: [], excludeSources: [], groups: [], excludeGroups: [], counterparties: [], excludeCounterparties: [], items: [], tags: [], flag: 'all', keyword: '', amountMin: '', amountMax: '' },
    showFilters: false,
    sortKey: 'date',
    sortDesc: true,
    compact: true,
    selection: {},
    detailOpen: {},
    listLimit: 200,
    chart: { dim: 'category', type: 'donut', kind: 'expense' },
    organizeSub: 'unclassified',
    merchantMinCount: 1,
    merchantMultiOnly: false,
    merchantSearch: '',
    exclMode: '',
    exclStage: {},
    modal: null,
    imp: null,
    calcManual: [],
    calcMode: 'step',
    calcExpr: [],
    calcPick: '',
    calcSplit: 0,
    exportScope: null,
    exportStyle: 'light',
    statsPeriod: 'all',
    dupSel: {},
    dupeSeeded: false,
    expTitle: '账单明细',
    expSub: '',
    expNote: '',
    _expT: null,
    toastTimer: null
  };

  /* ------------------------------------------------------------- 数据查询 */
  /* 商户排除规则：命中的账单从所有列表 / 统计 / 图表中整体筛掉 */
  function merchantExcludes() { return Store.state.merchantExcludes || []; }
  function excats() { return exList('excludeCategories'); }
  function isExcluded(b) {
    var rules = merchantExcludes();
    if (!rules.length) return false;
    var hay = ((b.counterparty || '') + ' ' + (b.item || '') + ' ' + (b.category || '')).toLowerCase();
    for (var i = 0; i < rules.length; i++) {
      var w = String(rules[i] || '').trim().toLowerCase();
      if (w && hay.indexOf(w) !== -1) return true;
    }
    return false;
  }
  /* 已排除的账单：默认从账单列表里也藏起来（统计/图表永远不算它们）。
   * settings.hideExcluded === false 时列表里照常显示（带 🚫 标记），方便核对。 */
  function hideExcluded() { return Store.state.settings.hideExcluded !== false; }
  function allBills() {
    var all = Store.allBills();
    if (!merchantExcludes().length) return all;
    return all.filter(function (b) { return !isExcluded(b); });
  }
  /* 账单列表用：是否隐藏已排除的账单由开关决定 */
  function listBills() {
    var all = Store.allBills();
    if (!merchantExcludes().length || hideExcluded()) return allBills();
    return all;
  }

  function filtered() {
    var list = Filters.apply(listBills(), S.filters);
    var k = S.sortKey, desc = S.sortDesc;
    list.sort(function (a, b) {
      var x, y;
      if (k === 'amount') { x = Money.parse(a.amount); y = Money.parse(b.amount); return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1); }
      if (k === 'type') { x = a.type; y = b.type; }
      else if (k === 'category') { x = cat(a.category).name; y = cat(b.category).name; }
      else if (k === 'source') { x = a.source; y = b.source; }
      else if (k === 'item') { x = a.item; y = b.item; }
      else { x = a.date + (a.time || ''); y = b.date + (b.time || ''); }
      if (x === y) return 0;
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    });
    return list;
  }

  function selectedIds() {
    return Object.keys(S.selection).filter(function (k) { return S.selection[k]; });
  }
  function selectedBills() {
    var set = S.selection;
    return allBills().filter(function (b) { return set[b.id]; });
  }
  /* 计算器/导出使用的目标：有选择用选择，否则用当前筛选结果 */
  function targetBills() {
    var sel = selectedBills();
    return sel.length ? sel : filtered();
  }
  /* 计算器可选账单：跟着账单页的筛选走（勾了账单就用勾选的，没勾就用筛选结果） */
  function calcPoolBills() { return targetBills(); }
  /* 当前有没有在用筛选条件 */
  function filterActive() {
    var f = S.filters || {};
    return !!(f.keyword || f.dateFrom || f.dateTo || f.amountMin || f.amountMax ||
      (f.flag && f.flag !== 'all') ||
      (f.types || []).length || (f.categories || []).length || (f.sources || []).length ||
      (f.groups || []).length || (f.counterparties || []).length || (f.tags || []).length ||
      (f.items || []).length || (f.excludeCategories || []).length || (f.excludeSources || []).length ||
      (f.excludeCounterparties || []).length || (f.excludeGroups || []).length);
  }
  function blankFilters() {
    return {
      keyword: '', types: [], categories: [], excludeCategories: [], sources: [], excludeSources: [],
      groups: [], excludeGroups: [], counterparties: [], excludeCounterparties: [], items: [], tags: [],
      flag: 'all', dateFrom: '', dateTo: '', amountMin: '', amountMax: ''
    };
  }

  /* ------------------------------------------------------------------ 弹层 */
  function toast(msg, kind) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
  }
  function openModal(m) { S.modal = m; render(); }
  function closeModal() { S.modal = null; render(); }

  /* ------------------------------------------------------------------ 渲染 */
  function render() {
    var view = document.getElementById('view');
    var ae = document.activeElement, fid = ae && ae.id ? ae.id : null;
    var st = ae && ae.selectionStart != null ? ae.selectionStart : null;
    /* 重绘会重建 #view（滚动容器），先记住滚动位置：同一标签页内原地重绘时保持不跳，切页才回到顶部 */
    var key = S.tab + '|' + (S.organizeSub || '');
    var keepY = (S._rKey === key && view) ? (view.scrollTop || 0) : 0;
    S._rKey = key;
    document.getElementById('app').innerHTML = navHtml() + '<main id="view">' + viewHtml() + '</main>' + modalHtml() + floatBarHtml() + undoFabHtml();
    if (fid) { var el = document.getElementById(fid); if (el && el.focus) { try { el.focus(); if (st != null && el.setSelectionRange) el.setSelectionRange(st, st); } catch (e) {} } }
    afterRender();
    var nv = document.getElementById('view');
    if (nv) nv.scrollTop = keepY;
  }

  var TABS = [
    { id: 'bills', icon: '📋', name: '账单' },
    { id: 'merchants', icon: '🏪', name: '商户' },
    { id: 'import', icon: '📥', name: '导入' },
    { id: 'calc', icon: '🧮', name: '计算器' },
    { id: 'charts', icon: '📊', name: '图表' },
    { id: 'organize', icon: '🗂️', name: '整理' },
    { id: 'groups', icon: '📁', name: '分组' },
    { id: 'wallet', icon: '💰', name: '钱包' },
    { id: 'export', icon: '🖼️', name: '导出' },
    { id: 'settings', icon: '⚙️', name: '设置' }
  ];

  /* 导航顺序可自定义：settings.navOrder 存 id 顺序，缺的按默认顺序补在后面 */
  function orderedTabs() {
    var order = (Store.state.settings && Store.state.settings.navOrder) || [];
    var list = [], used = {};
    order.forEach(function (id) {
      var t = TABS.filter(function (x) { return x.id === id; })[0];
      if (t && !used[id]) { list.push(t); used[id] = 1; }
    });
    TABS.forEach(function (t) { if (!used[t.id]) list.push(t); });
    return list;
  }
  function moveNav(id, dir) {
    var list = orderedTabs().map(function (t) { return t.id; });
    var i = list.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    Store.state.settings.navOrder = list;
    Store.save();
    render();
  }
  function resetNavOrder() {
    Store.state.settings.navOrder = [];
    Store.save();
    toast('导航顺序已恢复默认', 'ok');
    render();
  }

  function navHtml() {
    var bills = allBills();
    var n = bills.length;
    return '<aside class="nav">' +
      '<div class="brand"><span class="logo">账</span><div><b>AQI的记账助手</b><small>本地·离线·精确</small></div></div>' +
      '<nav class="tabs">' + orderedTabs().map(function (t) {
        return '<button class="tab' + (S.tab === t.id ? ' active' : '') + '" data-act="tab" data-tab="' + t.id + '">' +
          '<i>' + t.icon + '</i><span>' + t.name + '</span>' +
          (t.id === 'bills' ? '<em class="badge">' + n + '</em>' : '') + '</button>';
      }).join('') + '</nav>' +
      '<div class="nav-foot">' +
      '<button class="ghost theme-btn" data-act="theme-toggle">' + themeLabel() + '</button>' +
      '<button class="ghost" data-act="backup-export">导出备份</button>' +
      '<button class="ghost" data-act="backup-import">导入备份</button></div>' +
      '</aside>';
  }

  function viewHtml() {
    switch (S.tab) {
      case 'bills': return viewBills();
      case 'merchants': return viewMerchants();
      case 'import': return viewImport();
      case 'calc': return viewCalc();
      case 'charts': return viewCharts();
      case 'organize': return viewOrganize();
      case 'groups': return viewGroups();
      case 'wallet': return viewWallet();
      case 'export': return viewExport();
      case 'settings': return viewSettings();
    }
    return '';
  }

  /* ============================================================ 账单列表 */
  function summaryBar(list) {
    var s = Filters.summary(list);
    return '<div class="sumbar">' +
      '<div class="s-item"><span>笔数</span><b>' + s.count + '</b></div>' +
      '<div class="s-item exp"><span>支出</span><b>¥' + fmt(s.expense) + '</b></div>' +
      '<div class="s-item inc"><span>收入</span><b>¥' + fmt(s.income) + '</b></div>' +
      '<div class="s-item net"><span>净额</span><b>¥' + fmt(s.net) + '</b></div>' +
      '</div>';
  }

  function filterPanel() {
    if (!S.showFilters) return '';
    var f = S.filters;
    var cats = Categorize.ALL.concat(Store.state.customCategories);
    function multi(field, label, list, sel, labelFn, exclField, extra) {
      if (!list.length) return '';
      var excl = exclField ? exList(exclField) : [];
      var cfg = exclField ? EXCL_FIELDS[exclField] : null;
      var staging = !!(exclField && S.exclMode === exclField);
      var stage = staging ? ((S.exclStage && S.exclStage[exclField]) || []) : [];
      return '<div class="fgroup' + (staging ? ' staging' : '') + '"><span class="flabel">' + label + '</span><div class="chips">' +
        list.map(function (v) {
          var text = esc(labelFn ? labelFn(v) : v);
          if (staging) {
            var picked = stage.indexOf(v) !== -1;
            return '<button class="chip' + (picked ? ' no' : '') + '" data-act="excl-stage" data-field="' + exclField + '" data-val="' + esc(v) + '" title="点一下选中，选完点右边「排除选中」">' + (picked ? '⊘ ' : '') + text + '</button>';
          }
          /* 被剔除的：整颗变红，点一下恢复（一眼看出哪些被剔掉了） */
          if (excl.indexOf(v) !== -1) {
            return '<button class="chip no" data-act="' + cfg.off + '" data-val="' + esc(v) + '" title="已剔除（整类不看），点击恢复">⊘ ' + text + '</button>';
          }
          var on = sel.indexOf(v) !== -1;
          var chip = '<button class="chip' + (on ? ' on' : '') + '" data-act="f-toggle" data-field="' + field + '" data-val="' + esc(v) + '">' + text + '</button>';
          if (!exclField) return chip;
          return '<span class="chipwrap">' + chip +
            '<button class="chip-x" data-act="' + cfg.on + '" data-val="' + esc(v) + '" title="剔除该' + cfg.word + '（整类不看）">⊘</button></span>';
        }).join('') + '</div>' +
        (staging
          ? fmini('<button class="mini on" data-act="excl-apply" title="把选中的都排除掉">🚫 排除选中 ' + stage.length + '</button>' +
            '<button class="mini" data-act="excl-mode" data-field="' + exclField + '">取消</button>')
          : (fmini(extra) + (exclField ? fmini('<button class="mini" data-act="excl-mode" data-field="' + exclField + '" title="一次选多项再一起排除">🚫 多选排除</button>') : ''))) +
        '</div>';
    }
    function fmini(html) { return html ? '<span class="fmini">' + html + '</span>' : ''; }
    var mSrc = {};
    allBills().forEach(function (b) { if (b.source) mSrc[b.source] = (mSrc[b.source] || 0) + 1; });
    var types = [['expense', '支出'], ['income', '收入'], ['transfer', '转账']];
    var srcs = allSourceIds();
    var gN = {};
    allBills().forEach(function (b) { var k = b.groupId || Filters.NONE; gN[k] = (gN[k] || 0) + 1; });
    var grps = Store.state.groups.map(function (g) { return g.id; });
    if (gN[Filters.NONE]) grps.push(Filters.NONE);
    var mCount = {};
    allBills().forEach(function (b) { var m = Filters.merchantOf(b); if (m) mCount[m] = (mCount[m] || 0) + 1; });
    var merchants = Object.keys(mCount).sort(function (a, b) { return mCount[b] - mCount[a] || (a < b ? -1 : 1); });
    var shownMerchants = merchants.slice(0, 18);
    /* 手动新增的商户一定看得见（哪怕一条账单都没有） */
    (Store.state.customMerchants || []).forEach(function (n) {
      if (shownMerchants.indexOf(n) === -1) shownMerchants.push(n);
    });
    var tagList = Store.allTags().map(function (t) { return t.tag; });
    /* 每个筛选组独占一行，避免「分组」跟「来源」挤在同一行 */
    function frowOf(html) { return html ? '<div class="frow wrap">' + html + '</div>' : ''; }
    return '<div class="filter-panel">' +
      '<div class="frow">' +
      '<label>从 <input type="date" id="f-dateFrom" data-field="dateFrom" value="' + esc(f.dateFrom) + '"></label>' +
      '<label>到 <input type="date" id="f-dateTo" data-field="dateTo" value="' + esc(f.dateTo) + '"></label>' +
      '<label>金额 ≥ <input type="text" inputmode="decimal" id="f-amountMin" data-field="amountMin" value="' + esc(f.amountMin) + '" placeholder="0"></label>' +
      '<label>≤ <input type="text" inputmode="decimal" id="f-amountMax" data-field="amountMax" value="' + esc(f.amountMax) + '" placeholder="不限"></label>' +
      '<label>状态 <select id="f-flag" data-field="flag">' +
      ['all:全部', 'normal:正常', 'unsure:不记得箱', 'review:保留箱', 'dupe:重复标记'].map(function (o) {
        var p = o.split(':');
        return '<option value="' + p[0] + '"' + (f.flag === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
      }).join('') + '</select></label>' +
      '<div class="frow-right">' +
      '<button class="ghost" data-act="f-clear">清空筛选</button>' +
      '<button class="ghost" data-act="f-quick-month">本月</button>' +
      '<button class="ghost" data-act="f-quick-7">近7天</button>' +
      '</div></div>' +
      frowOf(multi('types', '类型', ['expense', 'income', 'transfer'], f.types, function (v) { return typeName(v); })) +
      frowOf(multi('categories', '分类', cats.map(function (c) { return c.id; }), f.categories, function (v) { return cat(v).icon + cat(v).name; }, 'excludeCategories',
        '<button class="mini" data-act="cat-create-here" title="新建分类">＋ 新建</button>')) +
      frowOf(multi('sources', '来源', srcs, f.sources, function (v) { return srcName(v) + (mSrc[v] > 1 ? '(' + mSrc[v] + ')' : ''); }, 'excludeSources',
        '<button class="mini" data-act="src-new" title="新建来源">＋ 新建</button><button class="mini" data-act="src-manage" title="管理来源（改名 / 删除）">✏ 管理</button>')) +
      frowOf(multi('groups', '分组', grps, f.groups, function (v) { return v === Filters.NONE ? '未分组' : (Store.getGroup(v) ? Store.getGroup(v).name : v); }, 'excludeGroups',
        '<button class="mini" data-act="sel-group" title="把勾选的账单移到分组">📁 移到分组…</button>')) +
      frowOf(shownMerchants.length ? multi('counterparties', '商户 / 对方', shownMerchants, f.counterparties, function (v) {
        return v + (mCount[v] > 1 ? '(' + mCount[v] + ')' : '') + (Store.isCustomMerchant(v) ? ' ✎' : '');
      }, 'excludeCounterparties',
        '<button class="mini" data-act="mc-new" title="新增商户 / 对方">＋ 新增</button><button class="mini" data-act="mc-manage" title="管理商户 / 对方（改名 / 删除）">✏ 管理</button>') : '') +
      frowOf(tagList.length ? multi('tags', '标签', tagList, f.tags, function (v) { return '#' + v; }) : '') +
      (merchantExcludes().length ? exclMerchantRow() : '') +
      exclHint('excludeCategories') + exclHint('excludeCounterparties') + exclHint('excludeSources') + exclHint('excludeGroups') +
      '</div>';
  }

  /* 🚫 已排除的商户（总账单关键词排除）：可展开 / 缩略 */
  function exclMerchantRow() {
    var ws = merchantExcludes();
    if (!ws.length) return '';
    var collapsed = Store.state.settings.exclCollapsed === true;
    var shown = collapsed ? ws.slice(0, 3) : ws;
    return '<div class="frow wrap"><div class="fgroup"><span class="flabel">🚫 已排除的商户（点击恢复）' +
      '<button class="mini" data-act="excl-hint-toggle" title="展开 / 缩略">' + (collapsed ? '▾ 展开全部 ' + ws.length + ' 个' : '▴ 缩略') + '</button>' +
      '</span><div class="chips">' +
      shown.map(function (w) {
        return '<button class="chip on" data-act="mex-del" data-word="' + esc(w) + '">' + esc(w) + ' ×</button>';
      }).join('') +
      (collapsed && ws.length > 3 ? '<span class="hint">还有 ' + (ws.length - 3) + ' 个…</span>' : '') +
      '<button class="ghost" data-act="mex-hide-toggle">' + (hideExcluded() ? '👁 总账单里也显示它们' : '🚫 总账单里不显示它们') + '</button>' +
      '</div></div></div>';
  }

  /* 已筛选条件摘要：随时能看到筛了什么、各类命中多少，可单个移除 */
  function activeBar() {
    var f = S.filters, chips = [];
    function one(field, val, text) {
      chips.push('<button class="chip on" data-act="f-remove" data-field="' + field + '" data-val="' + esc(val) + '" title="点击移除">' + text + ' <b>×</b></button>');
    }
    if (f.dateFrom || f.dateTo) chips.push('<button class="chip on" data-act="f-clear-date" title="点击移除">📅 ' + esc((f.dateFrom || '不限') + ' ~ ' + (f.dateTo || '不限')) + ' <b>×</b></button>');
    if (f.amountMin || f.amountMax) chips.push('<button class="chip on" data-act="f-clear-amount" title="点击移除">💰 ' + esc((f.amountMin ? '≥' + f.amountMin : '不限') + ' ~ ' + (f.amountMax ? '≤' + f.amountMax : '不限')) + ' <b>×</b></button>');
    if (f.flag && f.flag !== 'all') {
      var fname = { normal: '正常', unsure: '不记得箱', review: '保留箱', dupe: '重复标记' }[f.flag] || f.flag;
      chips.push('<button class="chip on" data-act="f-clear-flag" title="点击移除">状态：' + esc(fname) + ' <b>×</b></button>');
    }
    (f.types || []).forEach(function (v) { one('types', v, '类型：' + typeName(v)); });
    (f.categories || []).forEach(function (v) { one('categories', v, '分类：' + cat(v).icon + cat(v).name); });
    (f.sources || []).forEach(function (v) { one('sources', v, '来源：' + srcName(v)); });
    (f.groups || []).forEach(function (v) { one('groups', v, '分组：' + (v === Filters.NONE ? '未分组' : (Store.getGroup(v) ? Store.getGroup(v).name : v))); });
    (f.counterparties || []).forEach(function (v) { one('counterparties', v, '商户：' + v); });
    (f.items || []).forEach(function (v) { one('items', v, '项目：' + v); });
    (f.tags || []).forEach(function (v) { one('tags', v, '标签：#' + v); });
    /* 快捷剔除（分类 / 商户 / 来源 / 分组 共用一套渲染） */
    Object.keys(EXCL_FIELDS).forEach(function (field) {
      (f[field] || []).forEach(function (v) {
        chips.push('<button class="chip no" data-act="' + EXCL_FIELDS[field].off + '" data-val="' + esc(v) + '" title="点击恢复">⊘ 不看：' + esc(exLabelText(field, v)) + ' <b>×</b></button>');
      });
    });
    if (f.keyword) chips.push('<button class="chip on" data-act="f-clear-keyword" title="点击移除">🔍 “' + esc(f.keyword) + '” <b>×</b></button>');
    if (!chips.length) return '';
    var n = filtered().length;
    return '<div class="active-bar"><span class="ab-tip">已筛选</span>' + chips.join('') +
      '<span class="ab-count">命中 <b>' + n + '</b> 条</span>' +
      '<button class="ghost" data-act="f-clear">清空全部</button></div>';
  }

  function billRow(b, opts) {
    opts = (opts && typeof opts === 'object') ? opts : {};
    var c = cat(b.category);
    var g = b.groupId ? Store.getGroup(b.groupId) : null;
    var selMap = opts.selMap || S.selection;
    var selAct = opts.selAct || 'select';
    var checked = !!selMap[b.id];
    var open = !!S.detailOpen[b.id];
    var flags = '';
    if (b.unsure) flags += '<span class="flag unsure">不记得</span>';
    if (b.review) flags += '<span class="flag review">保留箱</span>';
    if (b.dupe) flags += '<span class="flag dupe">重复?</span>';
    if (isExcluded(b)) flags += '<span class="flag excl" title="这家商户已被排除：统计和图表里不算它">🚫 已排除</span>';
    var amountCls = b.type === 'income' ? 'inc' : (b.type === 'transfer' ? 'tr' : 'exp');
    var sign = b.type === 'income' ? '+' : (b.type === 'transfer' ? '' : '-');
    var ck = opts.selectable === false
      ? '<span class="ck"></span>'
      : '<label class="ck" data-act="stop"><input type="checkbox" data-act="' + selAct + '" data-id="' + b.id + '"' + (checked ? ' checked' : '') + '></label>';
    var tagHtml = (b.tags && b.tags.length) ? '<div class="b-tags">' + b.tags.map(function (t) {
      return '<span class="tg">' + esc(t) + '</span>';
    }).join('') + '</div>' : '';
    var html = '<div class="bill' + (checked ? ' sel' : '') + '" data-act="expand" data-id="' + b.id + '">' +
      ck +
      '<div class="b-date"><b>' + esc(b.date || '—') + '</b><small>' + esc(b.time || Util.weekday(b.date)) + '</small></div>' +
      '<div class="b-main"><div class="b-item">' + (open ? '' : esc(b.item || '（无项目名）')) + flags + '</div>' +
      (!open ? '<div class="b-sub">' + c.icon + ' ' + esc(c.name) + ' · ' + esc(srcName(b.source)) + (b.counterparty ? ' · ' + esc(b.counterparty) : '') + '</div>' : '') +
      tagHtml +
      (open ? detailHtml(b, opts) : '') +
      '</div>' +
      '<div class="b-amount ' + amountCls + '">' + sign + '¥' + fmt(b.amount) + '<i class="caret' + (open ? ' up' : '') + '"></i></div>' +
      '</div>';
    return html;
  }

  function detailHtml(b, opts) {
    opts = (opts && typeof opts === 'object') ? opts : {};
    var c = cat(b.category);
    function row(k, v) { return v ? '<div class="d-row"><span>' + k + '</span><b>' + esc(v) + '</b></div>' : ''; }
    var acts = '';
    if (!opts.readonly) {
      acts = '<div class="d-actions">' +
        '<button class="mini" data-act="edit" data-id="' + b.id + '">编辑</button>' +
        '<button class="mini" data-act="dup-one" data-id="' + b.id + '">查重</button>' +
        '<button class="mini' + (b.unsure ? ' on' : '') + '" data-act="toggle-unsure" data-id="' + b.id + '">不记得箱</button>' +
        '<button class="mini' + (b.review ? ' on' : '') + '" data-act="toggle-review" data-id="' + b.id + '">保留箱</button>' +
        (b.counterparty ? '<button class="mini" data-act="filter-merchant" data-m="' + esc(b.counterparty) + '">只看此商户</button>' : '') +
        (b.item ? '<button class="mini" data-act="filter-item" data-m="' + esc(b.item) + '">只看此项目</button>' : '') +
        (b.category ? '<button class="mini" data-act="f-excat" data-val="' + esc(b.category) + '">⊘ 剔除此分类</button>' : '') +
        '<button class="mini" data-act="bill-group-one" data-id="' + b.id + '">分组…</button>' +
        (b.groupId ? '<button class="mini" data-act="group-remove" data-id="' + b.id + '">移出分组</button>' : '') +
        '<button class="mini danger" data-act="delete-one" data-id="' + b.id + '">删除</button>' +
        '</div>';
    }
    return '<div class="detail" data-act="stop">' +
      row('项目', b.item) + row('分类', c.icon + ' ' + c.name) + row('类型', typeName(b.type)) +
      row('对方', b.counterparty) + row('支付方式', b.payment) + row('状态', b.status) +
      row('单号', b.order) + row('备注', b.note) + row('来源', srcName(b.source)) +
      row('标签', (b.tags && b.tags.length) ? b.tags.join('、') : '') +
      row('时间', b.time) + row('导入批次', b.batchId) +
      row('分组', b.groupId && Store.getGroup(b.groupId) ? Store.getGroup(b.groupId).name : '') +
      acts + '</div>';
  }

  /* 通用搜索框：圆角药丸 + 放大镜 + 一键清空（清空按钮用 :placeholder-shown 纯 CSS 控制显隐） */
  var ICON_SEARCH = '<svg class="sb-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
    'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>';
  function searchBox(id, field, value, ph, clearAct, actAttr, extraCls) {
    return '<label class="search-box' + (extraCls ? ' ' + extraCls : '') + '">' +
      ICON_SEARCH +
      '<input class="search" id="' + id + '" ' + (actAttr || ('data-field="' + field + '"')) +
      ' placeholder="' + esc(ph) + '" value="' + esc(value || '') + '">' +
      '<button type="button" class="sb-clear" data-act="' + clearAct + '" title="清空" tabindex="-1">×</button>' +
      '</label>';
  }

  function viewBills() {
    var list = filtered();
    var shown = list.slice(0, S.listLimit);
    var selCount = selectedIds().length;
    return '<section class="page">' +
      '<header class="page-head">' +
      '<h1>账单</h1>' +
      '<div class="tools">' +
      searchBox('f-keyword', 'keyword', S.filters.keyword, '搜索项目 / 对方 / 备注 / 单号…', 'search-clear') +
      '<button class="ghost' + (S.showFilters ? ' on' : '') + '" data-act="filter-toggle">筛选 ' + (S.showFilters ? '▲' : '▼') + '</button>' +
      '<button class="ghost" data-act="scan-dupe">查重</button>' +
      '<button class="ghost" data-act="tab" data-tab="import">＋ 导入账单</button>' +
      '<button class="ghost" data-act="select-all">全选本页</button>' +
      (list.length > shown.length ? '<button class="ghost" data-act="select-all-filtered">全选筛选结果（' + list.length + '）</button>' : '') +
      '<button class="ghost" data-act="sel-category">批量改分类</button>' +
      '</div></header>' +
      filterPanel() +
      activeBar() +
      summaryBar(list) +
      '<div class="list-head">' +
      '<span class="lh-ck"></span>' +
      '<button class="lh" data-act="sort" data-key="date">日期' + sortMark('date') + '</button>' +
      '<button class="lh" data-act="sort" data-key="item">项目' + sortMark('item') + '</button>' +
      '<button class="lh amount" data-act="sort" data-key="amount">金额' + sortMark('amount') + '</button>' +
      '</div>' +
      '<div class="bill-list">' +
      (shown.length ? shown.map(billRow).join('') : '<div class="empty">还没有账单，去「导入」页导入 txt / xlsx 账单吧</div>') +
      '</div>' +
      (list.length > shown.length ? '<div class="more"><button class="ghost" data-act="load-more">加载更多（还有 ' + (list.length - shown.length) + ' 条）</button></div>' : '') +
      '</section>';
  }
  function sortMark(k) { return S.sortKey === k ? (S.sortDesc ? ' ↓' : ' ↑') : ''; }

  /* ============================================================== 商户/对方 */
  function merchantData() {
    var map = {};
    allBills().forEach(function (b) {
      var m = Filters.merchantOf(b) || '（无商户/项目）';
      if (!map[m]) map[m] = { name: m, count: 0, expense: 0n, income: 0n, first: '', last: '', ids: [], items: {} };
      var r = map[m];
      r.count++;
      r.ids.push(b.id);
      var amt = Money.parse(b.amount) || 0n;
      if (b.type === 'income') r.income += amt; else if (b.type !== 'transfer') r.expense += amt;
      if (b.date) { if (!r.first || b.date < r.first) r.first = b.date; if (!r.last || b.date > r.last) r.last = b.date; }
      if (b.item) r.items[b.item] = (r.items[b.item] || 0) + 1;
    });
    var rows = Object.keys(map).map(function (k) { return map[k]; });
    rows.sort(function (a, b) { return (b.count - a.count) || (a.expense < b.expense ? 1 : a.expense > b.expense ? -1 : 0); });
    return rows;
  }
  function merchantFiltered(rows) {
    var kw = (S.merchantSearch || '').trim().toLowerCase();
    var min = Math.max(parseInt(S.merchantMinCount, 10) || 1, S.merchantMultiOnly ? 2 : 1);
    return rows.filter(function (r) {
      if (r.count < min) return false;
      if (kw && r.name.toLowerCase().indexOf(kw) === -1) return false;
      return true;
    });
  }
  function merchantRowsHtml(rows) {
    if (!rows.length) return '<tr><td colspan="6" class="empty">没有符合条件的商户</td></tr>';
    return rows.map(function (r) {
      var topItem = Object.keys(r.items).sort(function (a, b) { return r.items[b] - r.items[a]; })[0] || '';
      return '<tr><td><b>' + esc(r.name) + '</b>' + (r.count >= 2 ? ' <span class="flag dupe">多次</span>' : '') +
        (topItem && topItem !== r.name ? '<small class="m-sub">常买：' + esc(topItem) + '</small>' : '') + '</td>' +
        '<td><b>' + r.count + '</b></td>' +
        '<td class="exp">¥' + fmt(Money.str(r.expense)) + '</td>' +
        '<td class="inc">¥' + fmt(Money.str(r.income)) + '</td>' +
        '<td class="m-range">' + esc(r.first || '—') + (r.last && r.last !== r.first ? '<br>~ ' + esc(r.last) : '') + '</td>' +
        /* 操作按钮排成两行两列，窄屏也不用横向拖动 */
        '<td class="m-acts-td"><div class="m-btns">' +
        '<button class="mini" data-act="merchant-view" data-m="' + esc(r.name) + '" title="在账单页只看这家">看账单</button>' +
        '<button class="mini" data-act="merchant-select" data-m="' + esc(r.name) + '" title="勾选这家的全部账单">全选</button>' +
        '<button class="mini" data-act="merchant-group" data-m="' + esc(r.name) + '" title="把这家的账单存成一个分组">分组</button>' +
        '<button class="mini danger" data-act="merchant-exclude" data-m="' + esc(r.name) + '" title="整家排除（不计入统计）">排除</button>' +
        '</div></td></tr>';
    }).join('');
  }
  function merchantSummaryHtml() {
    var rows = merchantData();
    var shown = merchantFiltered(rows);
    var multi = rows.filter(function (r) { return r.count >= 2; }).length;
    var maxCount = rows.length ? rows.reduce(function (m, r) { return r.count > m ? r.count : m; }, 0) : 0;
    return '<div class="sumbar">' +
      '<div class="s-item"><span>商户总数</span><b>' + rows.length + '</b></div>' +
      '<div class="s-item"><span>笔数 ≥ ' + (parseInt(S.merchantMinCount, 10) || 1) + ' 的商户</span><b>' + shown.length + '</b></div>' +
      '<div class="s-item"><span>多次消费商户（≥2）</span><b>' + multi + '</b></div>' +
      '<div class="s-item net"><span>最高笔数</span><b>' + maxCount + '</b></div>' +
      '</div>';
  }
  function renderMerchantsLight() {
    var tb = document.getElementById('merchant-tbody');
    if (!tb) { render(); return; }
    tb.innerHTML = merchantRowsHtml(merchantFiltered(merchantData()));
    var sb = document.querySelector('.sumbar');
    if (sb) sb.outerHTML = merchantSummaryHtml();
  }
  function viewMerchants() {
    var rows = merchantData();
    var shown = merchantFiltered(rows);
    return '<section class="page"><header class="page-head"><h1>商户 / 对方</h1>' +
      '<div class="tools">' +
      searchBox('m-search', null, S.merchantSearch, '搜索商户名…', 'merchant-search-clear', 'data-act="merchant-search"') +
      '<label class="m-min">笔数 ≥ <input type="text" inputmode="numeric" id="m-min" data-act="merchant-min" value="' + (parseInt(S.merchantMinCount, 10) || 1) + '"></label>' +
      [1, 2, 3, 5].map(function (n) {
        var on = (parseInt(S.merchantMinCount, 10) || 1) === n;
        return '<button class="ghost' + (on ? ' on' : '') + '" data-act="merchant-min-set" data-n="' + n + '">≥' + n + '</button>';
      }).join('') +
      '</div></header>' +
      merchantSummaryHtml() +
      '<p class="hint">按「交易对方」统计，没有对方的账单按项目名归类。用「笔数 ≥ N」只看消费次数达到 N 次的商户（如填 3 就是消费 3 笔以上）；点「在账单中查看」可直接筛选某商户的全部消费。没有单号的账单同样适用。点每条右侧「排除」可把该商户从账单与统计中整体筛掉。</p>' +
      (merchantExcludes().length ? '<div class="excl-bar"><span>🚫 已排除 ' + merchantExcludes().length + ' 个商户/关键词，其账单不显示也不计入统计：</span>' +
        merchantExcludes().map(function (w) {
          return '<button class="chip on" data-act="mex-del" data-word="' + esc(w) + '" title="点击恢复">' + esc(w) + ' ×</button>';
        }).join('') +
        '<button class="ghost" data-act="mex-clear">全部恢复</button>' +
        '<button class="ghost" data-act="mex-hide-toggle">' + (hideExcluded() ? '👁 总账单里也显示它们' : '🚫 总账单里不显示它们') + '</button></div>' : '') +
      '<div class="card"><div class="table-wrap"><table class="preview merchant-table"><thead><tr>' +
      '<th>商户 / 对方</th><th>笔数</th><th>支出合计</th><th>收入合计</th><th>时间范围</th><th>操作</th>' +
      '</tr></thead><tbody id="merchant-tbody">' + merchantRowsHtml(shown) + '</tbody></table></div></div>' +
      '</section>';
  }

  /* ------------------------------------------------------------ 查重勾选
   * 默认每组留下“信息最全”的一条，其余勾选为待删除，用户核对后一键删。 */
  function pickDupKeep(bills) {
    var best = 0, bestScore = -1;
    bills.forEach(function (b, i) {
      var s = 0;
      if (b.order) s += 100;
      if (b.time) s += 4;
      if (b.counterparty) s += 3;
      if (b.category && b.category !== 'other' && b.category !== 'other_in') s += 3;
      if (b.item) s += 2;
      if (b.note) s += 1;
      if (b.tags && b.tags.length) s += 1;
      if (s > bestScore) { bestScore = s; best = i; }
    });
    return best;
  }
  function dupSelIds() {
    return Object.keys(S.dupSel).filter(function (k) { return S.dupSel[k]; });
  }
  function seedDupSel(groups) {
    groups = groups || Dedupe.findDuplicateGroups(allBills());
    S.dupSel = {};
    groups.forEach(function (g) {
      var k = pickDupKeep(g.bills);
      g.bills.forEach(function (b, i) { if (i !== k) S.dupSel[b.id] = true; });
    });
    return groups;
  }
  function dupGroupByKey(key) {
    return Dedupe.findDuplicateGroups(allBills()).filter(function (g) { return g.key === key; })[0];
  }

  /* ================================================================ 导入 */
  /* 导入教程：各平台账单下载 / 导出路径 */
  var IMPORT_TUTORIAL = [
    {
      name: '💚 微信支付',
      out: '导出为 .csv（邮件里的压缩包需先解压）',
      steps: [
        '微信 → 我 → 服务 → 钱包 → 右上角「账单」',
        '账单页右上角「常见问题」→「下载账单」→ 选择「用于个人对账」',
        '选择时间范围（一般最多 1 个月，可自定义）→ 填邮箱',
        '到邮箱下载压缩包，解压密码在微信「账单」页面查看',
        '解压得到 .csv 文件，直接拖进本工具即可（微信账单通常带「交易时间 / 交易类型 / 交易对方 / 商品 / 收/支 / 金额 / 支付方式 / 当前状态 / 交易单号」等列）'
      ]
    },
    {
      name: '💙 支付宝',
      out: '导出为 .csv（邮件压缩包，建议按月导出）',
      steps: [
        '支付宝 → 我的 → 账单 → 右上角「···」',
        '选择「开具交易流水证明」或「账单导出」→「用于个人对账」',
        '选择时间范围（可选择某个月或自定义区间）→ 填邮箱',
        '到邮箱下载压缩包，解压密码按邮件/支付宝提示获取',
        '解压得到 .csv，拖进本工具；支付宝账单带「交易时间 / 交易分类 / 交易对方 / 商品说明 / 收/支 / 金额 / 收/付款方式 / 交易状态 / 交易订单号」等列'
      ]
    },
    {
      name: '🧡 美团 / 大众点评',
      out: '部分版本支持导出，否则用「粘贴文字」导入',
      steps: [
        '美团 → 我的 → 钱包 / 账单 → 账单明细',
        '尝试右上角「···」→「账单导出 / 发送到邮箱」（部分版本提供）',
        '若没有导出入口：在账单页把明细文字复制下来',
        '回到本工具「导入账单」页，粘贴到「直接粘贴账单文字」框 → 点「解析粘贴内容」'
      ]
    },
    {
      name: '🖤 抖音 / 抖音支付',
      out: '支持账单导出，也可粘贴导入',
      steps: [
        '抖音 → 我 → 右上角「≡」→ 我的钱包 → 账单',
        '账单页右上角「···」或进「帮助 / 客服」找「账单导出 / 交易流水」',
        '或：抖音 → 我 → 设置 → 支付设置 → 交易记录 / 账单导出',
        '填写邮箱并选择时间范围，收到文件后导入；没有导出入口就用「粘贴文字」方式'
      ]
    },
    {
      name: '❤️ 拼多多',
      out: '通常无标准账单文件，建议粘贴文字导入',
      steps: [
        '拼多多 → 个人中心 → 我的订单（含拼单、退款）',
        '如需明细：个人中心 → 官方客服 → 申请交易明细（可能需人工处理）',
        '简单办法：在订单 / 账单页复制明细文字，粘贴到本工具的「直接粘贴账单文字」框解析'
      ]
    },
    {
      name: '🏦 银行 / 信用卡',
      out: '导出 Excel / CSV，或用微信·支付宝账单代替',
      steps: [
        '手机银行 / 网上银行 → 账户明细 / 交易流水',
        '选择时间范围 →「导出」（Excel / CSV）或「发送到邮箱」',
        '若银行只给 .xls：用 Excel / WPS 打开后「另存为 → Excel 工作簿 (.xlsx)」再导入',
        '日常消费大多也出现在微信 / 支付宝账单里，两者选一个导出即可，避免重复（重复的可以用「查重」一键清理）'
      ]
    }
  ];

  /* 教程默认文案（纯文本版，方便用户在「编辑教程」里改成自己的步骤） */
  function defaultTutorialText() {
    return IMPORT_TUTORIAL.map(function (t) {
      return t.name + '　' + t.out + '\n' + t.steps.map(function (s, i) { return '  ' + (i + 1) + '. ' + s; }).join('\n');
    }).join('\n\n');
  }
  function tutorialCustom() { return String((Store.state.settings && Store.state.settings.tutorial) || ''); }
  function tutorialText() { return tutorialCustom() || defaultTutorialText(); }
  /* 把自定义教程文本还原成「一个平台一个方块」：
   * 空行分隔平台；每个平台首行是「平台名　导出格式」，其余行是步骤。 */
  function tutorialBlocks(text) {
    var raw = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return [];
    return raw.split(/\n[ \t]*\n/).map(function (block) {
      var lines = block.split('\n').map(function (x) { return x.replace(/[ \t]+$/, ''); });
      var head = (lines.shift() || '').trim();
      var name = head, out = '', i;
      if ((i = head.indexOf('　')) !== -1) { name = head.slice(0, i).trim(); out = head.slice(i + 1).trim(); }
      else if ((i = head.indexOf('\t')) !== -1) { name = head.slice(0, i).trim(); out = head.slice(i + 1).trim(); }
      else { var m = head.match(/^(.+?)\s{2,}(.+)$/); if (m) { name = m[1].trim(); out = m[2].trim(); } }
      var steps = lines.map(function (l) { return l.replace(/^\s*(\d+[.、)]|[-*•])\s*/, '').trim(); })
        .filter(function (l) { return l.length; });
      return { name: name || '未命名', out: out, steps: steps };
    });
  }
  function tutorialGrid(items) {
    return '<div class="tut-grid">' + items.map(function (t) {
      return '<div class="tut-item"><b>' + esc(t.name) + '</b>' +
        (t.out ? '<span class="tut-out">' + esc(t.out) + '</span>' : '') +
        (t.steps && t.steps.length ? '<ol>' + t.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  function importTutorial() {
    var custom = tutorialCustom();
    return '<div class="card tut">' +
      '<details class="adv"><summary>📖 各平台账单怎么导出？点这里看教程（微信 / 支付宝 / 美团 / 抖音 / 拼多多 / 银行）</summary>' +
      (custom ? tutorialGrid(tutorialBlocks(custom)) : tutorialGrid(IMPORT_TUTORIAL)) +
      '<p class="hint">各 App 版本不同，入口名称可能略有差异，按「账单 / 交易流水 / 导出」关键词找即可。' +
      '导出的文件若是 <b>.zip / .rar</b>，请先解压；若是 <b>.xls</b>，请另存为 <b>.xlsx</b> 再导入。' +
      '实在找不到导出入口，就在账单页复制文字，用下面的「直接粘贴账单文字」解析。</p>' +
      '<div class="tut-acts"><button class="mini" data-act="tut-edit">✏ 编辑教程</button>' +
      (custom ? '<button class="mini" data-act="tut-reset">↩ 恢复内置教程</button>' : '') +
      '</div>' +
      '</details></div>';
  }

  function viewImport() {
    var imp = S.imp;
    if (!imp || imp.step === 'choose') {
      return '<section class="page"><header class="page-head"><h1>导入账单</h1></header>' +
        '<div class="grid2">' +
        '<div class="card drop" id="dropzone">' +
        '<div class="drop-inner"><div class="drop-ico">⬆️</div><b>拖入文件，或点击选择</b>' +
        '<small>支持 .xlsx / .xls(需转存) / .csv / .txt，支付宝、微信、银行、京东等导出文件均可</small>' +
        '<button class="primary" data-act="pick-file">选择文件</button>' +
        '<input type="file" id="fileinput" accept=".xlsx,.xls,.csv,.txt,.tsv" hidden></div></div>' +
        '<div class="card"><b>或者直接粘贴账单文本</b>' +
        '<textarea id="paste-box" class="paste" placeholder="从支付宝/微信/银行复制账单文字，粘贴到这里…&#10;每行一条，或带表头的表格格式"></textarea>' +
        '<button class="primary" data-act="parse-text">解析粘贴内容</button></div>' +
        '</div>' +
        importTutorial() +
        (imp && imp.error ? '<div class="error">' + esc(imp.error) + '</div>' : '') +
        '</section>';
    }

    if (imp.step === 'mapping') {
      var t = imp.table;
      var mapping = imp.mapping;
      if (!imp.skipRows) imp.skipRows = {};
      var skipCount = Object.keys(imp.skipRows).length;
      var buildCount = t.rows.length - skipCount;
      var fields = [
        ['date', '日期/时间'], ['amount', '金额'], ['direction', '收/支'], ['income', '收入额'],
        ['expense', '支出额'], ['desc', '商品/说明'], ['counterparty', '交易对方'], ['typeRaw', '类型'],
        ['category', '分类列'], ['payment', '支付方式'], ['status', '状态'], ['order', '单号'],
        ['note', '备注'], ['source', '来源/平台'], ['time', '时间列']
      ];
      var headerOpts = ['<option value="-1">（无）</option>'].concat(t.headers.map(function (h, i) {
        return '<option value="' + i + '">' + esc(h || ('第' + (i + 1) + '列')) + '</option>';
      })).join('');
      return '<section class="page"><header class="page-head"><h1>确认列对应关系</h1>' +
        '<div class="tools"><button class="ghost" data-act="imp-cancel">返回</button></div></header>' +
        '<div class="card">' +
        '<div class="imp-meta">来源：<select data-act="imp-source">' + allSourceIds().map(function (id) {
          return '<option value="' + id + '"' + (imp.source === id ? ' selected' : '') + '>' + esc(srcName(id)) + '</option>';
        }).join('') + '</select>' +
        '<button class="mini" data-act="src-new-import" title="新建一个来源（例如某张饭卡、某个平台）">＋ 新建来源…</button>' +
        (mapping && mapping.source >= 0
          ? ' <b>检测到「' + esc(t.headers[mapping.source] || '来源') + '」列</b>：每行按表格内容识别来源，识别不出的行才用上面选的这个'
          : ' <span class="hint">表格里没有来源列，这批账单都记到上面选的来源</span>') +
        (imp.sheets && imp.sheets.length > 1 ? ' · 工作表：<select data-act="imp-sheet">' + imp.sheets.map(function (s, i) {
          return '<option value="' + i + '"' + (i === imp.sheetIndex ? ' selected' : '') + '>' + esc(s) + '</option>';
        }).join('') + '</select>' : '') +
        ' · 数据行：<b>' + t.rows.length + '</b>' +
        (skipCount ? ' · <b class="warn">已跳过 ' + skipCount + ' 行</b>' : '') +
        (imp.errors && imp.errors.length ? ' · <span class="warn">' + imp.errors.length + ' 行无法识别金额</span>' : '') + '</div>' +
        '<details class="adv" open><summary>调整列对应（已自动识别，若对不上可手动改）</summary><div class="mapgrid">' +
        fields.map(function (f) {
          return '<label>' + f[1] + '<select data-map="' + f[0] + '">' +
            headerOpts.replace('value="' + mapping[f[0]] + '"', 'value="' + mapping[f[0]] + '" selected') + '</select></label>';
        }).join('') +
        '<label>类型强制<select data-act="imp-force-type">' +
        ['auto:自动判断', 'expense:全部算支出', 'income:全部算收入', 'transfer:全部算转账'].map(function (o) {
          var p = o.split(':');
          return '<option value="' + p[0] + '"' + (imp.forceType === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
        }).join('') + '</select></label>' +
        '</div></details>' +
        '<div class="preview-head">' +
        '<div class="preview-title">数据预览（共 ' + t.rows.length + ' 行，可逐行勾选「不导入」）</div>' +
        '<div class="preview-tools">' +
        '<button class="ghost" data-act="imp-rows-autoskip">自动跳过无法识别金额的行</button>' +
        '<button class="ghost" data-act="imp-rows-restore">恢复全部行</button>' +
        '</div></div>' +
        '<div class="table-wrap tall"><table class="preview"><thead><tr>' +
        '<th class="c-skip">不导入</th><th>#</th>' +
        t.headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '<th class="c-del"></th></tr></thead><tbody>' +
        t.rows.map(function (r, i) {
          var skipped = !!imp.skipRows[i];
          return '<tr class="' + (skipped ? 'skip' : '') + '">' +
            '<td class="c-skip"><label class="ck"><input type="checkbox" data-act="imp-row-toggle" data-i="' + i + '"' + (skipped ? ' checked' : '') + '></label></td>' +
            '<td>' + (i + 1) + '</td>' +
            t.headers.map(function (_, ci) { return '<td>' + esc(r[ci] || '') + '</td>'; }).join('') +
            '<td class="c-del"><button class="mini' + (skipped ? '' : ' danger') + '" data-act="imp-row-toggle" data-i="' + i + '">' + (skipped ? '恢复' : '删除') + '</button></td>' +
            '</tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="actions"><button class="primary" data-act="imp-build">下一步：生成账单' +
        (buildCount !== t.rows.length ? '（' + buildCount + ' 条）' : '') + '</button>' +
        '<button class="ghost" data-act="imp-cancel">取消</button></div>' +
        '</div></section>';
    }

    if (imp.step === 'dup') {
      var groups = imp.dupGroups;
      return '<section class="page"><header class="page-head"><h1>发现疑似重复</h1></header>' +
        '<div class="card">' +
        '<p>共找到 <b>' + groups.length + '</b> 组重复（判定依据：<b>单号相同</b>；仅当没有单号时才用「日期 + 项目 + 金额」判断，单号不同绝不会被判为重复）。请选择如何处理：</p>' +
        '<div class="dup-list">' + groups.slice(0, 100).map(function (g, i) {
          var b = g.sample;
          return '<div class="dup-group"><div class="dup-head">' +
            '<b>' + esc(b.date) + ' · ' + esc(b.item) + ' · <span class="exp">¥' + fmt(b.amount) + '</span></b>' +
            '<span class="pill">共 ' + g.count + ' 条</span>' +
            (g.key.indexOf('order|') === 0 ? '<span class="flag dupe">单号相同</span>' : '<span class="flag unsure">无单号·启发式</span>') +
            '<div class="dup-act">' +
            ['keep:全部保留', 'one:只留一条', 'review:放入保留箱', 'drop:全部丢弃'].map(function (o) {
              var p = o.split(':');
              var on = imp.dupChoice[i] === p[0];
              return '<button class="mini' + (on ? ' on' : '') + '" data-act="dup-choice" data-i="' + i + '" data-v="' + p[0] + '">' + p[1] + '</button>';
            }).join('') + '</div></div>' +
            '<div class="bill-list">' + g.bills.map(function (x) { return billRow(x, { selectable: false, readonly: true }); }).join('') + '</div>' +
            '</div>';
        }).join('') + '</div>' +
        '<div class="actions"><button class="primary" data-act="imp-finish">完成导入</button>' +
        '<button class="ghost" data-act="dup-all-review">全部放入保留箱</button>' +
        '<button class="ghost" data-act="dup-all-keep">全部保留</button></div>' +
        '</div></section>';
    }
    return '';
  }

  /* ============================================================== 计算器 */
  function calcPoolHtml() {
    var kw = (S.calcPick || '').trim().toLowerCase();
    var pool = calcPoolBills().filter(function (b) {
      if (!kw) return true;
      return ((b.item || '') + ' ' + (b.counterparty || '') + ' ' + (b.note || '') + ' ' + (b.date || '')).toLowerCase().indexOf(kw) !== -1;
    });
    return pool.slice(0, 300).map(function (b) {
      var sign = b.type === 'income' ? '+' : (b.type === 'transfer' ? '±' : '−');
      return '<button class="pool-row ' + (b.type === 'income' ? 'inc' : (b.type === 'transfer' ? 'tr' : 'exp')) + '" data-act="calc-add" data-id="' + b.id + '" title="点击加入算式">' +
        '<span class="p-date">' + esc(b.date || '') + '</span>' +
        '<span class="p-item">' + esc(b.item || '（无项目）') + (b.counterparty ? ' · ' + esc(b.counterparty) : '') + '</span>' +
        '<span class="p-amt">' + sign + '¥' + fmt(b.amount) + '</span></button>';
    }).join('') || '<div class="empty">没有匹配的账单</div>';
  }
  function renderCalcPool() {
    var wrap = document.querySelector('.calc-pool-list');
    if (wrap) wrap.innerHTML = calcPoolHtml();
    else render();
  }

  function calcModeSwitch() {
    return '<div class="calc-mode">' +
      [['step', '✋ 逐步算账（点账单一步步加减）'], ['summary', 'Σ 汇总统计（合计 / 平分）']].map(function (o) {
        return '<button class="' + ((S.calcMode || 'step') === o[0] ? 'on' : '') + '" data-act="calc-mode" data-mode="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div>';
  }

  /* 逐步算账：点账单一条条累加，显示每一步加减与小计 */
  function viewCalcStep() {
    var kw = (S.calcPick || '').trim().toLowerCase();
    var pool = calcPoolBills().filter(function (b) {
      if (!kw) return true;
      return ((b.item || '') + ' ' + (b.counterparty || '') + ' ' + (b.note || '') + ' ' + (b.date || '')).toLowerCase().indexOf(kw) !== -1;
    });
    var expr = S.calcExpr || [];
    var run = 0n, inc = 0n, exp = 0n, lines = '';
    expr.forEach(function (s, i) {
      var a = Money.parse(s.amount) || 0n;
      run = s.sign > 0 ? run + a : run - a;
      if (s.sign > 0) inc += a; else exp += a;
      lines += '<div class="step-row' + (s.sign > 0 ? ' plus' : ' minus') + '">' +
        '<span class="s-n">' + (i + 1) + '</span>' +
        '<span class="s-date">' + esc(s.date || '') + '</span>' +
        '<span class="s-item">' + esc(s.item || '（无项目）') + (s.counterparty ? ' · ' + esc(s.counterparty) : '') + '</span>' +
        '<span class="s-amt ' + (s.sign > 0 ? 'inc' : 'exp') + '">' + (s.sign > 0 ? '＋' : '－') + '¥' + fmt(a) + '</span>' +
        '<span class="s-run">＝ <b>' + (run < 0n ? '－' : '') + '¥' + fmt(Money.abs(run)) + '</b></span>' +
        '<span class="s-act">' +
        '<button class="mini" data-act="calc-flip-step" data-i="' + i + '" title="切换 加/减">' + (s.sign > 0 ? '＋' : '－') + '</button>' +
        '<button class="mini danger" data-act="calc-del-step" data-i="' + i + '" title="从算式移除">×</button></span>' +
        '</div>';
    });
    var exprText = expr.map(function (s) {
      return (s.sign > 0 ? '+ ' : '- ') + Money.str(s.amount) + (s.item ? '（' + s.item + '）' : '');
    }).join('\n') + (expr.length ? '\n= ' + Money.str(run) : '');

    return '<section class="page"><header class="page-head"><h1>账单计算器</h1>' +
      '<div class="tools"><span class="pill">' + (expr.length ? expr.length + ' 步' : '点击下方账单开始算') + '</span>' +
      '<button class="ghost" data-act="calc-undo" ' + (expr.length ? '' : 'disabled') + '>撤销上一步</button>' +
      '<button class="ghost" data-act="calc-clear" ' + (expr.length ? '' : 'disabled') + '>清空算式</button>' +
      '<button class="ghost" data-act="calc-copy">复制算式</button>' +
      '</div></header>' +
      calcModeSwitch() +
      (filterActive()
        ? '<div class="calc-scope">🔎 只算账单页当前筛选出来的 <b>' + pool.length + '</b> 条' +
          '<button class="ghost" data-act="calc-use-all">改成算全部账单</button>' +
          '<button class="ghost" data-act="calc-goto-filter">去账单页改筛选</button></div>'
        : '') +
      '<div class="calc-sum">' +
      '<div class="cs exp"><span>减（支出）</span><b>¥' + fmt(exp) + '</b></div>' +
      '<div class="cs inc"><span>加（收入）</span><b>¥' + fmt(inc) + '</b></div>' +
      '<div class="cs net"><span>合计结果</span><b>' + (run < 0n ? '－' : '') + '¥' + fmt(Money.abs(run)) + '</b></div>' +
      '<div class="cs"><span>步数</span><b>' + expr.length + '</b></div>' +
      '</div>' +
      '<div class="calc-step-wrap">' +
      '<div class="card calc-expr"><b>算式流水（每一步都能看到加减过程）</b>' +
      (expr.length ? lines +
        '<div class="step-total"><span>合计</span><b class="' + (run < 0n ? 'exp' : 'inc') + '">' + (run < 0n ? '－' : '') + '¥' + fmt(Money.abs(run)) + '</b></div>'
        : '<div class="empty">还没有加入账单。点右边的账单，收入算「加」、支出算「减」，每点一次都会多一步。</div>') +
      '</div>' +
      '<div class="card calc-pool"><b>点下面的账单加入算式（' + pool.length + ' 条）</b>' +
      searchBox('calc-search', null, S.calcPick, '搜索要算的账单…', 'calc-search-clear', 'data-act="calc-search"') +
      '<div class="calc-pool-list">' + calcPoolHtml() + '</div>' +
      '</div></div>' +
      '<textarea id="calc-expr-text" class="calc-expr-text" readonly hidden>' + esc(exprText) + '</textarea>' +
      '</section>';
  }

  function viewCalc() {
    if ((S.calcMode || 'step') === 'step') return viewCalcStep();
    var list = targetBills();
    var usingSelection = selectedIds().length > 0;
    var expBig = 0n, incBig = 0n, trBig = 0n;
    list.forEach(function (b) {
      var a = Money.parse(b.amount) || 0n;
      if (b.type === 'expense') expBig += a; else if (b.type === 'income') incBig += a; else trBig += a;
    });
    S.calcManual.forEach(function (m) {
      var a = Money.parse(m.amount) || 0n;
      if (m.type === 'income') incBig += a; else expBig += a;
    });
    var netBig = Money.sub(incBig, expBig);

    var rows = list.map(function (b, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(b.date) + '</td><td>' + esc(b.item) + '</td>' +
        '<td>' + esc(cat(b.category).name) + '</td><td class="' + (b.type === 'income' ? 'inc' : b.type === 'transfer' ? '' : 'exp') + '">' +
        (b.type === 'income' ? '+' : b.type === 'transfer' ? '' : '-') + '¥' + fmt(b.amount) + '</td></tr>';
    }).join('');
    var manualRows = S.calcManual.map(function (m, i) {
      return '<tr><td>*</td><td>手动</td><td>' + esc(m.item) + '</td><td>手动项</td>' +
        '<td class="' + (m.type === 'income' ? 'inc' : 'exp') + '">' + (m.type === 'income' ? '+' : '-') + '¥' + fmt(m.amount) + '</td>' +
        '<td><button class="mini danger" data-act="calc-del-manual" data-i="' + i + '">删</button></td></tr>';
    }).join('');

    var splitHtml = '';
    if (S.calcSplit > 0 && expBig !== 0n) {
      var parts = Money.splitEven(expBig, S.calcSplit);
      splitHtml = '<div class="split"><b>按支出一共 ¥' + fmt(expBig) + ' 平均分成 ' + S.calcSplit + ' 份（分文不差）：</b>' +
        '<div class="split-grid">' + parts.map(function (p, i) { return '<span>第' + (i + 1) + '份 ¥' + fmt(p) + '</span>'; }).join('') + '</div>' +
        '<small>合计校验：¥' + fmt(Money.sumBig(parts)) + '（与总额完全一致）</small></div>';
    }

    return '<section class="page"><header class="page-head"><h1>账单计算器</h1>' +
      '<div class="tools"><span class="pill">' + (usingSelection ? '已选 ' + list.length + ' 条账单' : '未选择 → 用当前筛选结果 ' + list.length + ' 条') + '</span>' +
      '<button class="ghost" data-act="calc-select-tab">去账单页勾选</button></div></header>' +
      calcModeSwitch() +
      '<div class="calc-sum">' +
      '<div class="cs exp"><span>支出合计</span><b>¥' + fmt(expBig) + '</b></div>' +
      '<div class="cs inc"><span>收入合计</span><b>¥' + fmt(incBig) + '</b></div>' +
      '<div class="cs tr"><span>转账/中性</span><b>¥' + fmt(trBig) + '</b></div>' +
      '<div class="cs net"><span>净额</span><b>¥' + fmt(netBig) + '</b></div>' +
      '</div>' +
      '<div class="card">' +
      '<div class="calc-tools">' +
      '<button class="ghost" data-act="calc-add-manual">＋ 添加手动项</button>' +
      '<label>平均分成 <input type="number" min="0" value="' + (S.calcSplit || '') + '" data-act="calc-split" placeholder="份数"></label>' +
      '<button class="ghost" data-act="calc-copy">复制计算结果</button>' +
      '</div>' +
      splitHtml +
      '<div class="table-wrap"><table class="calc"><thead><tr><th>#</th><th>日期</th><th>项目</th><th>分类</th><th>金额</th><th></th></tr></thead>' +
      '<tbody>' + (rows + manualRows || '<tr><td colspan="6" class="empty">没有可计算的账单</td></tr>') + '</tbody>' +
      '<tfoot><tr><td colspan="4"><b>合计（支出 ¥' + fmt(expBig) + ' ／ 收入 ¥' + fmt(incBig) + '）</b></td>' +
      '<td colspan="2"><b>净额 ¥' + fmt(netBig) + '</b></td></tr></tfoot></table></div>' +
      '</div></section>';
  }

  /* ================================================================ 图表 */
  var CHART_DIMS = [
    ['category', '分类'], ['source', '来源'], ['merchant', '商户/对方'], ['month', '月份'],
    ['year', '年份'], ['weekday', '星期'], ['group', '分组'], ['day', '每日'], ['type', '收支类型']
  ];
  var CHART_KINDS = [['expense', '支出'], ['income', '收入'], ['all', '收支都有']];
  function chartKind() { return S.chart.kind || 'expense'; }
  function chartKindName() { return { expense: '支出', income: '收入', all: '收支' }[chartKind()]; }
  /* 图表数据源 = 「期间」+ 筛选条件 + 收支类型 */
  function chartList() {
    var list = Filters.apply(periodBills(), S.filters);
    var k = chartKind();
    if (k === 'expense') return list.filter(function (b) { return b.type === 'expense'; });
    if (k === 'income') return list.filter(function (b) { return b.type === 'income'; });
    return list.filter(function (b) { return b.type === 'expense' || b.type === 'income'; });
  }
  function periodLabel() {
    var p = periodParts();
    if (!p.year) return '全部时间';
    return p.year + ' 年' + (p.month ? ' ' + Number(p.month) + ' 月' : '');
  }
  /* 每个维度的取值函数：图表分组和「点图表看明细」共用同一份，保证点哪组就出哪组的账单 */
  function chartKeyFns() {
    var dim = S.chart.dim;
    if (dim === 'category') return { keyFn: function (b) { return b.category; }, labelFn: function (k) { return cat(k).icon + ' ' + cat(k).name; } };
    if (dim === 'source') return { keyFn: function (b) { return b.source; }, labelFn: srcName };
    if (dim === 'merchant') return { keyFn: Filters.merchantOf, labelFn: function (k) { return k || '（无商户/项目）'; } };
    if (dim === 'month') return { keyFn: function (b) { return Util.monthOf(b.date) || '未知'; }, labelFn: function (k) { return k; } };
    if (dim === 'year') return { keyFn: function (b) { return Util.yearOf(b.date) || '未知'; }, labelFn: function (k) { return k + ' 年'; } };
    if (dim === 'weekday') return { keyFn: function (b) { return Util.weekday(b.date) || '未知'; }, labelFn: function (k) { return k; } };
    if (dim === 'group') return { keyFn: function (b) { return b.groupId || Filters.NONE; }, labelFn: function (k) { return k === Filters.NONE ? '未分组' : (Store.getGroup(k) ? Store.getGroup(k).name : k); } };
    if (dim === 'type') return { keyFn: function (b) { return b.type; }, labelFn: typeName };
    return { keyFn: function (b) { return b.date || '未知'; }, labelFn: function (k) { return k.slice(5); } };
  }
  function chartData() {
    var list = chartList();
    var kf = chartKeyFns(), keyFn = kf.keyFn, labelFn = kf.labelFn;

    var stat = Filters.groupStat(list, keyFn, null);
    var items = stat.list.map(function (x, i) { return { key: x.key, label: labelFn(x.key), value: Number(x.amountBig) / 1e6, valueText: fmt(x.amount), color: Charts.color(i), count: x.count }; });
    var isSeries = S.chart.type === 'stacked' || S.chart.type === 'grouped';
    var series = null, labels = null;
    if (isSeries) {
      var seriesType = chartKind() === 'income' ? 'income' : 'expense';
      var months = Object.keys(Util.groupBy(list, function (b) { return Util.monthOf(b.date) || '未知'; })).sort();
      labels = months;
      var cats = Filters.byCategory(list, seriesType).list.slice(0, 6).map(function (x) { return x.key; });
      series = cats.map(function (cid, i) {
        return {
          name: cat(cid).name, color: Charts.color(i),
          values: months.map(function (mo) {
            return Number(Money.sumBig(list.filter(function (b) { return b.type === seriesType && b.category === cid && (Util.monthOf(b.date) || '未知') === mo; }).map(function (b) { return b.amount; }))) / 1e6;
          })
        };
      });
    }
    return { items: items, series: series, labels: labels, total: stat.total, count: list.length };
  }

  function periodBills() {
    var all = allBills();
    if (!S.statsPeriod || S.statsPeriod === 'all') return all;
    return all.filter(function (b) {
      if (S.statsPeriod.length === 4) return Util.yearOf(b.date) === S.statsPeriod;
      return Util.monthOf(b.date) === S.statsPeriod;
    });
  }
  /* 时间段拆成「年份 + 月份」两个下拉（年月分开，更好选也更好看） */
  function periodParts() {
    var p = S.statsPeriod;
    if (!p || p === 'all') return { year: '', month: '' };
    if (p.length === 4) return { year: p, month: '' };
    return { year: p.slice(0, 4), month: p.slice(5) };
  }
  function periodYears() {
    var y = {};
    allBills().forEach(function (b) { var v = Util.yearOf(b.date); if (v) y[v] = 1; });
    return Object.keys(y).sort().reverse();
  }
  function periodMonths(year) {
    var m = {};
    allBills().forEach(function (b) {
      var mo = Util.monthOf(b.date);
      if (!mo) return;
      if (year && mo.slice(0, 4) !== year) return;
      m[mo.slice(5)] = 1;
    });
    return Object.keys(m).sort();
  }
  function setPeriod(year, month) {
    if (!year) { S.statsPeriod = 'all'; return; }
    S.statsPeriod = month ? (year + '-' + month) : year;
  }
  function periodControls() {
    var p = periodParts(), years = periodYears(), months = periodMonths(p.year);
    return '<div class="period-pick"><span class="ct-lab">看哪段时间</span>' +
      '<select class="sel-y" data-act="stats-year">' +
      '<option value=""' + (!p.year ? ' selected' : '') + '>全部年份</option>' +
      years.map(function (y) { return '<option value="' + y + '"' + (p.year === y ? ' selected' : '') + '>' + y + ' 年</option>'; }).join('') +
      '</select>' +
      '<select class="sel-m" data-act="stats-month">' +
      '<option value=""' + (!p.month ? ' selected' : '') + '>全部月份</option>' +
      months.map(function (m) { return '<option value="' + m + '"' + (p.month === m ? ' selected' : '') + '>' + Number(m) + ' 月</option>'; }).join('') +
      '</select>' +
      (p.year ? '<button class="ghost" data-act="period-all" title="回到全部时间">全部时间</button>' : '') +
      '</div>';
  }
  function periodOptions() {
    return [['all', '全部时间']].concat(periodYears().map(function (y) { return [y, y + ' 年']; }));
  }

  /* 把放大后的金额（1e6）按「分」四舍五入，避免平均值出现 792.228571 这种尾巴 */
  function roundCents(v) {
    var unit = 10000n, q = v / unit, r = v % unit;
    if (r < 0n) r = -r;
    if (r * 2n >= unit) q += (v < 0n ? -1n : 1n);
    return q * unit;
  }

  /* 自动统计亮点：某月/某年花得最多的一笔、最多的一天/月、最常去的商户… */
  function statsPanel() {
    var list = periodBills();
    var exp = list.filter(function (b) { return b.type === 'expense'; });
    var inc = list.filter(function (b) { return b.type === 'income'; });
    var s = Filters.summary(list);
    function maxOf(arr) {
      var m = null;
      arr.forEach(function (b) { if (!m || Money.cmp(Money.parse(b.amount), Money.parse(m.amount)) > 0) m = b; });
      return m;
    }
    var maxExp = maxOf(exp), maxInc = maxOf(inc);
    var byDay = {}, byMon = {}, byCat = {}, byMer = {};
    exp.forEach(function (b) {
      var a = Money.parse(b.amount) || 0n;
      byDay[b.date || '—'] = (byDay[b.date || '—'] || 0n) + a;
      var mo = Util.monthOf(b.date) || '—'; byMon[mo] = (byMon[mo] || 0n) + a;
      var cn = cat(b.category).name; byCat[cn] = (byCat[cn] || 0n) + a;
      var me = Filters.merchantOf(b) || '（无商户/项目）'; byMer[me] = (byMer[me] || 0) + 1;
    });
    function topBig(map) { var k = null, bv = -1n; Object.keys(map).forEach(function (x) { if (map[x] > bv) { bv = map[x]; k = x; } }); return k ? { k: k, v: map[k] } : null; }
    function topCount(map) { var k = null, bv = -1; Object.keys(map).forEach(function (x) { if (map[x] > bv) { bv = map[x]; k = x; } }); return k ? { k: k, v: map[k] } : null; }
    var topDay = topBig(byDay), topMon = topBig(byMon), topCat = topBig(byCat), topMer = topCount(byMer);
    var avg = exp.length ? Money.str(roundCents(Money.div(Money.parse(s.expense) || 0n, exp.length, 'half-up'))) : '0';
    function card(label, big, sub, color) {
      return '<div class="hl-card"><span>' + label + '</span><b class="' + (color || '') + '">' + big + '</b><small>' + esc(sub || '') + '</small></div>';
    }
    return '<div class="card"><div class="hl-head"><b>📌 统计亮点</b>' + periodControls() + '</div>' +
      '<div class="hl-grid">' +
      (maxExp ? card('最大单笔支出', '¥' + fmt(maxExp.amount), (maxExp.item || '') + ' · ' + (maxExp.date || ''), 'exp') : card('最大单笔支出', '—', '该时间段没有支出')) +
      (topDay ? card('花得最多的一天', '¥' + fmt(Money.str(topDay.v)), topDay.k, 'exp') : '') +
      (topMon ? card('花得最多的月份', '¥' + fmt(Money.str(topMon.v)), topMon.k, 'exp') : '') +
      (topCat ? card('支出最多的分类', '¥' + fmt(Money.str(topCat.v)), topCat.k) : '') +
      (topMer ? card('消费次数最多', topMer.v + ' 次', topMer.k) : '') +
      (exp.length ? card('平均每笔支出', '¥' + fmt(avg), exp.length + ' 笔支出') : '') +
      (maxInc ? card('最大单笔收入', '¥' + fmt(maxInc.amount), (maxInc.item || '') + ' · ' + (maxInc.date || ''), 'inc') : '') +
      card('支出合计', '¥' + fmt(s.expense), list.length + ' 笔账单', 'exp') +
      '</div>' +
      '<p class="hint">按「' + periodLabel() + '」自动统计。上面选年份 / 月份即可看某月 / 某年花得最多的一笔。</p>' +
      '</div>';
  }

  function viewCharts() {
    var d = chartData();
    var isSeries = S.chart.type === 'stacked' || S.chart.type === 'grouped';
    var dimIsCat = S.chart.dim === 'category';
    return '<section class="page"><header class="page-head"><h1>可视化</h1>' +
      '<div class="tools"><button class="ghost" data-act="f-quick-month">只看本月</button></div></header>' +
      statsPanel() +
      '<div class="card">' +
      '<div class="chart-tools">' +
      '<div class="ct-row">' +
      periodControls() +
      '<span class="ct-lab">看</span>' +
      '<div class="seg">' + CHART_KINDS.map(function (x) {
        return '<button class="' + (chartKind() === x[0] ? 'on' : '') + '" data-act="chart-kind" data-kind="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="seg">' + CHART_DIMS.map(function (x) {
        return '<button class="' + (S.chart.dim === x[0] ? 'on' : '') + '" data-act="chart-dim" data-dim="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="seg">' + [['donut', '环形图'], ['pie', '饼图'], ['bar', '柱形图'], ['hbar', '条形图'], ['line', '折线图'], ['area', '面积图'], ['stacked', '堆叠图'], ['grouped', '分组柱形']].map(function (x) {
        return '<button class="' + (S.chart.type === x[0] ? 'on' : '') + '" data-act="chart-type" data-type="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div></div>' +
      (isSeries ? '<div class="chart-box"><canvas id="chart-canvas" data-act="chart-click" style="height:340px"></canvas></div>'
        : '<div class="chart-box"><canvas id="chart-canvas" data-act="chart-click" style="height:' + (S.chart.type === 'hbar' ? Math.max(200, d.items.length * 34 + 24) : 340) + 'px"></canvas></div>') +
      '<div class="chart-foot">' + esc(periodLabel()) + ' · ' + chartKindName() + '合计 <b>¥' + fmt(d.total) + '</b> · 账单 ' + d.count + ' 条 · 分组 ' + d.items.length + ' 项</div>' +
      '<p class="hint">💡 点图表里的色块 / 圆弧 / 图例，或下面的表格行，可查看这一组里的账单明细。</p>' +
      (chartKind() === 'all' ? '<p class="hint">「收支都有」把支出和收入放同一张图里对比（不含转账，避免重复计算）。</p>' : '') +
      '<div class="table-wrap"><table class="preview"><thead><tr><th>项目</th><th>金额</th><th>占比</th><th>笔数</th>' +
      (dimIsCat ? '<th>操作</th>' : '') + '</tr></thead><tbody>' +
      (function () {
        var sum = d.items.reduce(function (a, b) { return a + b.value; }, 0);
        return d.items.map(function (it) {
          return '<tr data-act="chart-detail" data-key="' + esc(it.key) + '" data-label="' + esc(it.label) + '"><td>' + esc(it.label) + '</td><td class="exp">¥' + it.valueText + '</td>' +
            '<td>' + (sum ? (it.value / sum * 100).toFixed(1) : '0') + '%</td>' +
            '<td>' + it.count + '</td>' +
            (dimIsCat ? '<td><button class="mini" data-act="f-excat" data-val="' + esc(it.key) + '">⊘ 剔除</button></td>' : '') + '</tr>';
        }).join('');
      })() + '</tbody></table></div>' +
      '</div></section>';
  }

  function drawChart() {
    var c = document.getElementById('chart-canvas');
    if (!c) return;
    var d = chartData();
    var spec;
    if (S.chart.type === 'stacked' || S.chart.type === 'grouped') {
      spec = { type: S.chart.type, labels: d.labels || [], series: d.series || [] };
    } else {
      spec = { type: S.chart.type, items: d.items };
    }
    try { Charts.render(c, spec); } catch (e) { console.error(e); }
    /* 悬停到可点的色块/圆弧上给个手型提示（触摸设备无 hover，直接点也一样生效） */
    c.onmousemove = function (ev) {
      var rect = c.getBoundingClientRect();
      var hit = null;
      try { hit = Charts.hitAt(c, ev.clientX - rect.left, ev.clientY - rect.top); } catch (e2) {}
      c.style.cursor = (hit === null || hit === undefined) ? 'default' : 'pointer';
    };
  }

  /* ---- 图表点击 → 查看该组账单明细 ---- */
  function chartBillsFor(key) {
    var kf = chartKeyFns();
    var k = String(key);
    return chartList().filter(function (b) { return String(kf.keyFn(b)) === k; });
  }
  function openChartDetail(key, label, bills) {
    openModal({ type: 'chart-detail', key: key, label: label || '', bills: bills || null });
  }
  function chartCanvasClick(e, c) {
    var rect = c.getBoundingClientRect();
    var i;
    try { i = Charts.hitAt(c, e.clientX - rect.left, e.clientY - rect.top); } catch (err) { return; }
    if (i === null || i === undefined) return;
    var d = chartData();
    if (S.chart.type === 'stacked' || S.chart.type === 'grouped') {
      /* 堆叠/分组图按「月份列」出明细（整列所有分类的账单） */
      var mo = (d.labels || [])[i];
      if (!mo) return;
      var moList = chartList().filter(function (b) { return (Util.monthOf(b.date) || '未知') === mo; });
      openChartDetail(null, mo + ' · 明细', moList);
      return;
    }
    /* 图表内部对 0 值项做了过滤，这里用同样的口径取下标 */
    var its = (S.chart.type === 'line' || S.chart.type === 'area') ? d.items
      : d.items.filter(function (x) { return x.value > 0; });
    var it = its[i];
    if (!it) return;
    openChartDetail(it.key, it.label);
  }

  /* ================================================================ 整理 */
  function viewOrganize() {
    var trashN = Store.getTrash().length;
    var subs = [['unclassified', '待分类'], ['dupe', '疑似重复'], ['unsure', '不记得箱'], ['review', '保留箱'],
      ['trash', '回收站' + (trashN ? ' (' + trashN + ')' : '')]];
    var body = '';
    if (S.organizeSub === 'unclassified') {
      var list = allBills().filter(function (b) { return b.category === 'other' || b.category === 'other_in'; });
      body = '<p class="hint">共 <b>' + list.length + '</b> 条未分类（分类为“其他”）。勾选后统一指派分类；也可以就某条账单新建关键词规则，以后同类自动归类。</p>' +
        '<div class="unclass-actions"><button class="ghost" data-act="org-select-all">全选</button>' +
        '<button class="ghost" data-act="org-select-none">全不选</button>' +
        '<span>指派为：<select data-act="org-assign-cat">' + catOptions('', 'expense', true) + '</select></span></div>' +
        '<div class="bill-list">' + (list.length ? list.map(billRow).join('') : '<div class="empty">太好了，没有待分类账单</div>') + '</div>';
    } else if (S.organizeSub === 'dupe') {
      var groups = Dedupe.findDuplicateGroups(allBills());
      if (!S.dupeSeeded) { seedDupSel(groups); S.dupeSeeded = true; }
      var dupSelN = dupSelIds().length;
      var dupTotal = groups.reduce(function (a, g) { return a + g.count; }, 0);
      body = '<p class="hint">判定依据：<b>单号相同</b>即为重复；没有单号的账单才按「日期 + 项目 + 金额」判断，单号不同绝不判为重复。共 <b>' + groups.length + '</b> 组 / <b>' + dupTotal + '</b> 条。已默认为每组勾选「多余的那条」（优先留下信息更全的一条），你核对后点删除即可；也可以逐条自己勾选要删的。</p>' +
        '<div class="dup-actions">' +
        '<button class="primary" data-act="dupe-group-auto">每组只留一条（自动勾选其余）</button>' +
        '<button class="ghost" data-act="dupe-select-all">全部勾选</button>' +
        '<button class="ghost" data-act="dupe-select-none">清空勾选</button>' +
        (dupSelN ? '<button class="ghost danger" data-act="dupe-delete">删除已勾选的 ' + dupSelN + ' 条</button>' : '') +
        '<span class="dup-count">已勾选 <b>' + dupSelN + '</b> 条</span>' +
        '</div>' +
        '<div class="dup-list">' + (groups.length ? groups.map(function (g, i) {
          var inGroup = g.count - g.bills.filter(function (b) { return !S.dupSel[b.id]; }).length;
          return '<div class="dup-group"><div class="dup-head"><b>第 ' + (i + 1) + ' 组 · ' + g.count + ' 条</b>' +
            '<span class="pill">' + esc(g.sample.item || '（无项目）') + ' · ¥' + fmt(g.sample.amount) + ' · ' + esc(g.sample.date || '') + '</span>' +
            (g.key.indexOf('order|') === 0 ? '<span class="flag dupe">单号相同</span>' : '<span class="flag unsure">无单号·启发式</span>') +
            '<span class="g-sel">' + (inGroup ? '将删 ' + inGroup + ' 条' : '全部保留') + '</span>' +
            '<div class="g-act">' +
            '<button class="mini" data-act="dup-group-keep1" data-key="' + esc(g.key) + '">只留一条</button>' +
            '<button class="mini" data-act="dup-group-none" data-key="' + esc(g.key) + '">都不删</button>' +
            '<button class="mini" data-act="dup-group-all" data-key="' + esc(g.key) + '">全删</button>' +
            '<button class="mini" data-act="dup-group-review" data-key="' + esc(g.key) + '">其余入保留箱</button>' +
            '</div></div>' +
            '<div class="bill-list">' + g.bills.map(function (b) { return billRow(b, { selMap: S.dupSel, selAct: 'dup-select' }); }).join('') + '</div>' +
            '</div>';
        }).join('') : '<div class="empty">没有发现重复账单 🎉</div>') + '</div>';
    } else if (S.organizeSub === 'unsure') {
      var u = allBills().filter(function (b) { return b.unsure; });
      body = '<p class="hint">存放你「不记得」的账单。可以在这里补充分类/备注，确认无误后点“移出”。</p>' +
        '<div class="bill-list">' + (u.length ? u.map(billRow).join('') : '<div class="empty">不记得箱是空的</div>') + '</div>';
    } else if (S.organizeSub === 'trash') {
      var tr = Store.getTrash();
      body = '<p class="hint">删除的账单会先放到这里，随时可以<b>恢复</b>；确认不要了再「彻底删除」，彻底删除后无法再找回。</p>' +
        (tr.length ? '<div class="dup-actions">' +
          '<button class="ghost" data-act="trash-restore-all">全部恢复</button>' +
          '<button class="ghost danger" data-act="trash-empty">清空回收站</button>' +
          '<span class="dup-count">共 <b>' + tr.length + '</b> 条</span></div>' : '') +
        '<div class="bill-list trash-list">' + (tr.length ? tr.map(function (b) {
          return '<div class="trash-item">' + billRow(b, { selectable: false }) +
            '<div class="trash-acts"><span class="t-when">删除于 ' + esc(String(b.deletedAt || '').slice(0, 16).replace('T', ' ')) + '</span>' +
            '<button class="mini" data-act="trash-restore" data-id="' + b.id + '">恢复</button>' +
            '<button class="mini danger" data-act="trash-purge" data-id="' + b.id + '">彻底删除</button></div></div>';
        }).join('') : '<div class="empty">回收站是空的</div>') + '</div>';
    } else {
      var rv = allBills().filter(function (b) { return b.review; });
      body = '<p class="hint">「保留箱」用于暂时拿不准是否重复的账单。确认后可移出保留箱或直接删除（会先放进回收站）。</p>' +
        '<div class="bill-list">' + (rv.length ? rv.map(billRow).join('') : '<div class="empty">保留箱是空的</div>') + '</div>';
    }
    return '<section class="page"><header class="page-head"><h1>整理</h1></header>' +
      '<div class="subtabs">' + subs.map(function (s) {
        return '<button class="' + (S.organizeSub === s[0] ? 'on' : '') + '" data-act="org-sub" data-sub="' + s[0] + '">' + s[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="card">' + body + '</div></section>';
  }

  /* ================================================================ 分组 */
  /* 分组缩略视图：不铺开账单行，一眼看清这组是什么、几个钱 */
  function groupSlim(members) {
    if (!members.length) return '<div class="g-slim"><div class="g-slim-row">这一组还没有账单：勾选账单后用「批量分组…」移进来</div></div>';
    var dates = members.map(function (b) { return b.date || ''; }).filter(Boolean).sort();
    var range = !dates.length ? '—' : (dates[0] === dates[dates.length - 1] ? dates[0] : dates[0] + ' ~ ' + dates[dates.length - 1]);
    var s = Filters.summary(members);
    function topBy(keyFn) {
      var cnt = {};
      members.forEach(function (b) { var k = keyFn(b); if (k) cnt[k] = (cnt[k] || 0) + 1; });
      return Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || (a < b ? -1 : 1); })
        .slice(0, 3).map(function (k) { return esc(k) + ' <b>' + cnt[k] + '</b>'; }).join(' · ');
    }
    var catTop = topBy(function (b) { return cat(b.category).icon + ' ' + cat(b.category).name; });
    var merTop = topBy(function (b) { return b.counterparty; });
    var recent = members.slice().sort(function (a, b) {
      var ad = a.date || '', bd = b.date || '';
      return bd < ad ? -1 : (bd > ad ? 1 : 0);
    }).slice(0, 3).map(function (b) {
      var sign = b.type === 'income' ? '+' : (b.type === 'transfer' ? '' : '-');
      return '<span class="gs-rec">' + esc((b.date || '').slice(5)) + ' ' + sign + '¥' + fmt(b.amount) + ' ' +
        esc(b.item || b.counterparty || '（无项目名）') + '</span>';
    }).join('');
    return '<div class="g-slim">' +
      '<div class="g-slim-row"><span class="gs-k">时间</span>' + esc(range) +
      '<span class="gs-k">笔数</span><b>' + members.length + '</b> 笔' +
      '<span class="gs-k">支出</span><b class="exp">¥' + fmt(s.expense) + '</b>' +
      (Money.cmp(Money.parse(s.income), 0n) > 0 ? '<span class="gs-k">收入</span><b class="inc">¥' + fmt(s.income) + '</b>' : '') + '</div>' +
      (catTop ? '<div class="g-slim-row"><span class="gs-k">分类</span>' + catTop + '</div>' : '') +
      (merTop ? '<div class="g-slim-row"><span class="gs-k">商户</span>' + merTop + '</div>' : '') +
      (recent ? '<div class="g-slim-row gs-mini"><span class="gs-k">最近</span>' + recent + '</div>' : '') +
      '<div class="g-slim-row gs-mini">要看全部 ' + members.length + ' 条明细 → 点右上角「▾ 展开明细」</div>' +
      '</div>';
  }

  function viewGroups() {
    var gs = Store.state.groups;
    var selCount = selectedIds().length;
    S.groupLimit = S.groupLimit || {};
    S.groupFold = S.groupFold || {};
    var folded = 0;
    var list = gs.map(function (g) {
      var members = allBills().filter(function (b) { return b.groupId === g.id; });
      var s = Filters.summary(members);
      var picked = members.filter(function (b) { return S.selection[b.id]; }).length;
      var isFold = !!S.groupFold[g.id];
      if (isFold) folded++;
      var cap = S.groupLimit[g.id] ? members.length : 20;
      var shown = members.slice(0, cap);
      var body = isFold ? groupSlim(members)
        : ('<div class="bill-list g-bills">' + (members.length ? shown.map(function (b) {
          return billRow(b);
        }).join('') : '<div class="empty">这一组还没有账单：勾选账单后用「批量分组…」移进来</div>') + '</div>' +
          (members.length > shown.length ? '<div class="more"><button class="ghost" data-act="group-show-all" data-id="' + g.id + '">展开该组全部 ' + members.length + ' 条</button></div>' : ''));
      return '<div class="group-card' + (isFold ? ' folded' : '') + '"><div class="g-head"><b>📁 ' + esc(g.name) + '</b>' +
        '<span class="pill">' + members.length + ' 笔 · 支出 ¥' + fmt(s.expense) + ' · 收入 ¥' + fmt(s.income) + (picked ? ' · <b class="g-picked">已选 ' + picked + '</b>' : '') + '</span>' +
        '<div class="g-act">' +
        '<button class="mini" data-act="group-fold" data-id="' + g.id + '">' + (isFold ? '▾ 展开明细' : '▴ 收起成缩略') + '</button>' +
        '<button class="mini" data-act="group-select-all" data-id="' + g.id + '">全选本组</button>' +
        (picked ? '<button class="mini" data-act="group-select-none">清空选择</button>' : '') +
        '<button class="mini" data-act="group-only" data-id="' + g.id + '">只看这组</button>' +
        '<button class="mini" data-act="group-rename" data-id="' + g.id + '">改名</button>' +
        '<button class="mini danger" data-act="group-delete" data-id="' + g.id + '">删除分组</button></div></div>' +
        body +
        '</div>';
    }).join('');
    return '<section class="page"><header class="page-head"><h1>分组</h1>' +
      '<div class="tools"><button class="ghost" data-act="group-create">＋ 新建分组</button></div></header>' +
      '<div class="card">' +
      '<div class="g-assign">当前勾选 <b>' + selCount + '</b> 条账单：' +
      '<button class="ghost" data-act="sel-group">移到分组…</button>' +
      '<button class="ghost" data-act="group-unassign">移出分组</button>' +
      (gs.length ? '<span class="g-assign-fold">' +
        '<button class="mini" data-act="group-fold-all">▴ 全部收起成缩略</button>' +
        '<button class="mini" data-act="group-unfold-all">▾ 全部展开明细</button>' +
        '</span>' : '') +
      '</div>' +
      '<p class="hint">每组右上角可在<b>「缩略 / 明细」</b>之间切换：缩略=只看笔数、合计、时间范围、分类与商户 TOP；明细=完整账单行（点行展开对方 / 支付方式 / 单号 / 备注 / 来源 / 标签 / 时间）。上面两个按钮可一次把全部组切成缩略或展开（当前 ' + folded + ' / ' + gs.length + ' 组是缩略）。</p>' +
      (list || '<div class="empty">还没有分组</div>') +
      '</div></section>';
  }

  /* ================================================================ 钱包 */
  var WALLET_KINDS = [['platform', '平台'], ['bank', '银行卡'], ['cash', '现金'], ['other', '其他']];
  function walletKindName(k) {
    var o = WALLET_KINDS.filter(function (x) { return x[0] === k; })[0];
    return o ? o[1] : '其他';
  }
  /* 自动余额 = 初始 + 收入 − 支出（只看关联来源的账单；转账/还款不计入） */
  function walletAuto(w) {
    var ids = w.sources || [];
    var inc = 0n, exp = 0n, n = 0;
    if (ids.length) {
      allBills().forEach(function (b) {
        if (ids.indexOf(b.source) === -1) return;
        var a = Money.parse(b.amount) || 0n;
        if (b.type === 'income') { inc += a; n++; }
        else if (b.type === 'expense') { exp += a; n++; }
      });
    }
    var init = Money.parse(w.init) || 0n;
    return { init: init, inc: inc, exp: exp, count: n, auto: Money.add(Money.sub(init, exp), inc) };
  }
  function walletShown(w) {
    var s = walletAuto(w);
    var manual = (w.manual === null || w.manual === undefined) ? null : (Money.parse(w.manual) || 0n);
    var tr = transferStatFor(w.id);
    var base = manual === null ? s.auto : manual;
    return { stat: s, manual: manual, transfer: tr, base: base, value: Money.add(base, tr.net) };
  }
  /* 钱包之间互相转账：某钱包的转入 / 转出（内部转账，资产合计净零） */
  function transferStatFor(id) {
    var tin = 0n, tout = 0n, n = 0;
    (Store.state.transfers || []).forEach(function (t) {
      var a = Money.parse(t.amount) || 0n;
      if (t.to === id) { tin += a; n++; }
      if (t.from === id) { tout += a; n++; }
    });
    return { in: tin, out: tout, net: Money.sub(tin, tout), count: n };
  }
  function moneyText(v) { return (v < 0n ? '－' : '') + '¥' + fmt(Money.abs(v)); }

  function walletCard(w) {
    var r = walletShown(w), s = r.stat;
    var isManual = r.manual !== null;
    return '<div class="card wallet-card">' +
      '<div class="w-head">' +
      '<span class="w-icon">' + esc(w.icon || '💳') + '</span>' +
      '<div class="w-title"><b>' + esc(w.name) + '</b><small>' + walletKindName(w.kind) + ' · ' + (isManual ? '手动填的余额' : '按账单自动算') + '</small></div>' +
      '<button class="mini" data-act="wallet-edit-one" data-id="' + w.id + '" title="改名 / 换图标 / 关联来源">✏</button>' +
      '<button class="mini danger" data-act="wallet-del" data-id="' + w.id + '" title="删除钱包（账单不受影响）">×</button>' +
      '</div>' +
      '<div class="w-bal' + (r.value < 0n ? ' neg' : '') + '">' + moneyText(r.value) + '</div>' +
      '<div class="w-lines">' +
      '<span>初始 <b>' + moneyText(s.init) + '</b></span>' +
      '<span>收入 <b class="inc">+' + fmt(s.inc) + '</b></span>' +
      '<span>支出 <b class="exp">-' + fmt(s.exp) + '</b></span>' +
      (isManual ? '<span>自动算得 <b>' + moneyText(s.auto) + '</b></span>' : '') +
      (r.transfer.count ? '<span>转入 <b class="inc">+' + fmt(r.transfer.in) + '</b></span><span>转出 <b class="exp">-' + fmt(r.transfer.out) + '</b></span>' : '') +
      '</div>' +
      '<div class="w-src">' + ((w.sources || []).length ? (w.sources || []).map(function (id) {
        return '<span class="tg">' + esc(srcName(id)) + '</span>';
      }).join('') : '<span class="hint">没关联来源：只显示手动余额</span>') + '</div>' +
      '<div class="w-acts">' +
      '<button class="mini" data-act="wallet-balance" data-id="' + w.id + '">手动改余额</button>' +
      '<button class="mini" data-act="wallet-transfer" data-id="' + w.id + '" title="从这张钱包转钱出去 / 转进来">🔁 转账</button>' +
      (isManual ? '<button class="mini" data-act="wallet-balance-clear" data-id="' + w.id + '">按账单重算</button>' : '') +
      '<span class="w-cnt">' + s.count + ' 笔计入</span>' +
      '</div>' +
      '</div>';
  }

  function walletQuickHtml(ws) {
    var presets = [['微信', '💚', 'wechat'], ['支付宝', '🅰️', 'alipay'], ['银行卡', '🏦', 'bank'], ['现金', '💵', 'cash']];
    var have = ws.map(function (w) { return w.name; });
    var rest = presets.filter(function (p) { return have.indexOf(p[0]) === -1; });
    if (!rest.length) return '<div class="w-quick"><span class="hint">常用的钱包都添加过了 👍</span></div>';
    return '<div class="w-quick">' + rest.map(function (p) {
      return '<button class="ghost" data-act="wallet-quick" data-name="' + p[0] + '" data-icon="' + p[1] + '" data-source="' + p[2] + '">' + p[1] + ' ' + p[0] + '</button>';
    }).join('') + '</div>';
  }

  function transfersCard() {
    var ts = (Store.state.transfers || []).slice().reverse();
    if (!ts.length) return '';
    return '<div class="card"><b>🔁 转账记录</b>' +
      '<p class="hint">钱包之间互相转账：转出方余额减少、转入方余额增加，<b>「资产合计」不变</b>（钱只是从这张卡挪到那张卡）。点 × 可撤销一笔。</p>' +
      '<div class="trf-list">' + ts.map(function (t) {
        var fw = Store.getWallet(t.from), tw = Store.getWallet(t.to);
        var fname = fw ? ((fw.icon || '💳') + ' ' + fw.name) : '（已删除的钱包）';
        var tname = tw ? ((tw.icon || '💳') + ' ' + tw.name) : '（已删除的钱包）';
        return '<div class="trf-row">' +
          '<span class="trf-move"><b>' + esc(fname) + '</b><i>→</i><b>' + esc(tname) + '</b></span>' +
          '<span class="trf-amt">¥' + fmt(t.amount) + '</span>' +
          '<span class="trf-meta">' + esc(t.date || '') + (t.note ? ' · ' + esc(t.note) : '') + '</span>' +
          '<button class="mini danger" data-act="wallet-transfer-del" data-id="' + t.id + '" title="撤销这笔转账">×</button>' +
          '</div>';
      }).join('') + '</div></div>';
  }

  function viewWallet() {
    var ws = Store.state.wallets || [];
    var total = 0n;
    ws.forEach(function (w) { total = Money.add(total, walletShown(w).value); });
    return '<section class="page"><header class="page-head"><h1>钱包</h1>' +
      '<div class="tools"><button class="ghost" data-act="wallet-transfer" title="钱包之间互相转账">🔁 转账</button>' +
      '<button class="primary" data-act="wallet-new">＋ 添加钱包</button></div></header>' +
      '<div class="sumbar">' +
      '<div class="s-item net"><span>资产合计（' + ws.length + ' 个钱包）</span><b>' + moneyText(total) + '</b></div>' +
      '<div class="s-item"><span>手动填过余额</span><b>' + ws.filter(function (w) { return (w.manual !== null && w.manual !== undefined); }).length + '</b></div>' +
      (tsCount() ? '<div class="s-item"><span>钱包间转账</span><b>' + tsCount() + ' 笔</b></div>' : '') +
      '</div>' +
      '<div class="card"><b>⚡ 快速添加</b>' +
      '<p class="hint">点一下就能建一个钱包（微信 / 支付宝 / 银行卡 / 现金），建好后可以再点卡片上的 ✏ 改名或换图标。</p>' +
      walletQuickHtml(ws) +
      '</div>' +
      '<p class="hint">自动余额 = <b>初始余额 + 收入 − 支出</b>，只统计关联了对应来源的账单（转账、还款这类不计入）。' +
      '钱包之间可以用「🔁 转账」把一笔钱从一张卡挪到另一张（不影响账单，资产合计不变）。' +
      '想以查到的真实余额为准时，点「手动改余额」填一下就行；以后点「按账单重算」可恢复自动计算。</p>' +
      (ws.length ? '<div class="wallet-grid">' + ws.map(walletCard).join('') + '</div>'
        : '<div class="card"><b>还没有钱包</b><p class="hint">点上面的「⚡ 快速添加」按钮，或者右上角「＋ 添加钱包」自己新建一个（可以关联多个来源）。</p></div>') +
      transfersCard() +
      '</section>';
  }
  function tsCount() { return (Store.state.transfers || []).length; }

  /* ================================================================ 导出 */
  function viewExport() {
    var selCount = selectedIds().length;
    var scope = S.exportScope || (selCount ? 'selected' : 'filtered');
    var list = scope === 'all' ? allBills() : (scope === 'filtered' ? filtered() : selectedBills());
    return '<section class="page"><header class="page-head"><h1>导出图片</h1></header>' +
      '<div class="card">' +
      '<div class="exp-scope">导出范围：' +
      [['selected', '已勾选的 ' + selCount + ' 条'], ['filtered', '当前筛选结果 ' + filtered().length + ' 条'], ['all', '全部账单 ' + allBills().length + ' 条']].map(function (o) {
        return '<button class="' + (scope === o[0] ? 'on' : '') + '" data-act="export-scope" data-scope="' + o[0] + '">' + o[1] + '</button>';
      }).join('') +       '</div>' +
      '<div class="exp-scope">图片模板：' +
      [['light', '☀️ 清爽卡片'], ['dark', '🌙 夜间深色']].map(function (o) {
        return '<button class="' + (S.exportStyle === o[0] ? 'on' : '') + '" data-act="export-style" data-style="' + o[0] + '">' + o[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="exp-form">' +
      '<label>标题 <input type="text" id="exp-title" value="' + esc(S.expTitle || '账单明细') + '"></label>' +
      '<label>副标题 <input type="text" id="exp-sub" value="' + esc(S.expSub || '') + '" placeholder="例如：2024年1月 · 旅游支出"></label>' +
      '<label>备注 <input type="text" id="exp-note" value="' + esc(S.expNote || '') + '" placeholder="可选"></label>' +
      '</div>' +
      '<div class="exp-actions"><button class="primary" data-act="export-png">下载 PNG 图片（' + list.length + ' 条）</button>' +
      '<button class="ghost" data-act="export-copy">复制图片到剪贴板</button>' +
      '<button class="ghost" data-act="export-csv">导出 CSV</button></div>' +
      '<div id="exp-preview" class="exp-preview"></div>' +
      '</div>' +
      '<div class="card"><b>数据备份</b><p class="hint">建议定期导出 JSON 备份保存在本地，换电脑 / 清缓存后可随时恢复。</p>' +
      '<div class="exp-actions"><button class="ghost" data-act="backup-export">导出 JSON 备份</button>' +
      '<button class="ghost" data-act="backup-import">导入 JSON 备份</button></div></div>' +
      '</section>';
  }

  /* ================================================================ 设置 */
  function viewSettings() {
    var bills = allBills();
    var s = Filters.summary(bills);
    var storage = Store.available ? '可用（数据已自动保存在本浏览器）' : '不可用（数据仅保存在内存，请务必导出备份！）';
    return '<section class="page"><header class="page-head"><h1>设置</h1></header>' +
      '<div class="card"><b>外观主题</b>' +
      '<p class="hint">日间模式为蓝白色系（浅色底），夜间模式为深色护眼。选择后会自动记住。</p>' +
      '<div class="exp-scope">' +
      '<button class="' + (S.theme === 'light' ? 'on' : '') + '" data-act="theme-set" data-theme="light">☀️ 日间（蓝白）</button>' +
      '<button class="' + (S.theme === 'dark' ? 'on' : '') + '" data-act="theme-set" data-theme="dark">🌙 夜间（深色）</button>' +
      '</div></div>' +
      '<div class="card"><b>数据概览</b>' +
      '<div class="kv"><span>账单总数</span><b>' + bills.length + ' 条</b></div>' +
      '<div class="kv"><span>支出合计</span><b class="exp">¥' + fmt(s.expense) + '</b></div>' +
      '<div class="kv"><span>收入合计</span><b class="inc">¥' + fmt(s.income) + '</b></div>' +
      '<div class="kv"><span>分组数</span><b>' + Store.state.groups.length + '</b></div>' +
      '<div class="kv"><span>本地存储</span><b>' + esc(storage) + '</b></div>' +
      '<div class="kv"><span>最后保存</span><b>' + esc(Store.state.updatedAt || '—') + '</b></div>' +
      '</div>' +
      '<div class="card"><b>🕘 变更记录 / 撤销</b>' +
      '<p class="hint">记录这次打开期间的改动（改分类、新建、删除、转账、导入等，最多 80 步），点某一步可一键回到那时候。' +
      '只存在内存里，刷新页面即清空；导出的备份文件里不含它。</p>' +
      '<div class="kv"><span>可撤销的改动</span><b>' + Store.historyCount() + ' 步</b></div>' +
      '<div class="exp-scope">' +
      (Store.canUndo() ? '<button data-act="undo">↩ 撤销上一步</button>' : '<button disabled>没有可撤销的改动</button>') +
      '<button data-act="hist-open">🕘 查看变更记录</button>' +
      (Store.canUndo() ? '<button data-act="hist-clear">清空记录</button>' : '') +
      '</div></div>' +
      '<div class="card"><b>分类管理</b>' + catManageCard() + '</div>' +
      '<div class="card"><b>商户 / 对方管理</b>' + mcManageCard() + '</div>' +
      '<div class="card"><b>来源管理</b>' + srcManageCard() + '</div>' +
      '<div class="card"><b>分类与规则</b>' +
      '<p class="hint">为「整理」页添加自动分类规则：命中关键词的账单会自动归到指定分类。</p>' +
      '<div class="rule-add"><input type="text" id="rule-word" placeholder="关键词，如 星巴克">' +
      '→ <select id="rule-cat">' + catOptions('food', 'expense', true) + '</select>' +
      '<button class="ghost" data-act="rule-add">添加规则</button></div>' +
      '<div class="rule-list">' + (Store.state.customRules.length ? Store.state.customRules.map(function (r, i) {
        return '<span class="tag">' + esc(r.word) + ' → ' + esc(cat(r.cat).name) + '<button class="x" data-act="rule-del" data-i="' + i + '">×</button></span>';
      }).join('') : '<span class="hint">暂无自定义规则</span>') + '</div>' +
      '<div class="rule-import"><button class="ghost" data-act="rule-apply">对所有账单重新自动分类</button></div>' +
      '</div>' +
      '<div class="card"><b>商户排除规则</b>' +
      '<p class="hint">命中的商户会从统计和图表里整体「筛减」掉，例如「转账」「还款」「红包」这类不想计入的对方。按关键词匹配「交易对方」或「项目名」，不区分大小写。</p>' +
      '<label class="mex-switch"><input type="checkbox" data-act="mex-hide-toggle"' + (hideExcluded() ? ' checked' : '') + '> 总账单列表里也把它们藏起来（关掉就会显示，带 🚫 标记，方便核对）</label>' +
      '<div class="rule-add"><input type="text" id="mex-word" placeholder="关键词，如 转账 / 还款 / 京东">' +
      '<button class="ghost" data-act="mex-add">添加排除</button></div>' +
      '<div class="rule-list">' + (merchantExcludes().length ? merchantExcludes().map(function (w) {
        return '<span class="tag">🚫 ' + esc(w) + '<button class="x" data-act="mex-del" data-word="' + esc(w) + '">×</button></span>';
      }).join('') : '<span class="hint">暂无排除规则</span>') + '</div>' +
      (merchantExcludes().length ? '<div class="rule-import"><button class="ghost" data-act="mex-clear">清空全部排除规则</button></div>' : '') +
      '</div>' +
      '<div class="card"><b>桌面快捷方式</b>' +
      '<p class="hint">电脑：点下面按钮下载一个带图标的「AQI的记账助手.url」快捷方式，丢到桌面即可。<br>' +
      '（图标来自 <code>assets/AQI的记账助手.ico</code>，请勿删除该文件）<br>' +
      '手机：用浏览器打开本文件后，选择「添加到主屏幕」。</p>' +
      '<button class="ghost" data-act="make-shortcut">生成电脑桌面快捷方式文件</button>' +
      '</div>' +
      '<div class="card"><b>导航栏顺序</b>' +
      '<p class="hint">左边栏的按钮顺序可以自己排（比如把「整理」「分组」挪到最上面）。点 ↑ ↓ 换位置，改完会立刻生效并自动记住。</p>' +
      '<div class="nav-order">' + orderedTabs().map(function (t, i) {
        return '<div class="no-row"><span class="no-name">' + t.icon + ' ' + esc(t.name) + '</span>' +
          '<button class="mini" data-act="nav-up" data-tab="' + t.id + '"' + (i === 0 ? ' disabled' : '') + ' title="上移">↑</button>' +
          '<button class="mini" data-act="nav-down" data-tab="' + t.id + '"' + (i === orderedTabs().length - 1 ? ' disabled' : '') + ' title="下移">↓</button>' +
          '</div>';
      }).join('') + '</div>' +
      '<div class="rule-import"><button class="ghost" data-act="nav-reset">恢复默认顺序</button></div>' +
      '</div>' +
      '<div class="card"><b>导入教程</b>' +
      '<p class="hint">「导入账单」页里那份「各平台账单怎么导出」的教程，可以改成你自己习惯的步骤（例如换成你手机上真实的菜单路径）。</p>' +
      '<button class="ghost" data-act="tut-edit">✏ 编辑导入教程</button>' +
      (tutorialCustom() ? '<button class="ghost" data-act="tut-reset">↩ 恢复内置教程</button>' : '') +
      '</div>' +
      '<div class="card danger-zone"><b>危险操作</b>' +
      '<p class="hint">清空会删除全部账单、分组与规则（不可恢复），请先导出备份。</p>' +
      '<button class="ghost danger" data-act="reset-all">清空全部数据</button>' +
      '</div></section>';
  }

  function catOptions(selected) {
    return Categorize.ALL.concat(Store.state.customCategories).map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === selected ? ' selected' : '') + '>' + c.icon + ' ' + c.name + '</option>';
    }).join('');
  }

  /* ------------------------------------------------ 自定义分类（新建/编辑/删除） */
  function catNameExists(name, exceptId) {
    var n = String(name || '').trim();
    if (!n) return false;
    return Categorize.ALL.concat(Store.state.customCategories).filter(function (c) {
      return c.id !== exceptId && String(c.name).trim() === n;
    }).length > 0;
  }
  function catManageCard() {
    var custom = Store.state.customCategories || [];
    return '<p class="hint">内置分类不能删；下面可以新建自己的分类（比如「宠物」「房租」「健身」），建好后立刻能在筛选、批量改分类、账单编辑里选到。</p>' +
      '<div class="cat-new-form">' +
      '<input type="text" id="c-new-icon" maxlength="4" placeholder="🙂">' +
      '<input type="text" id="c-new-name" placeholder="新分类名，如 宠物">' +
      '<select id="c-new-type"><option value="expense">支出分类</option><option value="income">收入分类</option><option value="transfer">转账/中性</option></select>' +
      '<button class="primary" data-act="cat-create">＋ 新建分类</button>' +
      '</div>' +
      (custom.length ? '<div class="rule-list">' + custom.map(function (c) {
        return '<span class="tag">' + (c.icon || '🏷') + ' ' + esc(c.name) + ' · ' + typeName(c.type) + ' · ' + Store.countCategory(c.id) + ' 笔' +
          '<button class="x edit" data-act="cat-edit-one" data-id="' + c.id + '" title="编辑">✏</button>' +
          '<button class="x" data-act="cat-del-one" data-id="' + c.id + '" title="删除">×</button></span>';
      }).join('') + '</div>' : '<span class="hint">还没有自定义分类</span>');
  }

  /* 商户 / 对方：新增的名字会出现在筛选面板（哪怕 0 笔），改名会把所有账单一起改 */
  function mcManageCard() {
    var custom = Store.state.customMerchants || [];
    return '<p class="hint">这里管理筛选面板里的「商户 / 对方」名字：新增一个名字（比如「房东老王」），之后导入的账单对方叫它就会自动归到一起；改名会把所有账单里的名字一起改（也能合并两家）。</p>' +
      '<div class="cat-new-form">' +
      '<input type="text" id="c-new-merchant" placeholder="新增商户 / 对方名字，如 房东老王">' +
      '<button class="primary" data-act="mc-card-create">＋ 新增</button>' +
      '<button class="ghost" data-act="mc-manage">✏ 打开管理器</button>' +
      '</div>' +
      (custom.length ? '<div class="rule-list">' + custom.map(function (n) {
        return '<span class="tag">🎪 ' + esc(n) + ' · ' + Store.countMerchant(n) + ' 笔' +
          '<button class="x edit" data-act="mc-edit-one" data-m="' + esc(n) + '" title="改名（账单一起改）">✏</button>' +
          '<button class="x" data-act="mc-del-one" data-m="' + esc(n) + '" title="从自定义商户里删除">×</button></span>';
      }).join('') + '</div>' : '<span class="hint">还没有自定义商户 / 对方</span>');
  }

  /* 来源：导入时可选、可新建 */
  function srcManageCard() {
    var custom = Store.state.customSources || [];
    return '<p class="hint">导入账单时可以选择来源，也可以在这里预先建好（比如「京东白条」「饭卡」「现金」）。内置来源也能改名——改的是显示名，账单不受影响。</p>' +
      '<div class="cat-new-form">' +
      '<input type="text" id="c-new-src-icon" maxlength="4" placeholder="📱">' +
      '<input type="text" id="c-new-src" placeholder="新来源名，如 京东白条">' +
      '<button class="primary" data-act="src-card-create">＋ 新建来源</button>' +
      '<button class="ghost" data-act="src-manage">✏ 打开管理器</button>' +
      '</div>' +
      '<div class="rule-list">' + (function () {
        var ids = Parse.SOURCE_KEYS.slice();
        custom.forEach(function (s) { if (ids.indexOf(s.id) === -1) ids.push(s.id); });
        var shown = ids.filter(function (id) { return !!Store.getSource(id) || Store.countSource(id) > 0; });
        if (!shown.length) return '<span class="hint">还没有用过任何来源</span>';
        return shown.map(function (id) {
          var isC = !!Store.getSource(id);
          return '<span class="tag">' + esc(srcName(id)) + ' · ' + Store.countSource(id) + ' 笔' +
            (isC ? '' : '<b class="m-mark">内置</b>') +
            '<button class="x edit" data-act="src-edit-one" data-s="' + id + '" title="改名">✏</button>' +
            (isC ? '<button class="x" data-act="src-del-one" data-s="' + id + '" title="删除来源">×</button>' : '') +
            '</span>';
        }).join('');
      })() + '</div>';
  }


  function floatBarHtml() {
    var ids = selectedIds();
    if (!ids.length) return '';
    return '<div class="floatbar">' +
      '<b>已选 ' + ids.length + ' 条</b>' +
      (Store.canUndo() ? '<button class="ghost undo-inline" data-act="undo" title="撤销上一步：' + esc(Store.historyList()[0].label) + '">↩ 撤销</button>' : '') +
      '<button class="primary" data-act="sel-to-calc">计算</button>' +
      '<button class="ghost" data-act="sel-category">改分类</button>' +
      '<button class="ghost" data-act="sel-tag">＋ 标签</button>' +
      '<button class="ghost" data-act="tab" data-tab="export">导出图片</button>' +
      '<button class="ghost" data-act="sel-group">移到分组…</button>' +
      '<button class="ghost" data-act="group-unassign">移出分组</button>' +
      '<button class="ghost" data-act="sel-mark-unsure">移入不记得箱</button>' +
      '<button class="ghost" data-act="sel-mark-review">移入保留箱</button>' +
      '<button class="ghost danger" data-act="sel-delete">删除</button>' +
      '<button class="ghost" data-act="sel-clear">取消选择</button>' +
      '</div>';
  }

  /* 撤销悬浮按钮：有可撤销的改动时才出现 */
  function undoFabHtml() {
    if (selectedIds().length) return '';   /* 正在批量选择时让位给浮条 */
    var n = Store.historyCount();
    if (!n) return '';
    var top = Store.historyList()[0];
    return '<div class="undo-fab">' +
      '<button class="undo-btn" data-act="undo" title="撤销上一步：' + esc(top.label) + '">↩ 撤销' +
        '<span class="undo-what">' + esc(top.label) + '</span></button>' +
      '<button class="undo-hist" data-act="hist-open" title="查看变更记录">🕘 ' + n + '</button>' +
      '</div>';
  }
  function histTime(ts) {
    var sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (sec < 8) return '刚刚';
    if (sec < 60) return sec + ' 秒前';
    var mn = Math.floor(sec / 60);
    if (mn < 60) return mn + ' 分钟前';
    var d = new Date(ts);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  /* 撤销 / 回到某一步之后：清掉可能失效的临时界面状态 */
  function resetAfterUndo(keepHistory) {
    S.selection = {}; S.dupSel = {}; S.detailOpen = {};
    S.imp = null; S.listLimit = 200; S.exclMode = ''; S.exclStage = {};
    S.exportScope = null;
    S.modal = keepHistory ? { type: 'history' } : null;
    if (S.tab === 'charts' || S.tab === 'organize' || S.tab === 'merchants') S.organizeSub = S.organizeSub || 'unclassified';
  }

  /* ================================================================ 弹窗 */
  function modalHtml() {
    if (!S.modal) return '';
    var m = S.modal, body = '';
    if (m.type === 'bill') {
      var b = m.bill || {};
      var isNew = !m.bill;
      body = '<h3>' + (isNew ? '新增账单' : '编辑账单') + '</h3><div class="form-grid">' +
        fld('日期', '<input type="date" id="m-date" value="' + esc(b.date || Util.todayISO()) + '">') +
        fld('时间', '<input type="time" id="m-time" value="' + esc(b.time || '') + '">') +
        fld('类型', '<select id="m-type">' + [['expense', '支出'], ['income', '收入'], ['transfer', '转账']].map(function (o) {
          return '<option value="' + o[0] + '"' + (b.type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>') +
        fld('金额', '<input type="text" inputmode="decimal" id="m-amount" value="' + esc(b.amount || '') + '" placeholder="0.00">') +
        fld('项目', '<input type="text" id="m-item" value="' + esc(b.item || '') + '">') +
        fld('分类', '<select id="m-category">' + catOptions(b.category || 'other') + '</select>') +
        fld('来源', '<select id="m-source">' + Object.keys(Parse.SOURCE_LABELS).map(function (k) {
          return '<option value="' + k + '"' + (b.source === k ? ' selected' : '') + '>' + Parse.SOURCE_LABELS[k] + '</option>';
        }).join('') + '</select>') +
        fld('对方', '<input type="text" id="m-counterparty" value="' + esc(b.counterparty || '') + '">') +
        fld('分组', '<select id="m-group"><option value="">（无）</option>' + Store.state.groups.map(function (g) {
          return '<option value="' + g.id + '"' + (b.groupId === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>';
        }).join('') + '</select>') +
        fld('单号', '<input type="text" id="m-order" value="' + esc(b.order || '') + '">') +
        fld('标签', '<input type="text" id="m-tags" value="' + esc((b.tags || []).join(', ')) + '" placeholder="多个用逗号分隔，如：出差, 报销">') +
        fld('备注', '<input type="text" id="m-note" value="' + esc(b.note || '') + '">') +
        '</div>';
      return wrapModal(body, [['bill-save', '保存', 'primary'], ['modal-close', '取消', 'ghost']]);
    }
    if (m.type === 'tags') {
      var ids = selectedIds();
      var all = Store.allTags();
      body = '<h3>批量加标签</h3>' +
        '<p class="hint">给已勾选的 <b>' + ids.length + '</b> 条账单加标签，便于多条一起备注。多个标签用逗号/空格分隔。</p>' +
        '<input type="text" id="tag-input" placeholder="如：出差, 报销, 待确认">' +
        (all.length ? '<div class="tag-pick"><span class="flabel">已有标签（点击填入/移除）</span><div class="chips">' +
          all.map(function (t) { return '<button class="chip" data-act="tag-pick" data-tag="' + esc(t.tag) + '">#' + esc(t.tag) + ' <em>' + t.count + '</em></button>'; }).join('') +
          '</div></div>' : '<p class="hint">还没有任何标签，直接在上面输入并点「添加标签」即可。</p>');
      return wrapModal(body, [['tags-apply', '添加标签', 'primary'], ['tags-remove', '移除这些标签', 'ghost'], ['modal-close', '取消', 'ghost']]);
    }
    if (m.type === 'category') {
      var cids = m.ids || selectedIds();
      var cur = {};
      var names = {};
      cids.forEach(function (id) {
        var b = Store.getBill(id);
        if (!b) return;
        cur[b.category] = (cur[b.category] || 0) + 1;
        if (b.counterparty) names[b.counterparty] = (names[b.counterparty] || 0) + 1;
        if (b.item) names[b.item] = (names[b.item] || 0) + 1;
      });
      var curText = Object.keys(cur).map(function (k) { return cat(k).name + '（' + cur[k] + '）'; }).join('、') || '—';
      var wordList = Object.keys(names).sort(function (a, b) { return names[b] - names[a]; }).slice(0, 5);
      function group(title, list) {
        return '<div class="cat-group"><span class="cat-group-t">' + title + '</span><div class="cat-grid">' +
          list.map(function (c) {
            return '<button class="cat-btn' + (list.length === 1 && cur[c.id] ? ' on' : '') + '" data-act="cat-apply" data-id="' + c.id + '">' +
              '<em>' + c.icon + '</em>' + esc(c.name) + '</button>';
          }).join('') + '</div></div>';
      }
      body = '<h3>批量修改分类</h3>' +
        '<p class="hint">已勾选 <b>' + cids.length + '</b> 条，当前分类：' + esc(curText) + '<br>' +
        '点下面的分类按钮即可整批改掉（例如「其他」太多时，先按商户筛选出这些账单再统一改）。</p>' +
        '<label class="cat-fixtype"><input type="checkbox" id="cat-fixtype"> 同时把「收/支类型」改成与分类一致（默认不改，需要时再勾）</label>' +
        (wordList.length ? '<label class="cat-fixtype"><input type="checkbox" id="cat-learn" checked> 记住规则：这些关键词以后自动归到所选分类（' +
          wordList.map(function (w) { return esc(w); }).join('、') + '）</label>' : '') +
        group('支出分类', Categorize.EXPENSE) +
        group('收入分类', Categorize.INCOME) +
        group('转账/中性', Categorize.TRANSFER) +
        (Store.state.customCategories.length ? group('自定义分类', Store.state.customCategories) : '') +
        '<div class="g-new"><button class="ghost" data-act="cat-create-here">＋ 没有想要的？新建分类</button></div>';
      return wrapModal(body, [['modal-close', '取消', 'ghost']]);
    }
    if (m.type === 'category-edit') {
      var ce = m.cat || null;
      var ceType = ce ? (ce.type || 'expense') : 'expense';
      body = '<h3>' + (ce ? '编辑分类' : '新建分类') + '</h3>' +
        fld('分类名', '<input type="text" id="ce-name" maxlength="12" value="' + esc(ce ? ce.name : '') + '" placeholder="如 宠物 / 房租 / 健身">') +
        fld('图标（可留空）', '<input type="text" id="ce-icon" maxlength="4" value="' + esc(ce ? (ce.icon || '') : '') + '" placeholder="🐱">') +
        fld('类型', '<select id="ce-type">' +
          [['expense', '支出分类'], ['income', '收入分类'], ['transfer', '转账/中性']].map(function (t) {
            return '<option value="' + t[0] + '"' + (t[0] === ceType ? ' selected' : '') + '>' + t[1] + '</option>';
          }).join('') + '</select>') +
        (ce ? '<p class="hint">该分类下现有 <b>' + Store.countCategory(ce.id) + '</b> 条账单；改名后已归类的账单不变。</p>' : '') +
        (m.back ? '<p class="hint">建好后会回到「批量修改分类」，可以直接点它应用。</p>' : '');
      var ceBtns = [['cat-save', '保存', 'primary']];
      if (ce) ceBtns.push(['cat-del-one', '删除分类', 'ghost']);
      ceBtns.push(['modal-close', '取消', 'ghost']);
      return wrapModal(body, ceBtns);
    }
    if (m.type === 'merchant-edit') {
      var meOld = m.name || '';
      body = '<h3>' + (meOld ? '编辑商户 / 对方' : '新增商户 / 对方') + '</h3>' +
        fld('名称', '<input type="text" id="me-name" maxlength="40" value="' + esc(meOld) + '" placeholder="如 美团 / 房东老王 / 公司">') +
        '<p class="hint">只是给筛选面板加一个可选的名字；之后导入的账单如果对方叫这个名字，会自动归到它。</p>' +
        (meOld ? '<p class="hint">改名会把<strong>所有账单里的这个名字一起改掉</strong>——也能用它把两家合并成一家。当前有 <b>' + Store.countMerchant(meOld) + '</b> 条。</p>' : '');
      var meBtns = [['mc-save', '保存', 'primary']];
      if (meOld) {
        meBtns.push(['mc-exclude', '🚫 整家排除', 'ghost']);
        if (Store.isCustomMerchant(meOld)) meBtns.push(['mc-del-one', '删除', 'ghost']);
      }
      meBtns.push(['modal-close', '取消', 'ghost']);
      return wrapModal(body, meBtns);
    }
    if (m.type === 'merchant-manage') {
      var mCount2 = {};
      allBills().forEach(function (b) { var mm = Filters.merchantOf(b); if (mm) mCount2[mm] = (mCount2[mm] || 0) + 1; });
      var mList = Object.keys(mCount2).sort(function (a, b) { return mCount2[b] - mCount2[a] || (a < b ? -1 : 1); });
      (Store.state.customMerchants || []).forEach(function (n) { if (mList.indexOf(n) === -1) mList.push(n); });
      var kw = String(m.keyword || '').trim();
      if (kw) mList = mList.filter(function (n) { return n.indexOf(kw) !== -1; });
      body = '<h3>管理商户 / 对方（共 ' + mList.length + ' 个）</h3>' +
        '<p class="hint">✏ 改名（所有账单一起改，可合并）；🚫 排除（清单和统计里整体不看，可在筛选面板恢复）；× 只从「自定义商户」里删掉，账单不动。</p>' +
        '<div class="g-new"><input type="text" id="m-new" placeholder="新增一个商户 / 对方名字">' +
        '<button class="ghost" data-act="mc-create">＋ 新增</button></div>' +
        (mList.length ? '<div class="m-list">' + mList.slice(0, 200).map(function (n) {
          var isC = Store.isCustomMerchant(n);
          return '<div class="m-row"><span class="m-name">' + esc(n) + (isC ? '<b class="m-mark">自定义</b>' : '') + '</span>' +
            '<span class="m-cnt">' + (mCount2[n] || 0) + ' 笔</span>' +
            '<span class="m-acts">' +
            '<button class="mini" data-act="mc-edit-one" data-m="' + esc(n) + '">✏ 改名</button>' +
            '<button class="mini" data-act="mc-exclude-one" data-m="' + esc(n) + '">🚫 排除</button>' +
            (isC ? '<button class="mini danger" data-act="mc-del-one" data-m="' + esc(n) + '">×</button>' : '') +
            '</span></div>';
        }).join('') + '</div>' : '<p class="hint">还没有任何商户 / 对方名字，先在上面新增一个。</p>');
      return wrapModal(body, [['modal-close', '关闭', 'ghost']]);
    }
    if (m.type === 'source-edit') {
      var se = m.src || null;
      body = '<h3>' + (se ? '编辑来源' : '新建来源') + '</h3>' +
        fld('图标（可留空）', '<input type="text" id="se-icon" maxlength="4" value="' + esc(se ? (se.icon || '') : '') + '" placeholder="📱">') +
        fld('来源名', '<input type="text" id="se-name" maxlength="16" value="' + esc(se ? se.name : '') + '" placeholder="如 京东白条 / 饭卡 / 现金">') +
        (se ? '<p class="hint">用过这个来源的账单有 <b>' + Store.countSource(se.id) + '</b> 条；删除后它们会回落成「通用/未知」。</p>' : '') +
        (m.back === 'import' ? '<p class="hint">建好后会直接设为<strong>本次导入的来源</strong>。</p>' : '');
      var seBtns = [['src-save', '保存', 'primary']];
      if (se) seBtns.push(['src-del-one', '删除来源', 'ghost']);
      seBtns.push(['modal-close', '取消', 'ghost']);
      return wrapModal(body, seBtns);
    }
    if (m.type === 'source-manage') {
      var sList = allSourceIds();
      (Store.state.customSources || []).forEach(function (s) {
        if (sList.indexOf(s.id) === -1) sList.push(s.id);
      });
      body = '<h3>管理来源（共 ' + sList.length + ' 个）</h3>' +
        '<p class="hint">内置来源可以直接改名 / 删掉（删掉后用过它的账单回落成「通用/未知」）。✏ 改名、× 删除。内置的也能删。</p>' +
        '<div class="g-new"><input type="text" id="s-new" placeholder="新增一个来源名字">' +
        '<button class="ghost" data-act="src-create">＋ 新建</button></div>' +
        '<div class="m-list">' + sList.map(function (id) {
          var builtin = !!(Parse.SOURCE_LABELS[id] && !Store.getSource(id));
          return '<div class="m-row"><span class="m-name">' + esc(srcName(id)) + (builtin ? '<b class="m-mark">内置</b>' : '') + '</span>' +
            '<span class="m-cnt">' + Store.countSource(id) + ' 笔</span>' +
            '<span class="m-acts">' +
            '<button class="mini" data-act="src-edit-one" data-s="' + esc(id) + '">✏ 改名</button>' +
            '<button class="mini danger" data-act="src-del-one" data-s="' + esc(id) + '">×</button>' +
            '</span></div>';
        }).join('') + '</div>';
      return wrapModal(body, [['modal-close', '关闭', 'ghost']]);
    }
    if (m.type === 'group') {
      if (m.ids && m.ids.length) {
        /* 批量分组 / 改分组 / 移出分组 */
        var batches = m.ids, cnt = {};
        allBills().forEach(function (b) {
          if (batches.indexOf(b.id) !== -1) { var k = b.groupId || ''; cnt[k] = (cnt[k] || 0) + 1; }
        });
        var total = {};
        allBills().forEach(function (b) { var k = b.groupId || ''; total[k] = (total[k] || 0) + 1; });
        body = '<h3>移到分组（已勾选 ' + batches.length + ' 条账单）</h3>' +
          '<div class="seg g-mode"><button class="' + (m.copy ? '' : 'on') + '" data-act="group-mode" data-v="move">移过去</button>' +
          '<button class="' + (m.copy ? 'on' : '') + '" data-act="group-mode" data-v="copy">复制一份</button></div>' +
          '<p class="hint">' + (m.copy
            ? '<b>复制一份</b>：原账单留在原处不动，另外复制出 ' + batches.length + ' 条放进选的分组。'
            : '<b>移过去</b>：把这几条的归属直接改成选的分组（原来在别组的会被挪走）。') +
          ' 选「移出分组」就等于把它们的归属改成<strong>不属于任何分组</strong>。</p>' +
          '<div class="cat-grid group-grid">' +
          '<button class="cat-btn" data-act="group-apply" data-val=""><b>🚫 移出分组</b><small>不归属任何分组' + (cnt[''] ? ' · 其中 ' + cnt[''] + ' 条本来就没分组' : '') + '</small></button>' +
          Store.state.groups.map(function (g) {
            return '<button class="cat-btn" data-act="group-apply" data-val="' + g.id + '"><b>📁 ' + esc(g.name) + '</b><small>' +
              (cnt[g.id] ? '其中已在该组 ' + cnt[g.id] + ' 条 · ' : '') + '该组现有 ' + (total[g.id] || 0) + ' 条</small></button>';
          }).join('') +
          '</div>' +
          '<div class="g-new"><input type="text" id="g-new-name" placeholder="新分组名，如：三亚旅游">' +
          '<button class="ghost" data-act="group-apply-new">新建分组并' + (m.copy ? '复制' : '移入') + '</button></div>';
        return wrapModal(body, [['modal-close', '取消', 'ghost']]);
      }
      body = '<h3>' + (m.group ? '重命名分组' : '新建分组') + '</h3>' +
        '<input type="text" id="g-name" value="' + esc(m.group ? m.group.name : '') + '" placeholder="分组名，如：三亚旅游支出" autofocus>';
      return wrapModal(body, [['group-save', '保存', 'primary'], ['modal-close', '取消', 'ghost']]);
    }
    if (m.type === 'manual') {
      body = '<h3>添加手动项</h3><div class="form-grid">' +
        fld('项目', '<input type="text" id="cm-item" placeholder="如：外卖">') +
        fld('金额', '<input type="text" inputmode="decimal" id="cm-amount" placeholder="0.00">') +
        fld('类型', '<select id="cm-type"><option value="expense">支出</option><option value="income">收入</option></select>') +
        '</div>';
      return wrapModal(body, [['calc-save-manual', '添加', 'primary'], ['modal-close', '取消', 'ghost']]);
    }
    if (m.type === 'wallet-edit') {
      var w0 = m.wallet || null;
      var used = {};
      (w0 && w0.sources || []).forEach(function (s) { used[s] = true; });
      var srcIds = allSourceIds();
      body = '<h3>' + (w0 ? '编辑钱包' : '添加钱包') + '</h3>' +
        '<div class="form-grid">' +
        fld('名称', '<input type="text" id="w-name" value="' + esc(w0 ? w0.name : '') + '" placeholder="如：微信 / 招商银行卡" autofocus>') +
        fld('图标', '<input type="text" id="w-icon" value="' + esc(w0 ? (w0.icon || '💳') : '💳') + '" placeholder="💳">') +
        fld('类型', '<select id="w-kind">' + WALLET_KINDS.map(function (k) {
          return '<option value="' + k[0] + '"' + (w0 && w0.kind === k[0] ? ' selected' : '') + '>' + k[1] + '</option>';
        }).join('') + '</select>') +
        fld('初始余额', '<input type="text" inputmode="decimal" id="w-init" value="' + esc(w0 ? (w0.init || '0') : '0') + '" placeholder="0.00">') +
        '</div>' +
        '<p class="hint">关联来源：勾上以后，这个来源的账单会自动算进这个钱包（收入加、支出减）。不勾就只显示手动填的余额。</p>' +
        '<div class="w-src-pick">' + srcIds.map(function (id) {
          return '<label class="w-cb"><input type="checkbox" class="w-src-cb" value="' + id + '"' + (used[id] ? ' checked' : '') + '> ' + esc(srcName(id)) + '</label>';
        }).join('') + '</div>';
      return wrapModal(body, [['wallet-save', '保存', 'primary']].concat(w0 ? [['wallet-del', '删除这个钱包', 'danger']] : []).concat([['modal-close', '取消', 'ghost']]));
    }
    if (m.type === 'wallet-balance') {
      var wb = m.wallet || {};
      var wr = walletShown(wb);
      body = '<h3>' + esc(wb.icon || '💳') + ' ' + esc(wb.name) + ' · 手动改余额</h3>' +
        '<p class="hint">按账单算出来是 <b>' + moneyText(wr.stat.auto) + '</b>（初始 ' + moneyText(wr.stat.init) + ' + 收入 ' + fmt(wr.stat.inc) + ' − 支出 ' + fmt(wr.stat.exp) + '）。' +
        '如果你查到的真实余额不一样，填在下面，以后就以它为准。</p>' +
        '<div class="form-grid">' + fld('当前余额', '<input type="text" inputmode="decimal" id="w-bal-input" value="' + esc(Money.str(wr.value)) + '" autofocus>') + '</div>';
      return wrapModal(body, [['wallet-balance-save', '保存', 'primary']].concat(wr.manual !== null ? [['wallet-balance-clear', '改回按账单自动算', 'ghost']] : []).concat([['modal-close', '取消', 'ghost']]));
    }
    if (m.type === 'wallet-transfer') {
      var beforeW2 = Store.state.wallets || [];
      if (beforeW2.length < 2) {
        body = '<h3>🔁 钱包互相转账</h3>' +
          '<p class="hint">至少要有 <b>两个</b> 钱包才能互相转账。先回钱包页用「＋ 添加钱包」或「⚡ 快速添加」多建一个吧。</p>';
        return wrapModal(body, [['modal-close', '知道了', 'primary']]);
      }
      var presetFrom = m.from && Store.getWallet(m.from) ? m.from : beforeW2[0].id;
      var presetTo = (function () {
        if (m.to && Store.getWallet(m.to) && m.to !== presetFrom) return m.to;
        var other = beforeW2.filter(function (x) { return x.id !== presetFrom; })[0];
        return other ? other.id : presetFrom;
      })();
      function wOpts(sel) {
        return beforeW2.map(function (w) {
          return '<option value="' + w.id + '"' + (w.id === sel ? ' selected' : '') + '>' + esc((w.icon || '💳') + ' ' + w.name) + '</option>';
        }).join('');
      }
      body = '<h3>🔁 钱包互相转账</h3>' +
        '<p class="hint">把一笔钱从一个钱包挪到另一个钱包。只改这两个钱包的余额，不产生账单，<b>资产合计不变</b>。</p>' +
        '<div class="form-grid">' +
        fld('从哪个钱包转出', '<select id="wt-from">' + wOpts(presetFrom) + '</select>') +
        fld('转入哪个钱包', '<select id="wt-to">' + wOpts(presetTo) + '</select>') +
        fld('金额', '<input type="text" inputmode="decimal" id="wt-amount" placeholder="0.00" autofocus>') +
        fld('日期', '<input type="date" id="wt-date" value="' + esc(Util.todayISO()) + '">') +
        fld('备注（可选）', '<input type="text" id="wt-note" placeholder="如：还信用卡 / 提现 / 充值">') +
        '</div>';
      return wrapModal(body, [['wallet-transfer-save', '确认转账', 'primary'], ['modal-close', '取消', 'ghost']]);
    }
    if (m.type === 'tutorial') {
      body = '<h3>✏ 编辑导入教程</h3>' +
        '<p class="hint">这里写的步骤会显示在「导入账单」页的教程里，可以改成你自己习惯的说法（比如换成你手机上真实的菜单路径）。留空并保存 = 回到内置教程。</p>' +
        '<p class="hint">格式：<b>一个平台一块</b>——第一行写「平台名　导出格式」（中间用全角空格隔开），下面每行写一步；不同平台之间<b>空一行</b>隔开。改完就会像内置教程那样一个平台一个方块。</p>' +
        '<textarea id="tut-box" class="tut-edit-box" spellcheck="false">' + esc(tutorialText()) + '</textarea>';
      return wrapModal(body, [['tut-save', '保存', 'primary'], ['tut-reset', '恢复内置教程', 'ghost'], ['modal-close', '取消', 'ghost']]);
    }
    if (m.type === 'confirm') {
      body = '<h3>' + esc(m.title || '确认') + '</h3><p>' + esc(m.text || '') + '</p>';
      var btns = [['confirm-yes', m.okText || '确定', 'primary']];
      if (m.altText) btns.push(['confirm-alt', m.altText, 'danger']);
      btns.push(['modal-close', '取消', 'ghost']);
      return wrapModal(body, btns);
    }
    if (m.type === 'dupinline') {
      var groups2 = m.groups;
      body = '<h3>查重结果</h3><p class="hint">判定依据：单号相同即为重复；无单号才按「日期 + 项目 + 金额」判断。点开任意一条可展开完整明细（单号 / 来源 / 时间）核对。</p>' + (groups2.length ? groups2.map(function (g) {
        return '<div class="dup-group"><div class="dup-head"><b>' + esc(g.sample.date) + ' · ' + esc(g.sample.item) + ' · ¥' + fmt(g.sample.amount) + '</b>' +
          '<span class="pill">共 ' + g.count + ' 条</span>' +
          (g.key.indexOf('order|') === 0 ? '<span class="flag dupe">单号相同</span>' : '<span class="flag unsure">无单号·启发式</span>') +
          '</div>' +
          '<div class="bill-list">' + g.bills.map(function (x) { return billRow(x, { selectable: false }); }).join('') + '</div></div>';
      }).join('') : '<p class="hint">没有重复</p>');
      return wrapModal(body, [['dup-open-organize', '去查重页勾选删除', 'primary'], ['modal-close', '关闭', 'ghost']]);
    }
    if (m.type === 'history') {
      var hItems = Store.historyList();
      body = '<h3>🕘 变更记录</h3>' +
        '<p class="hint">记录这次打开期间的改动（改分类 / 新建 / 删除 / 转账 / 导入等，最多 80 步）。' +
        '只存在内存里，刷新页面即清空；导出备份不包含它。点某一步的「回到这里」= 撤销这一步以及它之后的所有改动。</p>' +
        (hItems.length
          ? '<div class="hist-list">' + hItems.map(function (h, n) {
              return '<div class="hist-row' + (n === 0 ? ' now' : '') + '">' +
                '<span class="hist-seq">' + (hItems.length - n) + '</span>' +
                '<div class="hist-main"><b>' + esc(h.label) + '</b><span class="hist-time">' + histTime(h.at) + '</span></div>' +
                '<button class="mini" data-act="hist-revert" data-idx="' + h.i + '" title="撤销这一步及其之后的所有改动">回到这里</button>' +
                '</div>';
            }).join('') + '</div>'
          : '<p class="hint">还没有任何改动。</p>');
      return wrapModal(body, [['undo', '↩ 撤销上一步', 'primary'], ['hist-clear', '清空记录', 'ghost'], ['modal-close', '关闭', 'ghost']]);
    }
    if (m.type === 'chart-detail') {
      var cdList = (m.bills || chartBillsFor(m.key)).slice().sort(function (a, b) {
        if ((a.date || '') !== (b.date || '')) return (a.date || '') < (b.date || '') ? 1 : -1;
        return String(a.time || '') < String(b.time || '') ? 1 : -1;
      });
      var cdExp = cdList.filter(function (b) { return b.type === 'expense'; });
      var cdInc = cdList.filter(function (b) { return b.type === 'income'; });
      function cdSum(arr) { return fmt(Money.str(Money.sumBig(arr.map(function (b) { return b.amount; })))); }
      body = '<h3>' + esc(m.label || '账单明细') + '</h3>' +
        '<p class="hint">共 <b>' + cdList.length + '</b> 笔' +
        (cdExp.length ? ' · 支出 <b class="exp">¥' + cdSum(cdExp) + '</b>' : '') +
        (cdInc.length ? ' · 收入 <b class="inc">¥' + cdSum(cdInc) + '</b>' : '') +
        '。点任意一条可展开完整明细。</p>' +
        '<div class="cd-list">' + (cdList.length ? cdList.map(function (b) { return billRow(b, { selectable: false }); }).join('') : '<div class="empty">没有账单</div>') + '</div>';
      return wrapModal(body, [['modal-close', '关闭', 'ghost']]);
    }
    return '';
  }
  function wrapModal(body, actions) {
    return '<div class="modal-mask" data-act="modal-close"><div class="modal" data-act="stop">' + body +
      '<div class="modal-actions">' + actions.map(function (a) {
        return '<button class="' + (a[2] || 'ghost') + '" data-act="' + a[0] + '">' + a[1] + '</button>';
      }).join('') + '</div></div></div>';
  }
  function fld(label, ctrl) { return '<label class="fld"><span>' + label + '</span>' + ctrl + '</label>'; }

  /* ============================================================ 渲染后钩子 */
  function afterRender() {
    if (S.tab === 'charts') drawChart();
    if (S.tab === 'export') renderExportPreview();
    if (S.tab === 'import') bindImport();
  }

  function renderExportPreview() {
    var box = document.getElementById('exp-preview');
    if (!box) return;
    var scope = S.exportScope || (selectedIds().length ? 'selected' : 'filtered');
    var list = scope === 'all' ? allBills() : (scope === 'filtered' ? filtered() : selectedBills());
    if (!list.length) { box.innerHTML = '<div class="empty">没有可导出的账单</div>'; return; }
    var canvas = ExportImage.render(list, {
      title: (document.getElementById('exp-title') || {}).value || S.expTitle || '账单明细',
      subtitle: (document.getElementById('exp-sub') || {}).value || S.expSub || '',
      note: (document.getElementById('exp-note') || {}).value || S.expNote || '',
      style: S.exportStyle
    });
    box.innerHTML = '';
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    box.appendChild(canvas);
  }

  function bindImport() {
    var fi = document.getElementById('fileinput');
    if (fi) fi.addEventListener('change', function () { if (fi.files[0]) handleFile(fi.files[0]); });
    var dz = document.getElementById('dropzone');
    if (dz) {
      ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
      dz.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
    }
  }

  /* ============================================================ 导入逻辑 */
  async function handleFile(file) {
    var name = file.name || '';
    if (/\.xls$/i.test(name)) {
      S.imp = { step: 'choose', error: '.xls 旧格式暂不支持，请在 Excel 中另存为 .xlsx 或 .csv 后重试。' };
      render();
      return;
    }
    S.imp = { step: 'choose', busy: true };
    render();
    try {
      var buf = await file.arrayBuffer();
      var table = await Parse.parseFile(name, buf);
      startMapping(table, name, buf);
    } catch (e) {
      console.error(e);
      S.imp = { step: 'choose', error: '解析失败：' + (e.message || e) };
      render();
    }
  }

  function startMapping(table, fileName, buffer) {
    S.imp = {
      step: 'mapping', table: table, mapping: Parse.mapColumns(table.headers),
      source: Parse.sniffSource(table.headers, fileName),
      sheetIndex: 0,
      sheets: table.meta && table.meta.sheets ? table.meta.sheets.map(function (s) { return s.name; }) : null,
      forceType: 'auto', fileBuffer: buffer || null, fileName: fileName,
      skipRows: {}, errors: []
    };
    render();
  }

  function buildFromImport() {
    var imp = S.imp;
    var matcher = Categorize.buildMatcher(Store.state.customRules);
    var forceType = imp.forceType === 'auto' ? null : imp.forceType;
    var res = Importer.buildBills(imp.table, { matcher: matcher, mapping: imp.mapping, source: imp.source, forceType: forceType, skipRows: imp.skipRows });
    if (!res.bills.length) { toast('没有解析到有效账单，请检查列对应关系', 'err'); return; }
    // 去重检测（新账单 + 已有账单）
    var combined = allBills().concat(res.bills);
    var groups = Dedupe.findDuplicateGroups(combined);
    var newIds = {}; res.bills.forEach(function (b) { newIds[b.id] = 1; });
    groups = groups.filter(function (g) { return g.ids.some(function (id) { return newIds[id]; }); });
    S.imp.pending = res;
    if (groups.length) {
      S.imp.step = 'dup';
      S.imp.dupGroups = groups;
      S.imp.dupChoice = groups.map(function () { return 'review'; });
      render();
    } else {
      finishImport([]);
    }
  }

  function finishImport() {
    var imp = S.imp;
    var res = imp.pending;
    var bills = res.bills;
    var dropIds = {}, keepIds = {}, reviewIds = {};
    if (imp.step === 'dup') {
      (imp.dupGroups || []).forEach(function (g, i) {
        var choice = imp.dupChoice[i] || 'review';
        // 每组里「新导入的」账单
        var newInGroup = g.bills.filter(function (b) { return bills.some(function (x) { return x.id === b.id; }); });
        if (choice === 'keep') return;
        if (choice === 'drop') newInGroup.forEach(function (b) { dropIds[b.id] = 1; });
        else if (choice === 'one') newInGroup.forEach(function (b, k) { if (k > 0) dropIds[b.id] = 1; });
        else if (choice === 'review') newInGroup.forEach(function (b) { reviewIds[b.id] = 1; });
      });
    }
    var finalBills = bills.filter(function (b) { return !dropIds[b.id]; }).map(function (b) {
      if (reviewIds[b.id]) { b.review = true; b.dupe = true; }
      return b;
    });
    Store.mark('导入账单');
    Store.addBills(finalBills);
    var s = Filters.summary(finalBills);
    S.imp = { step: 'choose' };
    toast('导入完成：新增 ' + finalBills.length + ' 条；支出 ¥' + fmt(s.expense) + '，收入 ¥' + fmt(s.income) +
      (Object.keys(reviewIds).length ? '；' + Object.keys(reviewIds).length + ' 条放入保留箱' : ''), 'ok');
    S.tab = 'bills';
    render();
  }

  /* ============================================================ 事件处理 */
  function toggleIn(arr, val) {
    var i = arr.indexOf(val);
    if (i === -1) arr.push(val); else arr.splice(i, 1);
    return arr;
  }

  function onField(el) {
    var f = el.getAttribute('data-field');
    if (!f) return false;
    if (el.type === 'checkbox') toggleIn(S.filters[f] || (S.filters[f] = []), el.value);
    else S.filters[f] = el.value;
    return true;
  }

  document.addEventListener('change', function (e) {
    var el = e.target;
    Store._commitNow();   /* 收尾上一次改动，保证每次改动是独立一条记录 */
    if (el.getAttribute && el.getAttribute('data-map')) {
      var k = el.getAttribute('data-map');
      S.imp.mapping[k] = parseInt(el.value, 10);
      return;
    }
    var act = el.getAttribute && el.getAttribute('data-act');
    if (act === 'imp-force-type') { S.imp.forceType = el.value; return; }
    if (act === 'stats-period') { S.statsPeriod = el.value; render(); return; }
    if (act === 'stats-year') {
      var py = periodParts(), ny = el.value, nm = py.month;
      if (ny && nm && periodMonths(ny).indexOf(nm) === -1) nm = '';
      setPeriod(ny, nm);
      render(); return;
    }
    if (act === 'stats-month') {
      var p2 = periodParts(), nmo = el.value, ny2 = p2.year;
      if (nmo && !ny2) {
        var ys = periodYears();
        for (var yi = 0; yi < ys.length; yi++) { if (periodMonths(ys[yi]).indexOf(nmo) !== -1) { ny2 = ys[yi]; break; } }
      }
      setPeriod(ny2, nmo);
      render(); return;
    }
    if (act === 'imp-sheet') { reloadSheet(parseInt(el.value, 10)); return; }
    if (act === 'imp-source') { S.imp.source = el.value; return; }
    if (act === 'calc-split') { S.calcSplit = parseInt(el.value, 10) || 0; render(); return; }
    if (el.getAttribute && el.getAttribute('data-field')) { onField(el); render(); return; }
    if (act === 'org-assign-cat') { assignCategory(selectedIds(), el.value); return; }
    if (act === 'group-assign') { if (el.value) assignGroup(selectedIds(), el.value, false); return; }
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el.getAttribute) return;
    var f = el.getAttribute('data-field');
    if (el.id === 'm-search') { S.merchantSearch = el.value; renderMerchantsLight(); return; }
    if (el.id === 'm-min') { var mv = parseInt(el.value, 10); S.merchantMinCount = mv > 0 ? mv : 1; renderMerchantsLight(); return; }
    if (el.id === 'calc-search') { S.calcPick = el.value; renderCalcPool(); return; }
    if (f === 'keyword') { S.filters.keyword = el.value; S.listLimit = 200; renderLight(); return; }
    if (f && (f === 'amountMin' || f === 'amountMax')) { S.filters[f] = el.value; }
    // 导出表单实时预览
    if (el.id === 'exp-title' || el.id === 'exp-sub' || el.id === 'exp-note') {
      S.expTitle = (document.getElementById('exp-title') || {}).value || '';
      S.expSub = (document.getElementById('exp-sub') || {}).value || '';
      S.expNote = (document.getElementById('exp-note') || {}).value || '';
      if (S._expT) clearTimeout(S._expT);
      S._expT = setTimeout(renderExportPreview, 250);
    }
  });

  /* 轻量重绘：只更新列表区，避免搜索框失焦 */
  function renderLight() {
    var list = filtered();
    var wrap = document.querySelector('.bill-list');
    if (wrap && S.tab === 'bills' && !S.modal) {
      wrap.innerHTML = list.slice(0, S.listLimit).map(billRow).join('') || '<div class="empty">没有匹配的账单</div>';
      var sb = document.querySelector('.sumbar');
      if (sb) sb.outerHTML = summaryBar(list);
    } else render();
  }

  document.addEventListener('click', function (e) {
    try { handleClick(e); } catch (err) {
      console.error('[click]', err);
      try { toast('操作出错：' + ((err && err.message) || err), 'err'); } catch (e2) {}
    }
  });

  function handleClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    /* 下拉框 / 文本框：交给 change、input 处理。
     * 如果这里也 render()，会把下拉框整个重建 → 刚展开就被销毁，表现成「点一下闪一下、根本点不开」。 */
    var tg = String(el.tagName || '').toUpperCase();
    if (tg === 'SELECT' || tg === 'TEXTAREA') return;
    if (tg === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio') return;
    if (act === 'stop') { e.stopPropagation(); return; }
    Store._commitNow();   /* 上一次改动收尾：保证「一次点击 = 一条独立的变更记录」 */
    if (act === 'undo') {
      var uh = Store.undo();
      if (!uh) { toast('没有可撤销的改动了', 'err'); return; }
      resetAfterUndo(false);
      toast('已撤销：' + uh.label, 'ok');
      render(); return;
    }
    if (act === 'hist-open') { openModal({ type: 'history' }); return; }
    if (act === 'hist-revert') {
      var hIdx = parseInt(el.getAttribute('data-idx'), 10);
      var hRevert = Store.revertTo(hIdx);
      if (!hRevert) { toast('记录已变化，请重新打开看看', 'err'); return; }
      resetAfterUndo(true);
      toast('已回到「' + hRevert.label + '」之前（撤销 ' + hRevert.steps + ' 步）', 'ok');
      render(); return;
    }
    if (act === 'hist-clear') {
      Store.clearHistory();
      toast('变更记录已清空（数据不变）', 'ok');
      closeModal(); return;
    }
    if (act === 'select') { e.stopPropagation(); S.selection[el.getAttribute('data-id')] = el.checked; updateFloat(); return; }
    if (act === 'tab') { S.tab = el.getAttribute('data-tab'); render(); return; }
    if (act === 'theme-toggle') { setTheme(S.theme === 'light' ? 'dark' : 'light'); return; }
    if (act === 'theme-set') { setTheme(el.getAttribute('data-theme')); return; }
    if (act === 'expand') {
      var id = el.getAttribute('data-id');
      S.detailOpen[id] = !S.detailOpen[id];
      renderLight();
      return;
    }
    if (act === 'filter-toggle') { S.showFilters = !S.showFilters; render(); return; }
    if (act === 'f-toggle') {
      var field = el.getAttribute('data-field'), val = el.getAttribute('data-val');
      if (!Array.isArray(S.filters[field])) S.filters[field] = [];
      toggleIn(S.filters[field], val);
      /* 选中某一项时，自动把它从「剔除」里放出来 */
      var exf = EXCL_SEL_INV[field];
      if (exf) {
        var exi = exList(exf).indexOf(val);
        if (exi !== -1 && S.filters[field].indexOf(val) !== -1) { exList(exf).splice(exi, 1); saveExclusions(); }
      }
      render(); return;
    }
    if (act === 'f-clear') { S.filters = blankFilters(); S.exclMode = ''; S.exclStage = {}; saveExclusions(); render(); return; }
    if (act === 'period-all') { S.statsPeriod = 'all'; render(); return; }
    if (act === 'nav-up') { moveNav(el.getAttribute('data-tab'), -1); return; }
    if (act === 'nav-down') { moveNav(el.getAttribute('data-tab'), 1); return; }
    if (act === 'nav-reset') { resetNavOrder(); return; }
    if (act === 'tut-edit') { openModal({ type: 'tutorial' }); return; }
    if (act === 'tut-save') {
      var tb = document.getElementById('tut-box');
      var tv = tb ? String(tb.value || '').trim() : '';
      Store.state.settings.tutorial = tv === defaultTutorialText().trim() ? '' : tv;
      Store.save(); closeModal();
      toast(tv ? '教程已保存（只有你能看到）' : '已恢复内置教程', 'ok');
      return;
    }
    if (act === 'tut-reset') {
      Store.state.settings.tutorial = '';
      Store.save();
      if (S.modal && S.modal.type === 'tutorial') closeModal();
      toast('已恢复内置教程', 'ok');
      return;
    }
    if (act === 'calc-use-all') { S.filters = blankFilters(); S.selection = {}; toast('已改成算全部账单', 'ok'); render(); return; }    if (act === 'calc-goto-filter') { S.tab = 'bills'; S.showFilters = true; S.listLimit = 200; render(); return; }
    if (act === 'excl-mode') {
      var emf = el.getAttribute('data-field');
      S.exclMode = S.exclMode === emf ? '' : emf;
      S.exclStage = {};
      render(); return;
    }
    if (act === 'excl-stage') {
      var esf = el.getAttribute('data-field'), esv = el.getAttribute('data-val');
      S.exclStage = S.exclStage || {};
      var arr = S.exclStage[esf] || (S.exclStage[esf] = []);
      toggleIn(arr, esv);
      render(); return;
    }
    if (act === 'excl-apply') {
      var eaf = S.exclMode;
      var staged = (S.exclStage && S.exclStage[eaf]) || [];
      if (!staged.length) { toast('先点几个要排除的项', 'err'); return; }
      staged.forEach(function (v) { exAdd(eaf, v, true); });
      S.exclStage = {}; S.exclMode = '';
      S.listLimit = 200;
      toast('已排除 ' + staged.length + ' 项（可在上方红色条恢复）', 'ok');
      render(); return;
    }
    if (act === 'excl-hint-toggle') {
      Store.state.settings.exclCollapsed = !(Store.state.settings.exclCollapsed === true);
      Store.save(); render(); return;
    }
    /* 快捷剔除（分类 / 商户 / 来源 共用一套动作名） */
    if (EXCL_ACTS[act]) { exAdd(EXCL_ACTS[act], el.getAttribute('data-val')); S.listLimit = 200; return; }
    if (EXCL_OFF_ACTS[act]) { exRemove(EXCL_OFF_ACTS[act], el.getAttribute('data-val')); return; }
    if (EXCL_CLEAR_ACTS[act]) { S.filters[EXCL_CLEAR_ACTS[act]] = []; saveExclusions(); render(); return; }
    if (act === 'f-remove') {
      var rf = el.getAttribute('data-field'), rv = el.getAttribute('data-val');
      if (Array.isArray(S.filters[rf])) toggleIn(S.filters[rf], rv);
      render(); return;
    }
    if (act === 'f-clear-date') { S.filters.dateFrom = ''; S.filters.dateTo = ''; render(); return; }
    if (act === 'f-clear-amount') { S.filters.amountMin = ''; S.filters.amountMax = ''; render(); return; }
    if (act === 'f-clear-flag') { S.filters.flag = 'all'; render(); return; }
    if (act === 'f-clear-keyword') { S.filters.keyword = ''; render(); return; }
    if (act === 'filter-merchant') { S.filters.counterparties = [el.getAttribute('data-m')]; S.filters.items = []; S.showFilters = true; S.listLimit = 200; S.tab = 'bills'; S.modal = null; render(); return; }
    if (act === 'filter-item') { S.filters.items = [el.getAttribute('data-m')]; S.showFilters = true; S.listLimit = 200; S.tab = 'bills'; S.modal = null; render(); return; }
    if (act === 'merchant-multi-toggle') { S.merchantMultiOnly = !S.merchantMultiOnly; render(); return; }
    if (act === 'merchant-view') { S.filters.counterparties = [el.getAttribute('data-m')]; S.filters.items = []; S.filters.keyword = ''; S.showFilters = true; S.listLimit = 200; S.tab = 'bills'; render(); return; }
    if (act === 'merchant-select') {
      var mm = el.getAttribute('data-m');
      var mids = allBills().filter(function (b) { return (Filters.merchantOf(b) || '（无商户/项目）') === mm; }).map(function (b) { return b.id; });
      mids.forEach(function (i) { S.selection[i] = true; });
      toast('已勾选 ' + mids.length + ' 条', 'ok'); render(); return;
    }
    if (act === 'merchant-group') {
      var gm = el.getAttribute('data-m');
      var gids = allBills().filter(function (b) { return (Filters.merchantOf(b) || '（无商户/项目）') === gm; }).map(function (b) { return b.id; });
      var exist = Store.state.groups.filter(function (x) { return x.name === gm; })[0];
      var g = exist || Store.createGroup(gm);
      Store.updateBills(gids, { groupId: g.id });
      toast('已把 ' + gids.length + ' 条存入分组「' + gm + '」', 'ok'); S.tab = 'groups'; render(); return;
    }
    if (act === 'f-quick-month') {
      var d = new Date(); var m = Util.monthOf(Util.todayISO(d));
      S.filters.dateFrom = m + '-01'; S.filters.dateTo = m + '-31';
      render(); return;
    }
    if (act === 'f-quick-7') {
      var now = new Date(); var p = new Date(now.getTime() - 6 * 86400000);
      S.filters.dateFrom = Util.todayISO(p); S.filters.dateTo = Util.todayISO(now); render(); return;
    }
    if (act === 'search-clear') { S.filters.keyword = ''; S.listLimit = 200; render(); return; }
    if (act === 'merchant-search-clear') { S.merchantSearch = ''; render(); return; }
    if (act === 'merchant-min') {
      var mv = parseInt(el.value, 10);
      S.merchantMinCount = (mv > 0) ? mv : 1; renderMerchantsLight(); return;
    }
    if (act === 'merchant-min-set') { S.merchantMinCount = parseInt(el.getAttribute('data-n'), 10) || 1; render(); return; }
    if (act === 'scan-dupe') {
      var nDup = Dedupe.findDuplicateGroups(allBills()).length;
      S.tab = 'organize'; S.organizeSub = 'dupe'; S.dupeSeeded = false; render();
      toast(nDup ? '发现 ' + nDup + ' 组疑似重复' : '没有发现重复账单', nDup ? 'ok' : 'err');
      return;
    }
    /* 商户排除规则 */
    if (act === 'mex-add') {
      var mi = document.getElementById('mex-word');
      var w = Store.addMerchantExclude(mi ? mi.value : '');
      if (!w) { toast('请输入关键词', 'err'); return; }
      toast('已排除含「' + w + '」的商户', 'ok'); render(); return;
    }
    if (act === 'merchant-exclude') {
      var mw = Store.addMerchantExclude(el.getAttribute('data-m'));
      toast('已排除「' + mw + '」', 'ok'); render(); return;
    }
    if (act === 'mex-del') {
      var dw = el.getAttribute('data-word');
      if (dw == null) {
        var di = parseInt(el.getAttribute('data-i'), 10);
        dw = merchantExcludes()[di];
      }
      Store.removeMerchantExclude(dw);
      toast('已恢复「' + dw + '」', 'ok'); render(); return;
    }
    if (act === 'mex-clear') { Store.clearMerchantExcludes(); toast('已恢复全部被排除的商户', 'ok'); render(); return; }
    if (act === 'mex-hide-toggle') {
      var hx = String(el.tagName || '').toUpperCase() === 'INPUT' ? !!el.checked : !hideExcluded();
      Store.state.settings.hideExcluded = hx;
      Store.save();
      toast(hx ? '已排除的账单不会再出现在总账单里' : '已排除的账单会在总账单里显示（带 🚫 标记，统计仍然不算它们）', 'ok');
      render(); return;
    }
    if (act === 'sort') { var k = el.getAttribute('data-key'); if (S.sortKey === k) S.sortDesc = !S.sortDesc; else { S.sortKey = k; S.sortDesc = true; } render(); return; }
    if (act === 'load-more') { S.listLimit += 300; render(); return; }
    if (act === 'select-all') {
      filtered().slice(0, S.listLimit).forEach(function (b) { S.selection[b.id] = true; });
      render(); return;
    }
    if (act === 'select-all-filtered') {
      var all = filtered();
      all.forEach(function (b) { S.selection[b.id] = true; });
      toast('已选中当前筛选结果共 ' + all.length + ' 条，可批量改分类 / 加标签 / 删除', 'ok');
      render(); return;
    }
    if (act === 'sel-clear') { S.selection = {}; render(); return; }
    if (act === 'sel-delete') { confirmDelete(selectedIds()); return; }
    if (act === 'sel-mark-unsure') { Store.mark('移入不记得箱'); Store.updateBills(selectedIds(), { unsure: true }); toast('已移入不记得箱', 'ok'); render(); return; }
    if (act === 'sel-mark-review') { Store.mark('移入保留箱'); Store.updateBills(selectedIds(), { review: true }); toast('已移入保留箱', 'ok'); render(); return; }
    if (act === 'sel-to-calc') { S.tab = 'calc'; render(); return; }
    if (act === 'sel-group' || act === 'sel-to-group') {
      var gsids = selectedIds();
      if (!gsids.length) { toast('请先勾选账单，再改分组', 'err'); return; }
      openModal({ type: 'group', ids: gsids }); return;
    }
    if (act === 'bill-group-one') {
      openModal({ type: 'group', ids: [el.getAttribute('data-id')] }); return;
    }
    if (act === 'group-apply') {
      var gaIds = (S.modal && S.modal.ids) || selectedIds();
      if (!gaIds.length) { toast('请先勾选账单', 'err'); return; }
      var gaGid = el.getAttribute('data-val') || null;
      var gaCopy = !!(S.modal && S.modal.copy);
      S.modal = null;
      assignGroup(gaIds, gaGid, gaCopy);
      return;
    }
    if (act === 'group-mode') {
      if (S.modal) S.modal.copy = el.getAttribute('data-v') === 'copy';
      render(); return;
    }
    if (act === 'group-apply-new') {
      var gnEl = document.getElementById('g-new-name');
      var gn = gnEl && gnEl.value ? gnEl.value.trim() : '';
      if (!gn) { toast('请输入新分组名', 'err'); return; }
      var ng = Store.createGroup(gn);
      var gnIds = (S.modal && S.modal.ids) || selectedIds();
      var gnCopy = !!(S.modal && S.modal.copy);
      S.modal = null;
      assignGroup(gnIds, ng.id, gnCopy);
      toast('已新建「' + gn + '」并移入 ' + gnIds.length + ' 条', 'ok');
      return;
    }
    if (act === 'group-show-all') { S.groupLimit = S.groupLimit || {}; S.groupLimit[el.getAttribute('data-id')] = true; render(); return; }
    if (act === 'group-only') {
      S.tab = 'bills'; S.showFilters = true; S.modal = null; S.listLimit = 200;
      S.filters.groups = [el.getAttribute('data-id')];
      render(); return;
    }
    if (act === 'group-copy') {
      var gid2 = (document.querySelector('[data-act="group-assign"]') || {}).value;
      if (!gid2) { toast('请先新建分组', 'err'); return; }
      copyToGroup(selectedIds(), gid2); return;
    }
    if (act === 'sel-tag') { openModal({ type: 'tags' }); return; }
    if (act === 'sel-category') {
      var selN = selectedIds().length;
      if (!selN) { toast('请先勾选要改分类的账单（可点「全选本页」或「全选筛选结果」）', 'err'); return; }
      openModal({ type: 'category', ids: selectedIds() }); return;
    }
    if (act === 'cat-apply') { applyCategory(el.getAttribute('data-id')); return; }

    /* -------- 自定义分类：新建 / 编辑 / 删除 */
    if (act === 'cat-create') {
      var cni = ((document.getElementById('c-new-icon') || {}).value || '').trim();
      var cnn = ((document.getElementById('c-new-name') || {}).value || '').trim();
      var cnt2 = ((document.getElementById('c-new-type') || {}).value) || 'expense';
      if (!cnn) { toast('请先填分类名', 'err'); return; }
      if (cnn.length > 12) { toast('分类名最长 12 个字', 'err'); return; }
      if (catNameExists(cnn, null)) { toast('已经有叫「' + cnn + '」的分类了', 'err'); return; }
      Store.addCategory({ name: cnn, icon: cni || '🏷', type: cnt2, color: '#7c8aa5' });
      toast('已新建分类「' + cnn + '」', 'ok');
      render(); return;
    }
    if (act === 'cat-create-here') {
      var chIds = (S.modal && S.modal.ids) || selectedIds();
      var chM = { type: 'category-edit' };
      if (chIds && chIds.length) chM.back = { type: 'category', ids: chIds };
      openModal(chM);
      return;
    }
    if (act === 'cat-edit-one') {
      var ceid = el.getAttribute('data-id') || (S.modal && S.modal.cat ? S.modal.cat.id : null);
      var cobj = (Store.state.customCategories || []).filter(function (x) { return x.id === ceid; })[0];
      if (!cobj) { toast('找不到这个分类', 'err'); return; }
      openModal({ type: 'category-edit', cat: cobj, back: (S.modal && S.modal.back) || null });
      return;
    }
    if (act === 'cat-save') {
      var sn = ((document.getElementById('ce-name') || {}).value || '').trim();
      var si = ((document.getElementById('ce-icon') || {}).value || '').trim();
      var st = ((document.getElementById('ce-type') || {}).value) || 'expense';
      var editing = S.modal && S.modal.cat;
      var back2 = S.modal && S.modal.back;
      if (!sn) { toast('请填分类名', 'err'); return; }
      if (sn.length > 12) { toast('分类名最长 12 个字', 'err'); return; }
      if (catNameExists(sn, editing ? editing.id : null)) { toast('已经有叫「' + sn + '」的分类了', 'err'); return; }
      if (editing) {
        Store.updateCategory(editing.id, { name: sn, icon: si || editing.icon || '🏷', type: st });
        toast('已保存「' + sn + '」', 'ok');
        closeModal();
      } else {
        Store.addCategory({ name: sn, icon: si || '🏷', type: st, color: '#7c8aa5' });
        toast('已新建分类「' + sn + '」，点它就能应用', 'ok');
        if (back2) openModal(back2); else closeModal();
      }
      render(); return;
    }
    if (act === 'cat-del-one') {
      var did = el.getAttribute('data-id') || (S.modal && S.modal.cat ? S.modal.cat.id : null);
      var dc = (Store.state.customCategories || []).filter(function (x) { return x.id === did; })[0];
      if (!dc) { toast('找不到这个分类', 'err'); return; }
      var dcn = Store.countCategory(dc.id);
      openModal({ type: 'confirm', title: '删除分类', okText: '删除',
        text: '确定删除分类「' + dc.name + '」？' + (dcn ? '它下面 ' + dcn + ' 条账单会改成「其他」（收入改成「其他收入」），之后还能重新改分类。' : '该分类下暂无账单。'),
        onYes: function () {
          var n = Store.removeCategory(dc.id);
          toast('已删除「' + dc.name + '」' + (n ? '，' + n + ' 条账单已改为「其他」' : ''), 'ok');
          render();
        } });
      return;
    }
    /* -------- 商户 / 对方：新增 / 改名（合并）/ 删除 / 排除 */
    if (act === 'mc-new') { openModal({ type: 'merchant-edit' }); return; }
    if (act === 'mc-card-create') {
      var cnN = ((document.getElementById('c-new-merchant') || {}).value || '').trim();
      if (!cnN) { toast('请输入商户 / 对方名字', 'err'); return; }
      Store.addMerchant(cnN);
      toast('已新增「' + cnN + '」，筛选面板里可以选到它了', 'ok');
      render(); return;
    }
    if (act === 'mc-manage') { openModal({ type: 'merchant-manage' }); return; }
    if (act === 'mc-edit-one') { openModal({ type: 'merchant-edit', name: el.getAttribute('data-m') || '' }); return; }
    if (act === 'mc-create') {
      var nm = ((document.getElementById('m-new') || {}).value || '').trim();
      if (!nm) { toast('请输入商户 / 对方名字', 'err'); return; }
      Store.addMerchant(nm);
      toast('已新增「' + nm + '」', 'ok');
      render(); return;
    }
    if (act === 'mc-save') {
      var meName = ((document.getElementById('me-name') || {}).value || '').trim();
      var meFrom = S.modal && S.modal.name;
      if (!meName) { toast('请输入名称', 'err'); return; }
      if (meFrom && meFrom !== meName) {
        var mvN = Store.renameMerchant(meFrom, meName);
        toast('已改名，' + mvN + ' 条账单一起改了', 'ok');
      } else if (!meFrom) {
        Store.addMerchant(meName);
        toast('已新增「' + meName + '」', 'ok');
      }
      closeModal();
      render(); return;
    }
    if (act === 'mc-del-one') {
      var mdName = el.getAttribute('data-m') || (S.modal && S.modal.name) || '';
      if (!mdName) { toast('找不到这个商户', 'err'); return; }
      Store.removeMerchant(mdName);
      toast('已从自定义商户里删除「' + mdName + '」（账单没动）', 'ok');
      if (S.modal && (S.modal.type === 'merchant-edit')) closeModal();
      render(); return;
    }
    if (act === 'mc-exclude' || act === 'mc-exclude-one') {
      var mxName = el.getAttribute('data-m') || (S.modal && S.modal.name) || '';
      if (!mxName) { toast('找不到这个商户', 'err'); return; }
      Store.addMerchantExclude(mxName);
      toast('已排除「' + mxName + '」：清单 / 统计里整体不看，可在筛选面板恢复', 'ok');
      if (S.modal && S.modal.type === 'merchant-edit') closeModal();
      render(); return;
    }
    /* -------- 来源：新建 / 改名 / 删除 */
    if (act === 'src-new') { openModal({ type: 'source-edit' }); return; }
    if (act === 'src-new-import') { openModal({ type: 'source-edit', back: 'import' }); return; }
    if (act === 'src-manage') { openModal({ type: 'source-manage' }); return; }
    if (act === 'src-edit-one') {
      var seId = el.getAttribute('data-s') || '';
      var seC = Store.getSource(seId);
      openModal({ type: 'source-edit', src: seC || { id: seId, name: srcLabel(seId), icon: '' } });
      return;
    }
    if (act === 'src-create') {
      var snm = ((document.getElementById('s-new') || {}).value || '').trim();
      if (!snm) { toast('请输入来源名', 'err'); return; }
      Store.addSource({ name: snm });
      toast('已新建来源「' + snm + '」', 'ok');
      render(); return;
    }
    if (act === 'src-save') {
      var svName = ((document.getElementById('se-name') || {}).value || '').trim();
      var svIcon = ((document.getElementById('se-icon') || {}).value || '').trim();
      var svCur = S.modal && S.modal.src;
      if (!svName) { toast('请输入来源名', 'err'); return; }
      if (svCur && Store.getSource(svCur.id)) {
        Store.updateSource(svCur.id, { name: svName, icon: svIcon || (Store.getSource(svCur.id).icon || '📱') });
      } else if (svCur) {
        /* 内置来源的改名：存一个同 id 的覆盖层，账单不受影响 */
        Store.addSource({ id: svCur.id, name: svName, icon: svIcon || '📱' });
      } else {
        var newSrc = Store.addSource({ name: svName, icon: svIcon || '📱' });
        if (S.modal && S.modal.back === 'import' && newSrc) S.imp.source = newSrc.id;
      }
      toast('已保存来源「' + svName + '」', 'ok');
      var svBack = S.modal && S.modal.back;
      if (!svCur && svBack && svBack !== 'import') { openModal(svBack); } else { closeModal(); }
      render(); return;
    }
    if (act === 'src-del-one') {
      var sdId = el.getAttribute('data-s') || (S.modal && S.modal.src ? S.modal.src.id : '');
      if (!sdId) { toast('找不到这个来源', 'err'); return; }
      var sdBuiltin = !!Parse.SOURCE_LABELS[sdId];
      if (!sdBuiltin) {
        var sdN = Store.countSource(sdId);
        var sdName = srcLabel(sdId);
        openModal({ type: 'confirm', title: '删除来源', okText: '删除',
          text: '确定删除来源「' + sdName + '」吗？' + (sdN ? '用过它的 ' + sdN + ' 条账单会回落成「通用/未知」。' : '还没有账单用它。'),
          onYes: function () {
            Store.removeSource(sdId);
            toast('已删除「' + sdName + '」' + (sdN ? '，' + sdN + ' 条账单回落成通用/未知' : ''), 'ok');
            render();
          } });
        return;
      }
      /* 内置来源：只删掉自己加的改名覆盖层 */
      Store.removeSource(sdId, true);
      toast('已还原内置来源名称', 'ok');
      render(); return;
    }
    if (act === 'tags-apply') { applyTags('add'); return; }
    if (act === 'tags-remove') { applyTags('remove'); return; }
    if (act === 'tag-pick') {
      var inp = document.getElementById('tag-input');
      if (inp) {
        var tg = el.getAttribute('data-tag');
        var cur = parseTags(inp.value);
        var i = cur.indexOf(tg);
        if (i === -1) cur.push(tg); else cur.splice(i, 1);
        inp.value = cur.join(', '); inp.focus();
      }
      return;
    }
    if (act === 'export-style') { S.exportStyle = el.getAttribute('data-style'); render(); return; }
    if (act === 'delete-one') { e.stopPropagation(); confirmDelete([el.getAttribute('data-id')]); return; }
    if (act === 'edit') { openBillModal(el.getAttribute('data-id')); return; }
    if (act === 'dup-one') { e.stopPropagation(); var bid = el.getAttribute('data-id'); var bb = Store.getBill(bid); var gg = Dedupe.findDuplicateGroups(allBills()).filter(function (g) { return g.ids.indexOf(bid) !== -1; }); openModal({ type: 'dupinline', groups: gg }); return; }
    if (act === 'toggle-unsure') { var b1 = Store.getBill(el.getAttribute('data-id')); Store.updateBill(b1.id, { unsure: !b1.unsure }); render(); return; }
    if (act === 'toggle-review') { var b2 = Store.getBill(el.getAttribute('data-id')); Store.updateBill(b2.id, { review: !b2.review }); render(); return; }
    if (act === 'modal-close') { if (el.classList.contains('modal-mask') && e.target !== el) return; closeModal(); return; }
    if (act === 'bill-save') { saveBillModal(); return; }
    if (act === 'confirm-yes') { var fn = S.modal.onYes; closeModal(); if (fn) fn(); return; }
    if (act === 'confirm-alt') { var fa = S.modal.onAlt; closeModal(); if (fa) fa(); return; }

    /* 导入 */
    if (act === 'pick-file') { var fi = document.getElementById('fileinput'); if (fi) fi.click(); return; }
    if (act === 'parse-text') {
      var tb = document.getElementById('paste-box');
      if (!tb || !tb.value.trim()) { toast('请先粘贴账单文本', 'err'); return; }
      try { startMapping(Parse.parseText(tb.value, '粘贴文本'), '粘贴文本'); }
      catch (err) { S.imp = { step: 'choose', error: '解析失败：' + err.message }; render(); }
      return;
    }
    if (act === 'imp-cancel') { S.imp = { step: 'choose' }; render(); return; }
    if (act === 'imp-build') { buildFromImport(); return; }
    if (act === 'imp-row-toggle') {
      var ri = parseInt(el.getAttribute('data-i'), 10);
      if (el.tagName === 'INPUT') { if (el.checked) S.imp.skipRows[ri] = true; else delete S.imp.skipRows[ri]; }
      else if (S.imp.skipRows[ri]) delete S.imp.skipRows[ri];
      else S.imp.skipRows[ri] = true;
      render(); return;
    }
    if (act === 'imp-rows-restore') { S.imp.skipRows = {}; render(); return; }
    if (act === 'imp-rows-autoskip') {
      var mapping = S.imp.mapping, nSkip = 0;
      S.imp.table.rows.forEach(function (row, i) {
        var ex = S.imp.table.freeText ? { amountRaw: row[1] } : Parse.extractRow(row, mapping);
        var raw = ex.amountRaw !== '' && ex.amountRaw != null ? ex.amountRaw
          : (ex.expenseRaw !== '' && ex.expenseRaw != null ? ex.expenseRaw : ex.incomeRaw);
        var okAmt = raw !== '' && raw != null && Money.parse(raw) !== null;
        if (!okAmt && !S.imp.skipRows[i]) { S.imp.skipRows[i] = true; nSkip++; }
      });
      toast(nSkip ? '已自动跳过 ' + nSkip + ' 行非账单数据' : '没有发现无法识别金额的行', nSkip ? 'ok' : 'err');
      render(); return;
    }
    if (act === 'dup-choice') { var i2 = parseInt(el.getAttribute('data-i'), 10); S.imp.dupChoice[i2] = el.getAttribute('data-v'); render(); return; }
    if (act === 'dup-all-review') { S.imp.dupChoice = S.imp.dupChoice.map(function () { return 'review'; }); render(); return; }
    if (act === 'dup-all-keep') { S.imp.dupChoice = S.imp.dupChoice.map(function () { return 'keep'; }); render(); return; }
    if (act === 'imp-finish') { finishImport(); return; }

    /* 计算器 */
    if (act === 'calc-mode') { S.calcMode = el.getAttribute('data-mode'); render(); return; }
    if (act === 'calc-add') {
      var cb = Store.getBill(el.getAttribute('data-id'));
      if (cb) {
        var ca = Money.parse(cb.amount) || 0n;
        var csign = cb.type === 'income' ? 1 : -1;
        S.calcExpr.push({ id: cb.id, item: cb.item, counterparty: cb.counterparty, date: cb.date, amount: Money.str(ca), sign: csign, type: cb.type });
      }
      render(); return;
    }
    if (act === 'calc-del-step') { S.calcExpr.splice(parseInt(el.getAttribute('data-i'), 10), 1); render(); return; }
    if (act === 'calc-flip-step') { var cfi = parseInt(el.getAttribute('data-i'), 10); if (S.calcExpr[cfi]) S.calcExpr[cfi].sign = -S.calcExpr[cfi].sign; render(); return; }
    if (act === 'calc-undo') { S.calcExpr.pop(); render(); return; }
    if (act === 'calc-clear') { S.calcExpr = []; render(); return; }
    if (act === 'calc-search-clear') { S.calcPick = ''; render(); return; }
    if (act === 'calc-add-manual') { openModal({ type: 'manual' }); return; }
    if (act === 'calc-save-manual') {
      var item = (document.getElementById('cm-item') || {}).value || '手动项';
      var amt = (document.getElementById('cm-amount') || {}).value || '';
      if (Money.parse(amt) === null) { toast('请输入正确的金额', 'err'); return; }
      S.calcManual.push({ item: item, amount: Money.str(Money.abs(Money.parse(amt))), type: (document.getElementById('cm-type') || {}).value || 'expense' });
      closeModal(); return;
    }
    if (act === 'calc-del-manual') { S.calcManual.splice(parseInt(el.getAttribute('data-i'), 10), 1); render(); return; }
    if (act === 'calc-copy') { copyCalc(); return; }
    if (act === 'calc-select-tab') { S.tab = 'bills'; render(); return; }

    /* 图表 */
    if (act === 'chart-dim') { S.chart.dim = el.getAttribute('data-dim'); render(); return; }
    if (act === 'chart-type') { S.chart.type = el.getAttribute('data-type'); render(); return; }
    if (act === 'chart-kind') { S.chart.kind = el.getAttribute('data-kind'); render(); return; }
    if (act === 'chart-click') { chartCanvasClick(e, el); return; }
    if (act === 'chart-detail') { openChartDetail(el.getAttribute('data-key'), el.getAttribute('data-label')); return; }

    /* 整理 */
    if (act === 'org-sub') {
      var sub = el.getAttribute('data-sub');
      if (sub === 'dupe' && S.organizeSub !== 'dupe') S.dupeSeeded = false;
      if (sub !== 'dupe') S.dupeSeeded = false;
      S.organizeSub = sub;
      render(); return;
    }
    if (act === 'org-select-all') {
      allBills().filter(function (b) { return b.category === 'other' || b.category === 'other_in'; }).forEach(function (b) { S.selection[b.id] = true; });
      render(); return;
    }
    if (act === 'org-select-none') { S.selection = {}; render(); return; }
    /* 查重：勾选式删除 */
    if (act === 'dup-open-organize') { closeModal(); S.tab = 'organize'; S.organizeSub = 'dupe'; S.dupeSeeded = false; render(); return; }
    if (act === 'dup-select') { S.dupSel[el.getAttribute('data-id')] = el.checked; render(); return; }
    if (act === 'dupe-group-auto') { seedDupSel(); S.dupeSeeded = true; render(); toast('已按每组一条勾选其余账单', 'ok'); return; }
    if (act === 'dupe-select-none') { S.dupSel = {}; S.dupeSeeded = true; render(); return; }
    if (act === 'dupe-select-all') {
      Dedupe.findDuplicateGroups(allBills()).forEach(function (g) { g.bills.forEach(function (b) { S.dupSel[b.id] = true; }); });
      S.dupeSeeded = true; render(); toast('已勾选全部重复项', 'ok'); return;
    }
    if (act === 'dupe-delete') { confirmDelete(dupSelIds(), 'dup'); return; }
    /* 回收站 */
    if (act === 'trash-restore') {
      var trId = el.getAttribute('data-id');
      Store.restoreBills([trId]); toast('已从回收站恢复 1 条', 'ok'); render(); return;
    }
    if (act === 'trash-purge') {
      var pgId = el.getAttribute('data-id');
      openModal({ type: 'confirm', title: '彻底删除', text: '彻底删除后无法找回，确定吗？', okText: '彻底删除',
        onYes: function () { Store.purgeBills([pgId]); toast('已彻底删除 1 条', 'ok'); render(); } });
      return;
    }
    if (act === 'trash-restore-all') {
      var nAll = Store.getTrash().length;
      Store.restoreBills(Store.getTrash().map(function (b) { return b.id; }));
      toast('已恢复 ' + nAll + ' 条', 'ok'); render(); return;
    }
    if (act === 'trash-empty') {
      openModal({ type: 'confirm', title: '清空回收站', text: '将彻底删除回收站里的 ' + Store.getTrash().length + ' 条账单，无法找回。', okText: '清空',
        onYes: function () { var n2 = Store.emptyTrash(); toast('已清空回收站（' + n2 + ' 条）', 'ok'); render(); } });
      return;
    }
    if (act === 'dup-group-keep1' || act === 'dup-group-none' || act === 'dup-group-all') {
      var gk = el.getAttribute('data-key');
      var g2 = dupGroupByKey(gk);
      if (g2) {
        if (act === 'dup-group-none') g2.bills.forEach(function (b) { delete S.dupSel[b.id]; });
        else if (act === 'dup-group-all') g2.bills.forEach(function (b) { S.dupSel[b.id] = true; });
        else {
          var kE = pickDupKeep(g2.bills);
          g2.bills.forEach(function (b, i) { if (i === kE) delete S.dupSel[b.id]; else S.dupSel[b.id] = true; });
        }
      }
      S.dupeSeeded = true; render(); return;
    }
    if (act === 'dup-group-review') {
      var key = el.getAttribute('data-key');
      var g = Dedupe.findDuplicateGroups(allBills()).find(function (x) { return x.key === key; });
      if (g) { var others = g.bills.slice(1).map(function (b) { return b.id; }); Store.mark('标记重复账单'); Store.updateBills(others, { review: true, dupe: true }); toast('其余重复项已放入保留箱', 'ok'); }
      render(); return;
    }

    /* 分组 */
    if (act === 'group-create') { openModal({ type: 'group' }); return; }
    if (act === 'group-save') {
      var nm = (document.getElementById('g-name') || {}).value || '';
      if (!nm.trim()) { toast('请输入分组名', 'err'); return; }
      if (S.modal.group) Store.renameGroup(S.modal.group.id, nm.trim());
      else Store.createGroup(nm.trim());
      closeModal(); return;
    }
    if (act === 'group-rename') { openModal({ type: 'group', group: Store.getGroup(el.getAttribute('data-id')) }); return; }
    if (act === 'group-delete') { var gid = el.getAttribute('data-id'); Store.deleteGroup(gid); render(); return; }
    if (act === 'group-remove') { Store.updateBill(el.getAttribute('data-id'), { groupId: null }); render(); return; }
    if (act === 'group-select') {
      var gsid = el.getAttribute('data-id');
      if (S.selection[gsid]) delete S.selection[gsid]; else S.selection[gsid] = true;
      render(); return;
    }
    if (act === 'group-select-all') {
      var gaid = el.getAttribute('data-id');
      allBills().forEach(function (b) { if (b.groupId === gaid) S.selection[b.id] = true; });
      toast('已选中该分组全部账单，可用底部浮条批量删除 / 加标签 / 导出', 'ok'); render(); return;
    }
    if (act === 'group-select-none') { S.selection = {}; render(); return; }
    if (act === 'group-fold') {
      var gfold = el.getAttribute('data-id');
      S.groupFold = S.groupFold || {};
      S.groupFold[gfold] = !S.groupFold[gfold];
      render(); return;
    }
    if (act === 'group-fold-all') {
      S.groupFold = {};
      Store.state.groups.forEach(function (g) { S.groupFold[g.id] = true; });
      render(); return;
    }
    if (act === 'group-unfold-all') { S.groupFold = {}; render(); return; }
    if (act === 'group-copy') {
      var gid2 = (document.querySelector('[data-act="group-assign"]') || {}).value;
      if (!gid2) { toast('请先新建分组', 'err'); return; }
      copyToGroup(selectedIds(), gid2); return;
    }
    if (act === 'group-unassign') {
      var guIds = selectedIds();
      if (!guIds.length) { toast('先勾选要移出分组的账单', 'err'); return; }
      var inN = guIds.filter(function (i) { var b = Store.getBill(i); return b && b.groupId; }).length;
      if (!inN) { toast('勾选的账单本来就不在任何分组里', 'err'); return; }
      Store.updateBills(guIds, { groupId: null });
      toast('已把 ' + inN + ' 条移出分组', 'ok');
      S.selection = {}; render(); return;
    }

    /* 钱包 */
    if (act === 'wallet-new') { openModal({ type: 'wallet-edit', wallet: null }); return; }
    if (act === 'wallet-edit-one') {
      var weW = Store.getWallet(el.getAttribute('data-id'));
      if (weW) openModal({ type: 'wallet-edit', wallet: weW });
      return;
    }
    if (act === 'wallet-quick') {
      var qName = el.getAttribute('data-name') || '钱包';
      var exist = (Store.state.wallets || []).filter(function (x) { return x.name === qName; })[0];
      if (exist) { toast('已经有「' + qName + '」这个钱包了，下面就能看到它', 'err'); render(); return; }
      var qSrc = el.getAttribute('data-source');
      var madeW = Store.addWallet({
        name: qName, icon: el.getAttribute('data-icon') || '💳',
        kind: qSrc === 'bank' ? 'bank' : (qSrc === 'cash' ? 'cash' : 'platform'),
        init: '0', sources: qSrc ? [qSrc] : []
      });
      if (!madeW) { toast('添加失败：请按 Ctrl+F5 强制刷新页面后重试', 'err'); render(); return; }
      toast('已添加钱包「' + qName + '」' + (qSrc ? '，并关联了来源「' + srcName(qSrc) + '」' : ''), 'ok');
      render(); return;
    }
    if (act === 'wallet-save') {
      var wOld = S.modal && S.modal.wallet;
      var wnEl = document.getElementById('w-name');
      var wnVal = wnEl && wnEl.value ? wnEl.value.trim() : '';
      if (!wnVal) { toast('给钱包起个名字吧', 'err'); return; }
      var wIcoEl = document.getElementById('w-icon'), wKindEl = document.getElementById('w-kind'), wInitEl = document.getElementById('w-init');
      var wSrc = [], wCbs = document.querySelectorAll('.w-src-cb');
      for (var wci = 0; wci < wCbs.length; wci++) { if (wCbs[wci].checked) wSrc.push(wCbs[wci].value); }
      var wPatch = {
        name: wnVal,
        icon: (wIcoEl && wIcoEl.value.trim()) || '💳',
        kind: (wKindEl && wKindEl.value) || 'platform',
        init: (wInitEl && wInitEl.value) || '0',
        sources: wSrc
      };
      if (wOld) { Store.updateWallet(wOld.id, wPatch); toast('钱包已更新', 'ok'); }
      else { Store.addWallet(wPatch); toast('已添加钱包「' + wnVal + '」', 'ok'); }
      closeModal(); render(); return;
    }
    if (act === 'wallet-del') {
      var wdId = (S.modal && S.modal.wallet && S.modal.wallet.id) || el.getAttribute('data-id');
      var wdW = Store.getWallet(wdId);
      if (!wdW) return;
      openModal({
        type: 'confirm', title: '删除钱包', okText: '删除',
        text: '确定删除钱包「' + wdW.name + '」吗？账单不会被删，只是不再跟踪这张卡的余额。',
        onYes: function () { Store.removeWallet(wdW.id); toast('已删除钱包「' + wdW.name + '」', 'ok'); render(); }
      });
      return;
    }
    if (act === 'wallet-balance') {
      var wbW = Store.getWallet(el.getAttribute('data-id'));
      if (wbW) openModal({ type: 'wallet-balance', wallet: wbW });
      return;
    }
    if (act === 'wallet-balance-save') {
      var wbmW = S.modal && S.modal.wallet;
      if (!wbmW) return;
      var biEl = document.getElementById('w-bal-input');
      var biVal = biEl && biEl.value ? biEl.value.trim() : '';
      var biNum = Money.parse(biVal);
      if (biNum === null) { toast('请填一个正确的金额', 'err'); return; }
      Store.updateWallet(wbmW.id, { manual: Money.str(biNum) });
      toast('已把「' + wbmW.name + '」的余额记为手动值', 'ok');
      closeModal(); render(); return;
    }
    if (act === 'wallet-balance-clear') {
      var wbcW = (S.modal && S.modal.wallet) || Store.getWallet(el.getAttribute('data-id'));
      if (!wbcW) return;
      Store.updateWallet(wbcW.id, { manual: null });
      toast('已改回按账单自动算', 'ok');
      S.modal = null; render(); return;
    }
    if (act === 'wallet-transfer') { openModal({ type: 'wallet-transfer', from: el.getAttribute('data-id') || null }); return; }
    if (act === 'wallet-transfer-save') {
      var wtFrom = ((document.getElementById('wt-from') || {}).value) || '';
      var wtTo = ((document.getElementById('wt-to') || {}).value) || '';
      var wtAmt = ((document.getElementById('wt-amount') || {}).value) || '';
      var wtDate = ((document.getElementById('wt-date') || {}).value) || '';
      var wtNote = ((document.getElementById('wt-note') || {}).value) || '';
      if (!wtFrom || !wtTo) { toast('请选择转出和转入的钱包', 'err'); return; }
      if (wtFrom === wtTo) { toast('转出和转入不能是同一个钱包', 'err'); return; }
      var wtParsed = Money.parse(wtAmt);
      if (wtParsed === null || Money.abs(wtParsed) === 0n) { toast('请填一个大于 0 的金额', 'err'); return; }
      var madeT = Store.addTransfer({ from: wtFrom, to: wtTo, amount: wtAmt, date: wtDate, note: wtNote });
      if (!madeT) { toast('转账失败，请检查钱包和金额', 'err'); return; }
      var tfW = Store.getWallet(wtFrom), ttW = Store.getWallet(wtTo);
      toast('已转账 ¥' + fmt(madeT.amount) + '：' + (tfW ? tfW.name : '') + ' → ' + (ttW ? ttW.name : ''), 'ok');
      S.modal = null; render(); return;
    }
    if (act === 'wallet-transfer-del') {
      var wtD = el.getAttribute('data-id');
      var wtObj = Store.getTransfer(wtD);
      if (!wtObj) { render(); return; }
      var dwF = Store.getWallet(wtObj.from), dwT = Store.getWallet(wtObj.to);
      openModal({ type: 'confirm', title: '撤销转账', okText: '撤销',
        text: '撤销这笔 ¥' + fmt(wtObj.amount) + ' 的转账（' + (dwF ? dwF.name : '已删除') + ' → ' + (dwT ? dwT.name : '已删除') + '）？两个钱包的余额会恢复原样。',
        onYes: function () { Store.removeTransfer(wtD); toast('已撤销这笔转账', 'ok'); render(); } });
      return;
    }

    /* 导出 */
    if (act === 'export-scope') { S.exportScope = el.getAttribute('data-scope'); render(); return; }
    if (act === 'export-png') { doExportPng(false); return; }
    if (act === 'export-copy') { doExportPng(true); return; }
    if (act === 'export-csv') { exportCsv(); return; }

    /* 设置 / 备份 */
    if (act === 'backup-export') { Util.download('AQI的记账助手备份_' + Util.todayISO() + '.json', Store.exportJSON(), 'application/json'); toast('备份已导出', 'ok'); return; }
    if (act === 'backup-import') {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
      inp.onchange = function () {
        var f = inp.files[0]; if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          try {
            var mode = confirm('点「确定」= 合并到现有数据；点「取消」= 覆盖替换现有数据') ? 'merge' : 'replace';
            Store.importJSON(rd.result, mode);
            toast('备份导入成功', 'ok'); render();
          } catch (err) { toast('导入失败：' + err.message, 'err'); }
        };
        rd.readAsText(f);
      };
      inp.click(); return;
    }
    if (act === 'rule-add') {
      var w = (document.getElementById('rule-word') || {}).value || '';
      var c = (document.getElementById('rule-cat') || {}).value || 'other';
      if (!w.trim()) { toast('请输入关键词', 'err'); return; }
      Store.addRule(w.trim(), c); toast('规则已添加', 'ok'); render(); return;
    }
    if (act === 'rule-del') { Store.removeRule(parseInt(el.getAttribute('data-i'), 10)); render(); return; }
    if (act === 'rule-apply') { reclassifyAll(); return; }
    if (act === 'make-shortcut') { makeShortcut(); return; }
    if (act === 'reset-all') {
      openModal({ type: 'confirm', title: '清空全部数据', text: '将删除所有账单、分组和规则，且无法恢复。确定继续吗？', okText: '确定清空', onYes: function () { Store.reset(); toast('已清空', 'ok'); render(); } });
      return;
    }
  }

  function updateFloat() {
    var fb = document.querySelector('.floatbar');
    var html = floatBarHtml();
    if (fb) { if (html) fb.outerHTML = html; else fb.remove(); }
    else if (html) document.getElementById('app').insertAdjacentHTML('beforeend', html);
  }

  /* ------------------------------------------------------------ 具体动作 */
  function confirmDelete(ids, scope) {
    if (!ids.length) { toast('请先勾选要删除的账单', 'err'); return; }
    var isDup = scope === 'dup';
    var base = isDup ? '勾选的 ' + ids.length + ' 条重复账单' : '选中的 ' + ids.length + ' 条账单';
    var clearSel = function () {
      if (isDup) { ids.forEach(function (i) { delete S.dupSel[i]; }); S.dupeSeeded = true; }
      else { ids.forEach(function (i) { delete S.selection[i]; }); }
    };
    openModal({
      type: 'confirm', title: '移到回收站',
      text: '把' + base + '移到回收站？之后可在「整理 → 回收站」恢复。' + (isDup ? '每组未勾选的那条会保留。' : ''),
      okText: '移到回收站', altText: '彻底删除',
      onYes: function () {
        var n = Store.trashBills(ids); clearSel();
        toast('已移到回收站 ' + n + ' 条（整理 → 回收站 可恢复）', 'ok'); render();
      },
      onAlt: function () {
        Store.removeBills(ids); clearSel();
        toast('已彻底删除 ' + ids.length + ' 条', 'ok'); render();
      }
    });
  }

  function openBillModal(id) {
    var b = id ? Store.getBill(id) : null;
    openModal({ type: 'bill', bill: b });
  }
  function saveBillModal() {
    var g = function (i) { return (document.getElementById(i) || {}).value || ''; };
    var amount = g('m-amount');
    if (Money.parse(amount) === null) { toast('请输入正确的金额', 'err'); return; }
    var patch = {
      date: g('m-date'), time: g('m-time'), type: g('m-type'), amount: Money.str(Money.abs(Money.parse(amount))),
      item: g('m-item'), category: g('m-category'), source: g('m-source'), counterparty: g('m-counterparty'),
      groupId: g('m-group') || null, order: g('m-order'), note: g('m-note'), tags: parseTags(g('m-tags'))
    };
    if (S.modal.bill) Store.updateBill(S.modal.bill.id, patch);
    else { Store.mark('新增账单'); Store.addBills([Object.assign({ unsure: false, review: false, origin: 'manual', batchId: 'manual', tags: [] }, patch)]); }
    closeModal(); toast('已保存', 'ok');
  }

  function parseTags(s) {
    return Util.unique(String(s || '').split(/[,，、;；|\s]+/).map(function (x) { return x.replace(/^#/, '').trim(); }).filter(Boolean));
  }

  function applyTags(mode) {
    var input = document.getElementById('tag-input');
    var tags = parseTags(input ? input.value : '');
    var ids = selectedIds();
    if (!ids.length) { toast('请先勾选账单', 'err'); return; }
    if (!tags.length) { toast('请输入标签', 'err'); return; }
    if (mode === 'remove') { Store.removeTags(ids, tags); toast('已移除标签（' + ids.length + ' 条）', 'ok'); }
    else { Store.addTags(ids, tags); toast('已加标签：' + tags.join('、') + '（' + ids.length + ' 条）', 'ok'); }
    closeModal(); render();
  }

  function assignCategory(ids, catId) {
    if (!ids.length) { toast('请先勾选账单', 'err'); return; }
    Store.updateBills(ids, { category: catId });
    toast('已指派分类：' + cat(catId).name + '（' + ids.length + ' 条）', 'ok');
    S.selection = {};
    render();
  }

  /* 批量改分类（带「同步收支类型」「记住规则」选项） */
  function applyCategory(catId) {
    var ids = (S.modal && S.modal.ids && S.modal.ids.length) ? S.modal.ids : selectedIds();
    if (!ids.length) { toast('请先勾选账单', 'err'); return; }
    var fixEl = document.getElementById('cat-fixtype');
    var learnEl = document.getElementById('cat-learn');
    var fixType = !!(fixEl && fixEl.checked);
    var learn = !!(learnEl && learnEl.checked);

    Store.mark('批量改分类');
    var patchType = null;
    if (fixType) {
      if (Categorize.INCOME.some(function (c) { return c.id === catId; })) patchType = 'income';
      else if (Categorize.TRANSFER.some(function (c) { return c.id === catId; })) patchType = 'transfer';
      else if (Categorize.EXPENSE.some(function (c) { return c.id === catId; })) patchType = 'expense';
    }

    // 学习规则：取勾选账单里出现最多的「对方 / 项目」关键词
    var words = [];
    if (learn) {
      var freq = {};
      ids.forEach(function (id) {
        var b = Store.getBill(id);
        if (!b) return;
        [b.counterparty, b.item].forEach(function (w) {
          w = String(w || '').trim();
          if (!w || w.length > 12) return;
          freq[w] = (freq[w] || 0) + 1;
        });
      });
      words = Object.keys(freq).filter(function (w) { return freq[w] >= 2 || ids.length === 1; });
      words.slice(0, 5).forEach(function (w) {
        var dup = Store.state.customRules.some(function (r) { return r.word === w; });
        if (!dup) Store.addRule(w, catId, patchType || 'expense');
      });
    }

    ids.forEach(function (id) {
      var patch = { category: catId };
      if (patchType) patch.type = patchType;
      Store.updateBill(id, patch);
    });
    var msg = '已把 ' + ids.length + ' 条账单改成「' + cat(catId).name + '」';
    if (words.length) msg += '，并记住规则：' + words.slice(0, 5).join('、');
    toast(msg, 'ok');
    S.selection = {}; S.dupSel = {};
    closeModal(); render();
  }

  function assignGroup(ids, gid, copy) {
    if (!ids.length) { toast('请先勾选账单', 'err'); return; }
    Store.mark(copy ? '复制到分组' : '移入分组');
    if (copy) { copyToGroup(ids, gid); return; }
    Store.updateBills(ids, { groupId: gid });
    var gname = gid && Store.getGroup(gid) ? Store.getGroup(gid).name : '';
    toast(gid ? '已移入「' + gname + '」' : '已移出分组', 'ok');
    S.selection = {};
    render();
  }
  function copyToGroup(ids, gid) {
    if (!ids.length) { toast('请先勾选账单', 'err'); return; }
    var clones = ids.map(function (i) {
      var b = Store.getBill(i);
      return Object.assign({}, b, { id: Util.uid('bill'), groupId: gid, createdAt: Util.nowISO() });
    }).filter(Boolean);
    Store.addBills(clones);
    toast('已复制 ' + clones.length + ' 条到分组', 'ok');
    S.selection = {};
    render();
  }

  function copyCalc() {
    var text;
    if ((S.calcMode || 'step') === 'step') {
      var ta = document.getElementById('calc-expr-text');
      text = (ta && ta.value) || '';
      if (!text) { toast('算式还是空的，先点几条账单', 'err'); return; }
    } else {
      var list = targetBills();
      var lines = ['账单计算明细（共 ' + list.length + ' 条）'];
      list.forEach(function (b, i) {
        lines.push((i + 1) + '. ' + b.date + '  ' + b.item + '  ' + (b.type === 'income' ? '+' : b.type === 'transfer' ? '' : '-') + '¥' + fmt(b.amount));
      });
      var s = Filters.summary(list);
      lines.push('支出合计：¥' + fmt(s.expense));
      lines.push('收入合计：¥' + fmt(s.income));
      lines.push('净额：¥' + fmt(s.net));
      text = lines.join('\n');
    }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('已复制到剪贴板', 'ok'); }, function () { window.prompt('复制以下内容：', text); });
    else window.prompt('复制以下内容：', text);
  }

  function doExportPng(copy) {
    var scope = S.exportScope || (selectedIds().length ? 'selected' : 'filtered');
    var list = scope === 'all' ? allBills() : (scope === 'filtered' ? filtered() : selectedBills());
    if (!list.length) { toast('没有可导出的账单', 'err'); return; }
    var opts = {
      title: (document.getElementById('exp-title') || {}).value || '账单明细',
      subtitle: (document.getElementById('exp-sub') || {}).value || '',
      note: (document.getElementById('exp-note') || {}).value || '',
      style: S.exportStyle
    };
    var canvas = ExportImage.render(list, opts);
    if (copy) {
      ExportImage.copyToClipboard(canvas).then(function () { toast('图片已复制到剪贴板', 'ok'); }, function (e) { toast('复制失败，已改为下载', 'err'); ExportImage.download(canvas); });
    } else {
      ExportImage.download(canvas, (opts.title || '账单明细') + '_' + Util.todayISO() + '.png');
      toast('图片已开始下载', 'ok');
    }
  }

  function exportCsv() {
    var list = filtered();
    var head = ['日期', '时间', '类型', '分类', '项目', '对方', '来源', '金额', '单号', '备注'];
    var lines = [head.join(',')];
    list.forEach(function (b) {
      lines.push([b.date, b.time, typeName(b.type), cat(b.category).name, b.item, b.counterparty, srcName(b.source), Money.fmt(b.amount, { thousands: false }), b.order, b.note].map(function (v) {
        v = String(v == null ? '' : v).replace(/"/g, '""');
        return '"' + v + '"';
      }).join(','));
    });
    Util.download('账单导出_' + Util.todayISO() + '.csv', '\ufeff' + lines.join('\r\n'), 'text/csv');
    toast('CSV 已导出', 'ok');
  }

  function reclassifyAll() {
    var matcher = Categorize.buildMatcher(Store.state.customRules);
    var n = 0;
    allBills().forEach(function (b) {
      var r = Categorize.classify([b.item, b.counterparty, ''], matcher, b.type);
      if (r.cat !== b.category) { b.category = r.cat; n++; }
    });
    Store.save();
    toast('已重新分类 ' + n + ' 条', 'ok');
    render();
  }

  /* 快捷方式的图标路径：assets/AQI的记账助手.ico（Windows 绝对路径） */
  function icoPath() {
    try {
      if (location.protocol !== 'file:') return null;
      var p = decodeURIComponent(location.pathname || '');
      if (p.charAt(0) === '/') p = p.slice(1);
      p = p.replace(/[^\\/]*$/, '');              // 去掉 index.html，只留目录
      return p.replace(/\//g, '\\') + 'assets\\AQI的记账助手.ico';
    } catch (e) { return null; }
  }

  function makeShortcut() {
    var url = location.href;
    if (!/^file:/.test(url) && !/^https?:/.test(url)) { toast('无法生成快捷方式', 'err'); return; }
    var lines = ['[InternetShortcut]', 'URL=' + url, 'IconIndex=0'];
    var ico = icoPath();
    if (ico) lines.push('IconFile=' + ico);
    // .url 是 Windows INI 文件，带 UTF-8 BOM 才能正确读取中文路径
    var content = '\uFEFF' + lines.join('\r\n') + '\r\n';
    Util.download('AQI的记账助手.url', content, 'application/octet-stream');
    toast(ico
      ? '已生成「AQI的记账助手.url」（含图标），拖到桌面即可'
      : '已生成快捷方式文件，拖到桌面即可；若图标为空，请把 assets 目录里的 ico 一并放到项目内', 'ok');
  }

  function reloadSheet(idx) {
    if (!S.imp || !S.imp.fileBuffer) return;
    S.imp.sheetIndex = idx;
    Parse.parseFile(S.imp.fileName, S.imp.fileBuffer, { sheetIndex: idx }).then(function (t) {
      S.imp.table = t;
      S.imp.mapping = Parse.mapColumns(t.headers);
      S.imp.skipRows = {};
      render();
    }).catch(function (e) {
      toast('切换工作表失败：' + (e.message || e), 'err');
    });
  }

  /* ================================================================ 启动 */
  function boot() {
    Store.init();
    S.theme = readTheme();
    loadExclusions();
    try { document.documentElement.setAttribute('data-theme', S.theme); } catch (e) {}
    if (!Store.available) {
      console.warn('localStorage 不可用');
    }
    render();
    if (!Store.available) {
      setTimeout(function () { toast('⚠️ 本地存储不可用，数据不会自动保存，请务必在「导出」页备份！', 'err'); }, 600);
    }
    window.addEventListener('resize', Util.debounce(function () { if (S.tab === 'charts') drawChart(); }, 200));
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.modal) closeModal();
      if (e.key === 'Enter' && e.target && e.target.id) {
        var map = { 'rule-word': 'rule-add', 'mex-word': 'mex-add', 'tag-input': 'tags-apply' };
        var sel = map[e.target.id];
        if (sel) {
          var btn = document.querySelector('[data-act="' + sel + '"]');
          if (btn) { e.preventDefault(); btn.click(); }
        }
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.App = { S: S, render: render, toast: toast, setTheme: setTheme, readTheme: readTheme, applyCategory: applyCategory, renderLight: renderLight };
})();
