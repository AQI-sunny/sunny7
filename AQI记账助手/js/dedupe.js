/* ============================================================================
 * dedupe.js —— 重复账单检测
 * 判定规则：日期 + 具体项(归一化) + 金额 一致（可选是否区分来源/收支类型）
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Dedupe = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function dep(name, path) {
    if (typeof window !== 'undefined' && window[name]) return window[name];
    if (typeof require !== 'undefined') return require(path);
    return null;
  }
  var Util = dep('Util', './util.js');
  var Money = dep('Money', './money.js');

  /* 基础键：日期 + 金额 + 项目（仅在「没有单号」时作为启发式依据） */
  function baseKeyOf(bill, opts) {
    opts = opts || {};
    var parts = [
      bill.date || '',
      Money.str(Money.parse(bill.amount) || 0n),
      Util.normItem(bill.item || bill.counterparty || '')
    ];
    if (opts.byType) parts.push(bill.type || '');
    if (opts.bySource) parts.push(bill.source || '');
    return parts.join('|');
  }
  function keyOf(bill, opts) { return baseKeyOf(bill, opts); }

  function makeGroup(key, list) {
    return {
      key: key,
      ids: list.map(function (b) { return b.id; }),
      bills: list,
      sample: list[0],
      count: list.length
    };
  }

  /* 重复判定规则（关键）：
   *   1) 双方都有「单号」且完全相同 → 同一笔交易，判为重复；
   *   2) 双方单号不同 → 视为两笔不同交易，绝不判为重复；
   *   3) 只有「没有单号」的账单之间，才退回「日期 + 金额 + 项目」启发式判断。
   *   也就是说：单号不一样，永远不会被判成重复。 */
  function findDuplicateGroups(bills, opts) {
    opts = opts || {};
    var groups = [];

    // 第一轮：相同且非空的单号 → 确定是同一笔交易
    var byOrder = {}, orderSeq = [];
    (bills || []).forEach(function (b) {
      var o = String(b.order || '').trim();
      if (!o) return;
      if (!byOrder[o]) { byOrder[o] = []; orderSeq.push(o); }
      byOrder[o].push(b);
    });
    orderSeq.forEach(function (o) {
      if (byOrder[o].length >= 2) groups.push(makeGroup('order|' + o, byOrder[o]));
    });

    // 第二轮：没有单号的账单，才按 日期 + 金额 + 项目 启发式
    var byBase = {}, baseSeq = [];
    (bills || []).forEach(function (b) {
      if (String(b.order || '').trim()) return;
      var bk = baseKeyOf(b, opts);
      if (!byBase[bk]) { byBase[bk] = []; baseSeq.push(bk); }
      byBase[bk].push(b);
    });
    baseSeq.forEach(function (bk) {
      if (byBase[bk].length >= 2) groups.push(makeGroup('base|' + bk, byBase[bk]));
    });

    return groups;
  }

  /* 只找出「新导入账单」与「已有账单/同批」的重复，避免每次全表扫描 */
  function findDuplicatesFor(newBills, allBills, opts) {
    var groups = findDuplicateGroups(allBills, opts);
    var newIds = {};
    (newBills || []).forEach(function (b) { newIds[b.id] = 1; });
    return groups.filter(function (g) {
      return g.ids.some(function (id) { return newIds[id]; });
    });
  }

  function stats(bills, opts) {
    var all = findDuplicateGroups(bills, opts);
    var dupCount = 0, dupIds = {};
    all.forEach(function (g) { dupCount += g.count - 1; g.ids.forEach(function (id) { dupIds[id] = 1; }); });
    return { groups: all.length, extraDuplicates: dupCount, dupIds: dupIds };
  }

  return { keyOf: keyOf, findDuplicateGroups: findDuplicateGroups, findDuplicatesFor: findDuplicatesFor, stats: stats };
});
