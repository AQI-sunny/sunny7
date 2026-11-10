/* ============================================================================
 * importer.js —— 把解析出来的表格行 -> 标准账单对象
 * 依赖：Parse / Money / Categorize / Util
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Importer = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function dep(name, path) {
    if (typeof window !== 'undefined' && window[name]) return window[name];
    if (typeof require !== 'undefined') return require(path);
    return null;
  }
  var Parse = dep('Parse', './parse.js');
  var Money = dep('Money', './money.js');
  var Categorize = dep('Categorize', './categorize.js');
  var Util = dep('Util', './util.js');

  /* 根据方向文本判定收支类型 */
  function directionToType(direction, typeRaw, amountRaw, guessFrom) {
    var d = String(direction || '').trim();
    if (/收入|收款|入账|进账|^收$/.test(d)) return 'income';
    if (/支出|付款|出账|^支$/.test(d)) return 'expense';
    if (/不计收支|转账|中性/.test(d)) return 'transfer';
    // 用交易类型/描述猜测
    var g = Categorize.guessType([typeRaw, guessFrom].filter(Boolean).join(' '));
    if (g === 'income' && Categorize.INCOME.concat(Categorize.TRANSFER).some(function (c) { return c.id === g; })) return g;
    if (g) return g;
    // 金额符号
    if (typeof amountRaw === 'string' && /^\s*-/.test(amountRaw)) return 'expense';
    return 'expense';
  }

  function pickAmount(ex, mapping, direction) {
    var inc = ex.incomeRaw, exp = ex.expenseRaw;
    var incN = inc !== '' ? Money.parse(inc) : null;
    var expN = exp !== '' ? Money.parse(exp) : null;
    if (incN !== null || expN !== null) {
      if (direction === 'income' && incN !== null) return incN;
      if (direction === 'expense' && expN !== null) return expN;
      // 兜底：哪列有值用哪列
      var v = expN !== null ? expN : incN;
      return v;
    }
    var a = Money.parse(ex.amountRaw);
    return a;
  }

  /* categoryHint（部分账单自带「分类」列）映射到内置分类 */
  function hintToCategory(hint) {
    if (!hint) return null;
    var h = String(hint).trim();
    var map = {
      '餐饮美食': 'food', '餐饮': 'food', '美食': 'food', '食品': 'food',
      '交通出行': 'transport', '交通': 'transport', '出行': 'transport',
      '购物消费': 'shopping', '购物': 'shopping', '网上购物': 'shopping',
      '服饰美容': 'clothing', '服饰': 'clothing', '美容': 'clothing',
      '居住物业': 'housing', '居住': 'housing', '房': 'housing',
      '生活服务': 'life', '生活缴费': 'life',
      '数码通讯': 'digital', '数码': 'digital', '通讯': 'digital',
      '医疗健康': 'medical', '医疗': 'medical', '健康': 'medical',
      '教育学习': 'education', '教育': 'education',
      '娱乐休闲': 'entertainment', '娱乐': 'entertainment',
      '旅行度假': 'travel', '旅行': 'travel', '旅游': 'travel',
      '人情往来': 'social', '人情': 'social',
      '金融保险': 'finance', '金融': 'finance', '保险': 'finance',
      '宠物': 'pet', '运动': 'sports', '母婴': 'baby', '烟酒': 'drink'
    };
    if (map[h]) return map[h];
    for (var k in map) if (h.indexOf(k) !== -1) return map[k];
    return null;
  }

  /* 平台/来源 → 兜底分类：只有当「说明 / 对方 / 类型」都没能判断出分类时才用，
   * 例如来源写「美团」的账单大多是吃饭，「京东 / 拼多多 / 淘宝」多为购物。 */
  var SOURCE_CATEGORY = {
    meituan: 'food', eleme: 'food',
    jd: 'shopping', pdd: 'shopping', taobao: 'shopping', douyin: 'shopping'
  };

  /**
   * @param {object} table  Parse.parseFile 的返回（或 parseFreeText 包装）
   * @param {object} opts   { source, matcher, mapping, defaultGroup, batchId, filename, forceType, skipRows }
   *                        skipRows: { [rowIndex]: true } —— 用户在预览里手动剔除的行（非账单行等）
   * @returns {{bills:Array, errors:Array, skipped:number}}
   */
  function buildBills(table, opts) {
    opts = opts || {};
    var matcher = opts.matcher || Categorize.buildMatcher([]);
    var mapping = opts.mapping || Parse.mapColumns(table.headers);
    var skipRows = opts.skipRows || {};
    var bills = [], errors = [], skipped = 0;
    var batchId = opts.batchId || Util.uid('batch');
    var source = opts.source || Parse.sniffSource(table.headers, table.fileName);

    table.rows.forEach(function (row, ri) {
      if (skipRows[ri]) { skipped++; return; }
      var ex;
      if (table.freeText) {
        // 自由文本行结构固定为 [日期, 金额, 说明]
        var nd = Parse.normalizeDate(row[0]);
        ex = { date: nd ? nd.date : null, time: nd && nd.time ? nd.time : null, amountRaw: row[1], direction: '', typeRaw: '', desc: row[2] || '', counterparty: '', categoryHint: '', payment: '', status: '', order: '', note: '', incomeRaw: '', expenseRaw: '' };
      } else {
        ex = Parse.extractRow(row, mapping);
      }
      if (!ex.date && !ex.amountRaw && !ex.incomeRaw && !ex.expenseRaw) { skipped++; return; }

      var textAll = [ex.desc, ex.counterparty, ex.typeRaw, ex.note].filter(Boolean).join(' ');
      var type = opts.forceType || directionToType(ex.direction, ex.typeRaw, ex.amountRaw || ex.expenseRaw || ex.incomeRaw, textAll);
      var amt = pickAmount(ex, mapping, type);
      if (amt === null) { errors.push({ row: ri + 1, reason: '无法解析金额: ' + (ex.amountRaw || ex.incomeRaw || ex.expenseRaw), raw: row }); skipped++; return; }
      var amount = Money.str(Money.abs(amt));

      // 逐行来源：优先用「来源/平台」列里的值，其次用整张表的来源
      var rowSource = (ex.sourceRaw ? Parse.normalizeSource(ex.sourceRaw) : null) || source;

      var category = hintToCategory(ex.categoryHint);
      if (!category) {
        var res = Categorize.classify([ex.desc, ex.counterparty, ex.typeRaw], matcher, type);
        category = res.cat;
        // 文本没能判断出来（落到「其他」）时，用来源平台兜底
        if (type === 'expense' && (category === 'other' || category === 'other_in') && SOURCE_CATEGORY[rowSource]) {
          category = SOURCE_CATEGORY[rowSource];
        }
      }
      // 类型与分类修正：收入分类落到支出分类时纠正
      var catObj = Categorize.getCategory(category);
      var isIncomeCat = Categorize.INCOME.some(function (c) { return c.id === category; });
      var isTransferCat = Categorize.TRANSFER.some(function (c) { return c.id === category; });
      if (isTransferCat) type = 'transfer';
      else if (type === 'income' && !isIncomeCat && Categorize.EXPENSE.some(function (c) { return c.id === category; })) {
        // 收入但分类是支出的（如「红包」既可能是收也可能是支）→ 按类型归位
        category = 'other_in';
      } else if (type === 'expense' && isIncomeCat && category !== 'refund') {
        // 保持原分类（如「退款」可能出现在不同方向），其余归到其他支出
        if (['transfer_in'].indexOf(category) !== -1) category = 'transfer';
      }

      var item = ex.desc || ex.typeRaw || ex.counterparty || catObj.name || '未命名';
      var bill = {
        id: Util.uid('bill'),
        date: ex.date || '',
        time: ex.time || '',
        amount: amount,
        type: type,
        category: category,
        item: item,
        counterparty: ex.counterparty || '',
        source: rowSource,
        sourceRaw: ex.sourceRaw || '',
        payment: ex.payment || '',
        status: ex.status || '',
        order: ex.order || '',
        note: ex.note || '',
        groupId: opts.defaultGroup || null,
        unsure: false,
        review: false,
        origin: 'import',
        batchId: batchId,
        createdAt: Util.nowISO()
      };
      bills.push(bill);
    });

    return { bills: bills, errors: errors, skipped: skipped, count: bills.length, batchId: batchId, source: source };
  }

  return { buildBills: buildBills, directionToType: directionToType, hintToCategory: hintToCategory };
});
