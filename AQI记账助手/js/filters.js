/* ============================================================================
 * filters.js —— 多维筛选 + 精确汇总统计
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Filters = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function dep(name, path) {
    if (typeof window !== 'undefined' && window[name]) return window[name];
    if (typeof require !== 'undefined') return require(path);
    return null;
  }
  var Util = dep('Util', './util.js');
  var Money = dep('Money', './money.js');

  var NONE = '__none__';

  /* 商户/对方：优先取「交易对方」，没有就用「项目名」兜底 */
  function merchantOf(b) {
    if (!b) return '';
    var cp = b.counterparty ? String(b.counterparty).trim() : '';
    if (cp) return cp;
    return b.item ? String(b.item) : '';
  }

  function apply(bills, f) {
    f = f || {};
    var kw = (f.keyword || '').trim().toLowerCase();
    var min = f.amountMin !== undefined && f.amountMin !== '' && f.amountMin !== null ? Money.parse(f.amountMin) : null;
    var max = f.amountMax !== undefined && f.amountMax !== '' && f.amountMax !== null ? Money.parse(f.amountMax) : null;
    var idSet = f.ids && f.ids.length ? (function () { var s = {}; f.ids.forEach(function (i) { s[i] = 1; }); return s; })() : null;

    return (bills || []).filter(function (b) {
      if (idSet && !idSet[b.id]) return false;
      if (f.dateFrom && b.date && b.date < f.dateFrom) return false;
      if (f.dateTo && b.date && b.date > f.dateTo) return false;
      if (f.months && f.months.length && f.months.indexOf(Util.monthOf(b.date)) === -1) return false;
      if (f.years && f.years.length && f.years.indexOf(Util.yearOf(b.date)) === -1) return false;
      if (f.types && f.types.length && f.types.indexOf(b.type) === -1) return false;
      if (f.categories && f.categories.length && f.categories.indexOf(b.category) === -1) return false;
      /* 快捷剔除：被剔除的分类整类不看（含统计/图表/合计） */
      if (f.excludeCategories && f.excludeCategories.length && f.excludeCategories.indexOf(b.category) !== -1) return false;
      if (f.sources && f.sources.length && f.sources.indexOf(b.source) === -1) return false;
      if (f.excludeSources && f.excludeSources.length && f.excludeSources.indexOf(b.source) !== -1) return false;
      if (f.counterparties && f.counterparties.length && f.counterparties.indexOf(merchantOf(b)) === -1) return false;
      if (f.excludeCounterparties && f.excludeCounterparties.length && f.excludeCounterparties.indexOf(merchantOf(b)) !== -1) return false;
      if (f.items && f.items.length && f.items.indexOf(b.item || '') === -1) return false;
      if (f.weekdays && f.weekdays.length) {
        var wd = Util.weekday(b.date);
        if (f.weekdays.indexOf(wd) === -1) return false;
      }
      if (f.groups && f.groups.length) {
        var gid = b.groupId || NONE;
        if (f.groups.indexOf(gid) === -1) return false;
      }
      if (f.excludeGroups && f.excludeGroups.length && f.excludeGroups.indexOf(b.groupId || NONE) !== -1) return false;
      if (f.tags && f.tags.length) {
        var tags = b.tags || [];
        if (!f.tags.some(function (t) { return tags.indexOf(t) !== -1; })) return false;
      }
      if (f.flag && f.flag !== 'all') {
        if (f.flag === 'unsure' && !b.unsure) return false;
        if (f.flag === 'review' && !b.review) return false;
        if (f.flag === 'dupe' && !b.dupe) return false;
        if (f.flag === 'normal' && (b.unsure || b.review || b.dupe)) return false;
      }
      if (f.payment && f.payment.length && f.payment.indexOf(b.payment) === -1) return false;
      var amt = Money.parse(b.amount) || 0n;
      if (min !== null && Money.cmp(amt, min) < 0) return false;
      if (max !== null && Money.cmp(amt, max) > 0) return false;
      if (kw) {
        var hay = [b.item, b.counterparty, b.note, b.order, b.payment, b.status, b.category].join(' ').toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });
  }

  function sumByType(bills, type) {
    var t = 0n;
    bills.forEach(function (b) { if (b.type === type) t += Money.parse(b.amount) || 0n; });
    return t;
  }

  function summary(bills) {
    bills = bills || [];
    var income = sumByType(bills, 'income');
    var expense = sumByType(bills, 'expense');
    var transfer = sumByType(bills, 'transfer');
    return {
      count: bills.length,
      income: Money.str(income),
      expense: Money.str(expense),
      transfer: Money.str(transfer),
      net: Money.str(Money.sub(income, expense)),
      incomeBig: income, expenseBig: expense, transferBig: transfer,
      avgExpense: bills.filter(function (b) { return b.type === 'expense'; }).length
        ? Money.str(Money.div(expense, bills.filter(function (b) { return b.type === 'expense'; }).length, 'floor'))
        : '0'
    };
  }

  /* 分组统计：返回 [{key, label, amountBig, amount, count, pct}]，已按金额降序 */
  function groupStat(bills, keyFn, typeFilter) {
    var acc = {};
    bills.forEach(function (b) {
      if (typeFilter && b.type !== typeFilter) return;
      var k = keyFn(b);
      if (!acc[k]) acc[k] = { key: k, amountBig: 0n, count: 0 };
      acc[k].amountBig += Money.parse(b.amount) || 0n;
      acc[k].count++;
    });
    var list = Object.keys(acc).map(function (k) { return acc[k]; });
    list.sort(function (a, b) { return a.amountBig < b.amountBig ? 1 : (a.amountBig > b.amountBig ? -1 : 0); });
    var total = 0n;
    list.forEach(function (x) { total += x.amountBig; });
    list.forEach(function (x) {
      x.amount = Money.str(x.amountBig);
      x.pct = total === 0n ? '0' : (Number(x.amountBig) * 100 / Number(total)).toFixed(1);
    });
    return { list: list, total: Money.str(total), totalBig: total };
  }

  function byCategory(bills, typeFilter) { return groupStat(bills, function (b) { return b.category; }, typeFilter); }
  function bySource(bills, typeFilter) { return groupStat(bills, function (b) { return b.source; }, typeFilter); }
  function byMonth(bills, typeFilter) { return groupStat(bills, function (b) { return Util.monthOf(b.date) || '未知'; }, typeFilter); }
  function byGroup(bills, typeFilter) { return groupStat(bills, function (b) { return b.groupId || NONE; }, typeFilter); }
  function byType(bills) { return groupStat(bills, function (b) { return b.type; }); }
  function byWeekday(bills, typeFilter) { return groupStat(bills, function (b) { return Util.weekday(b.date) || '未知'; }, typeFilter); }
  function byDay(bills, typeFilter) { return groupStat(bills, function (b) { return b.date || '未知'; }, typeFilter); }
  function byMerchant(bills, typeFilter) { return groupStat(bills, merchantOf, typeFilter); }
  function byItem(bills, typeFilter) { return groupStat(bills, function (b) { return b.item || '（无项目）'; }, typeFilter); }

  function distinct(bills, keyFn) {
    return Util.unique(bills.map(keyFn).filter(function (x) { return x !== undefined && x !== null && x !== ''; })).sort();
  }

  return {
    NONE: NONE,
    apply: apply,
    merchantOf: merchantOf,
    summary: summary,
    groupStat: groupStat,
    byCategory: byCategory,
    bySource: bySource,
    byMonth: byMonth,
    byGroup: byGroup,
    byType: byType,
    byWeekday: byWeekday,
    byDay: byDay,
    byMerchant: byMerchant,
    byItem: byItem,
    distinct: distinct
  };
});
