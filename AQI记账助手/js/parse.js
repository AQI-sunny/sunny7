/* ============================================================================
 * parse.js —— 账单文件解析
 *  · txt / csv / tsv：自动识别编码(UTF-8/GBK)、分隔符、表头行、自由文本
 *  · xlsx：纯 JS 解析 zip（DecompressionStream('deflate-raw')）+ XML，
 *          无需任何第三方库，完全离线可用
 * 命名空间：window.Parse / module.exports
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Parse = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ==================================================================== 编码 */
  function decodeBytes(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    // UTF-8 BOM
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
    }
    // UTF-16 BOM
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
    // 先严格 UTF-8，失败再退回 GBK（支付宝/微信老导出常见）
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
    } catch (e) {
      try { return { text: new TextDecoder('gbk').decode(bytes), encoding: 'gbk' }; }
      catch (e2) { return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8(lossy)' }; }
    }
  }

  /* ============================================================ 分隔符识别 */
  function sniffDelimiter(text) {
    var sample = text.split(/\r?\n/).slice(0, 30).join('\n');
    var cands = [
      { d: '\t', name: 'tab' },
      { d: ',', name: 'comma' },
      { d: ';', name: 'semicolon' },
      { d: '|', name: 'pipe' }
    ];
    var best = { d: ',', name: 'comma', score: -1 };
    cands.forEach(function (c) {
      var lines = sample.split('\n').filter(function (l) { return l.indexOf(c.d) !== -1; });
      if (!lines.length) return;
      // 每行字段数的一致性越高越好
      var counts = lines.map(function (l) { return l.split(c.d).length; });
      var max = Math.max.apply(null, counts);
      var same = counts.filter(function (n) { return n === max; }).length;
      var score = max * 10 + same;
      if (score > best.score) best = { d: c.d, name: c.name, score: score };
    });
    return best.d;
  }

  /* ============================================================== CSV 解析 */
  function parseCSVLine(line, delim) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === delim) { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  /* 文本 -> 二维数组 */
  function parseDelimited(text, delim) {
    delim = delim || sniffDelimiter(text);
    var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var rows = [];
    var buf = '', inQ = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // 合并跨行引号
      if (inQ) { buf += '\n' + line; }
      else buf = line;
      var q = 0;
      for (var j = 0; j < buf.length; j++) if (buf[j] === '"') q++;
      inQ = (q % 2 === 1);
      if (inQ) continue;
      if (buf.trim() === '') { buf = ''; continue; }
      rows.push(parseCSVLine(buf, delim));
      buf = '';
    }
    if (buf.trim() !== '') rows.push(parseCSVLine(buf, delim));
    return rows;
  }

  /* ============================================================== 表头识别 */
  var HEADER_HINTS = ['交易时间', '交易日期', '创建时间', '付款时间', '最近修改时间', '记账日期', '日期', '时间',
    '金额', '发生额', '收支金额', '收/支', '收支', '收入', '支出', '交易对方', '对方', '商户', '商品说明', '商品名称',
    '商品', '交易说明', '交易类型', '类型', '摘要', '备注', '说明', '事项', '分类', '类别', '交易单号', '交易号',
    '订单号', '商户单号', '支付方式', '收付款方式', '当前状态', '交易状态', '状态', '资金来源', '资金状态',
    // 自己整理的 txt 常见表头
    '来源', '平台', '渠道', '项目', '标签', '账号', 'App'];

  function findHeaderRow(rows) {
    var best = { index: -1, score: 0 };
    var limit = Math.min(rows.length, 40);
    for (var i = 0; i < limit; i++) {
      var cells = rows[i], score = 0, hasAmount = false, looksData = false;
      for (var j = 0; j < cells.length; j++) {
        var c = (cells[j] || '').replace(/\s/g, '');
        if (!c) continue;
        for (var k = 0; k < HEADER_HINTS.length; k++) {
          if (c.indexOf(HEADER_HINTS[k]) !== -1) { score++; break; }
        }
        if (/金额|发生额|收入|支出|收\/支|元/.test(c)) hasAmount = true;
        // 表头行里不该出现「日期」「纯数字金额」这类数据
        if (/^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/.test(c)) looksData = true;
        if (/^-?\d+(\.\d+)?$/.test(c)) looksData = true;
      }
      if (looksData) continue;
      // 自己做的简表可能只有「日期 / 金额 / 项目 / 来源」这种很少的列，
      // 只要认出「金额」列 + 再认出至少 2 个表头词，就当表头行
      var ok = hasAmount && score >= 2 && cells.length >= 2;
      if (!ok && score >= 4 && cells.length >= 3) ok = true;
      if (ok) {
        if (score > best.score) best = { index: i, score: score };
      }
    }
    return best.index;
  }

  /* ============================================== 表头 -> 列映射（列索引） */
  function idx(headers, patterns, excludes) {
    // 模式按优先级排列：对每个模式先精确匹配，再包含匹配，命中即返回
    for (var p = 0; p < patterns.length; p++) {
      for (var i = 0; i < headers.length; i++) {
        var h = (headers[i] || '').replace(/\s/g, '');
        if (!h) continue;
        if (excludes && excludes.some(function (e) { return h.indexOf(e) !== -1; })) continue;
        if (h === patterns[p]) return i;
      }
      for (var i2 = 0; i2 < headers.length; i2++) {
        var h2 = (headers[i2] || '').replace(/\s/g, '');
        if (!h2) continue;
        if (excludes && excludes.some(function (e) { return h2.indexOf(e) !== -1; })) continue;
        if (h2.indexOf(patterns[p]) !== -1) return i2;
      }
    }
    return -1;
  }

  function mapColumns(headers) {
    headers = headers || [];
    var m = {};
    m.direction = idx(headers, ['收/支', '收支', '收支类型', '资金方向', '交易方向'], ['支出金额', '收入金额']);
    m.amount = idx(headers, ['金额(元)', '金额（元）', '交易金额', '发生额', '金额', '收支金额', '交易额'], ['收入', '支出', '手续费', '退款', '余额', '优惠']);
    m.income = idx(headers, ['收入(元)', '收入（元）', '收入金额', '收入']);
    m.expense = idx(headers, ['支出(元)', '支出（元）', '支出金额', '支出']);
    m.date = idx(headers, ['交易时间', '交易日期', '创建时间', '付款时间', '记账日期', '日期', '时间']);
    m.time = -1;
    m.typeRaw = idx(headers, ['交易类型', '消费类型', '类型', '交易类别']);
    m.desc = idx(headers, ['商品说明', '商品名称', '商品', '交易说明', '摘要', '说明', '事项', '交易摘要', '项目名称', '消费项目', '项目']);
    m.counterparty = idx(headers, ['交易对方', '对方', '商户名称', '商户', '收款方', '付款方', '对方账户']);
    m.category = idx(headers, ['账单分类', '消费分类', '分类', '类别']);
    m.payment = idx(headers, ['收/付款方式', '支付方式', '付款方式', '收付款方式']);
    m.status = idx(headers, ['当前状态', '交易状态', '状态']);
    m.order = idx(headers, ['交易单号', '交易号', '订单号', '商户单号', '流水号', '单号']);
    m.note = idx(headers, ['备注']);
    // 来源/平台列（自己做的 txt 常会写「来源」或「平台」）
    m.source = idx(
      headers,
      ['账单来源', '数据来源', '来源平台', '交易平台', '支付渠道', '来源渠道', '来源', '平台', '渠道', 'App'],
      ['支付方式', '收/付款方式', '付款方式', '优惠', '折扣', '红包', '平台优惠']
    );
    // 日期与时间分离的情况
    if (m.date === -1) m.date = idx(headers, ['时间']);
    // 单独的时间列（只放 时分秒，与日期列分开）——保证导入后仍能看到时分秒
    headers.forEach(function (h, i) {
      if (m.time !== -1 || i === m.date) return;
      var t = String(h).replace(/\s/g, '');
      if (t === '交易时刻' || t === '交易时分' || t === '时刻' || t === '时分秒') m.time = i;
      else if (t === '时间') m.time = i;
    });
    // 若时间与日期同一列且该列含「时间」，尝试找单独的日期列
    return m;
  }

  /* ============================================================== 来源识别 */
  function sniffSource(headers, filename) {
    var all = (headers || []).join(',') + ',' + (filename || '');
    var has = function (re) { return re.test(all); };
    if (has(/交易单号/) && has(/交易类型/) && has(/当前状态|交易状态/)) return 'wechat';
    if (has(/交易号/) && (has(/商品名称/) || has(/商品说明/)) && has(/收\/支/)) return 'alipay';
    if (has(/商户单号/) && has(/交易对方/)) return 'wechat';
    if (has(/支付宝/)) return 'alipay';
    if (has(/微信/)) return 'wechat';
    if (has(/银行|储蓄卡|信用卡|借记卡|账户/)) return 'bank';
    if (has(/京东/)) return 'jd';
    if (has(/美团/)) return 'meituan';
    if (has(/抖音/)) return 'douyin';
    if (has(/拼多多/)) return 'pdd';
    if (has(/淘宝|天猫/)) return 'taobao';
    if (has(/饿了么/)) return 'eleme';
    if (filename) {
      if (/支付宝/.test(filename)) return 'alipay';
      if (/微信/.test(filename)) return 'wechat';
      if (/银行|招商|工商|建设|农业|中国|交通/.test(filename)) return 'bank';
      if (/美团/.test(filename)) return 'meituan';
      if (/抖音/.test(filename)) return 'douyin';
      if (/拼多多/.test(filename)) return 'pdd';
    }
    return 'generic';
  }

  var SOURCE_LABELS = {
    alipay: '支付宝', wechat: '微信', bank: '银行', jd: '京东', meituan: '美团',
    douyin: '抖音', pdd: '拼多多', taobao: '淘宝/天猫', eleme: '饿了么', cash: '现金',
    generic: '通用/其他', manual: '手动录入'
  };

  /* 把我们支持的来源按顺序列出（界面下拉框用），保证顺序稳定 */
  var SOURCE_KEYS_ORDER = ['alipay', 'wechat', 'meituan', 'douyin', 'pdd', 'taobao', 'eleme', 'jd', 'bank', 'cash', 'generic', 'manual'];

  /* 平台/来源文本 → 内部来源 id（识别不了返回 null）
   * 用于「自己写的 txt 里有来源列」的情况：逐行识别来源并自动分类。 */
  var SOURCE_RULES = [
    [/支付宝|alipay/i, 'alipay'],
    [/微信|wechat|weixin|零钱/i, 'wechat'],
    [/美团|meituan|点评|大众点评|外卖/i, 'meituan'],
    [/抖音|douyin|字节|tiktok/i, 'douyin'],
    [/拼多多|pinduoduo|pdd|多多/i, 'pdd'],
    [/淘宝|天猫|taobao|tmall|淘系/i, 'taobao'],
    [/饿了么|eleme|饿了吗/i, 'eleme'],
    [/京东|jingdong|jd\.com|^jd$/i, 'jd'],
    [/银行|储蓄卡|信用卡|借记卡|银联|账户|bank|招商|工商|建设|农业|交通银行|中国银行|邮政/i, 'bank'],
    [/现金|cash/i, 'cash'],
    [/手动|手工|手写|manual/i, 'manual'],
    [/其他|通用|未知|other|generic/i, 'generic']
  ];

  function normalizeSource(v) {
    var s = String(v === null || v === undefined ? '' : v).trim();
    if (!s) return null;
    if (SOURCE_LABELS[s]) return s;                 // 已经是内部 id
    for (var i = 0; i < SOURCE_RULES.length; i++) {
      if (SOURCE_RULES[i][0].test(s)) return SOURCE_RULES[i][1];
    }
    return null;
  }

  /* ============================================================ 日期/时间 */
  function pad2(n) { return String(n).padStart(2, '0'); }

  function normalizeDate(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    if (!s) return null;
    // Excel 序列号（1900 日期系统）
    if (/^\d+(\.\d+)?$/.test(s)) {
      var num = parseFloat(s);
      if (num > 20000 && num < 80000) { // 约 1954 ~ 2119 年之间才认为是日期序列号
        var days = Math.floor(num);
        var ms = Date.UTC(1899, 11, 30) + days * 86400000;
        var d = new Date(ms);
        return { date: d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()), time: null };
      }
      // 20240105
      if (/^\d{8}$/.test(s)) return { date: s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8), time: null };
      return null;
    }
    var mm = s.match(/^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (mm) {
      var date = mm[1] + '-' + pad2(mm[2]) + '-' + pad2(mm[3]);
      var time = mm[4] !== undefined ? pad2(mm[4]) + ':' + pad2(mm[5]) + (mm[6] ? ':' + mm[6] : '') : null;
      return { date: date, time: time };
    }
    // 01/05/2024 (部分银行导出) —— 带时间
    var m2 = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m2) {
      var date2 = m2[3] + '-' + pad2(m2[1]) + '-' + pad2(m2[2]);
      var time2 = m2[4] !== undefined ? pad2(m2[4]) + ':' + pad2(m2[5]) + (m2[6] ? ':' + m2[6] : '') : null;
      return { date: date2, time: time2 };
    }
    return null;
  }

  function normalizeTime(v) {
    if (!v) return null;
    var s = String(v).trim();
    var m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return pad2(m[1]) + ':' + pad2(m[2]) + (m[3] ? ':' + m[3] : '');
  }

  /* ========================================================== 行 -> 原始字段 */
  function cell(row, i) {
    if (i === undefined || i === null || i < 0) return '';
    var v = row[i];
    return v === undefined || v === null ? '' : String(v).trim();
  }

  function extractRow(row, mapping) {
    var dateRaw = cell(row, mapping.date);
    var nd = normalizeDate(dateRaw);
    var time = normalizeTime(dateRaw) || normalizeTime(cell(row, mapping.time));
    var out = {
      date: nd ? nd.date : null,
      dateRaw: dateRaw,
      time: nd && nd.time ? nd.time : time,
      direction: cell(row, mapping.direction),
      amountRaw: cell(row, mapping.amount),
      incomeRaw: cell(row, mapping.income),
      expenseRaw: cell(row, mapping.expense),
      typeRaw: cell(row, mapping.typeRaw),
      desc: cell(row, mapping.desc),
      counterparty: cell(row, mapping.counterparty),
      categoryHint: cell(row, mapping.category),
      payment: cell(row, mapping.payment),
      status: cell(row, mapping.status),
      order: cell(row, mapping.order),
      note: cell(row, mapping.note),
      sourceRaw: cell(row, mapping.source)
    };
    return out;
  }

  /* ============================================================ 自由文本兜底 */
  var AMOUNT_RE = /-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/;
  var DATE_RE = /(\d{4}[-\/.年]\d{1,2}[-\/.月]\d{1,2}日?(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?)|(\d{1,2}[-\/]\d{1,2}[-\/]\d{4}(?:\s*\d{1,2}:\d{2})?)/;

  function parseFreeText(text) {
    var lines = text.replace(/\r\n/g, '\n').split('\n');
    var rows = [];
    lines.forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      var dm = t.match(DATE_RE);
      if (!dm) return; // 没日期不当账单
      var rest = t.replace(dm[0], ' ');
      var ams = rest.match(/-?\d+(?:,\d{3})*(?:\.\d+)?/g);
      if (!ams || !ams.length) return;
      var amount = ams[ams.length - 1]; // 取最后一个数字当作金额
      var desc = rest.replace(amount, ' ').replace(/[¥￥,，\s]+/g, ' ').trim();
      rows.push([dm[0], amount, desc]);
    });
    return { headers: ['日期', '金额', '说明'], rows: rows, freeText: true };
  }

  /* ================================================================ XLSX */
  function utf8(bytes) { return new TextDecoder('utf-8').decode(bytes); }

  function readU16(view, p) { return view.getUint16(p, true); }
  function readU32(view, p) { return view.getUint32(p, true); }

  function xmlDecode(s) {
    return s.replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  function isDateFmtCode(code) {
    if (!code) return false;
    var c = code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').replace(/\\./g, '');
    return /[yYdD]/.test(c) || /(?<![a-zA-Z])[mM](?![a-zA-Z])/.test(c) || /h{1,2}:/.test(c);
  }

  function colToIndex(ref) {
    var m = String(ref).match(/^([A-Za-z]+)/);
    if (!m) return -1;
    var s = m[1].toUpperCase(), n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }

  function attrs(tag) {
    var o = {}, re = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g, m;
    while ((m = re.exec(tag))) o[m[1]] = m[2];
    return o;
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    var out = [], re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g, m;
    while ((m = re.exec(xml))) {
      var inner = m[1] || '';
      var texts = [], tre = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g, tm;
      while ((tm = tre.exec(inner))) texts.push(xmlDecode(tm[1] || ''));
      out.push(texts.join(''));
    }
    return out;
  }

  function parseStyles(xml) {
    var dateStyles = {}; // styleIndex -> true
    if (!xml) return dateStyles;
    var custom = {};
    var nfRe = /<numFmt\b[^>]*\/>/g, nm;
    while ((nm = nfRe.exec(xml))) {
      var a = attrs(nm[0]);
      custom[a.numFmtId] = a.formatCode;
    }
    var builtinDate = { 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 45: 1, 46: 1, 47: 1 };
    var xfSection = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (xfSection) {
      var xfRe = /<xf\b([^>]*)\/?>/g, xm, i = 0;
      while ((xm = xfRe.exec(xfSection[1]))) {
        var a2 = attrs(xm[1]);
        var id = parseInt(a2.numFmtId || '0', 10);
        var isDate = !!builtinDate[id] || isDateFmtCode(custom[id]);
        if (isDate) dateStyles[i] = true;
        i++;
      }
    }
    return dateStyles;
  }

  function parseSheet(xml, shared, dateStyles) {
    var rows = [], maxCol = -1;
    var rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, rm;
    while ((rm = rowRe.exec(xml))) {
      var inner = rm[2] || '';
      var rowArr = [];
      var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
      while ((cm = cellRe.exec(inner))) {
        var a = attrs(cm[1]);
        var ci = colToIndex(a.r || 'A1');
        if (ci < 0) continue;
        var content = cm[2] || '';
        var val = '';
        var t = a.t || 'n';
        if (t === 'inlineStr') {
          var texts = [], tre = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g, tm;
          while ((tm = tre.exec(content))) texts.push(xmlDecode(tm[1] || ''));
          val = texts.join('');
        } else {
          var vm = content.match(/<v\b[^>]*>([\s\S]*?)<\/v>|<v\b[^>]*\/>/);
          var raw = vm ? xmlDecode(vm[1] || '') : '';
          if (t === 's') val = shared[parseInt(raw, 10)] || '';
          else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'str') val = raw;
          else {
            // 数值：可能是日期
            var sIdx = parseInt(a.s || '0', 10);
            if (dateStyles[sIdx] && raw !== '' && /^\d+(\.\d+)?$/.test(raw)) {
              var nd = normalizeDate(raw);
              if (nd) { val = nd.date + (nd.time ? ' ' + nd.time : ''); }
              else val = raw;
            } else val = raw;
          }
        }
        rowArr[ci] = val;
        if (ci > maxCol) maxCol = ci;
      }
      // 稀疏数组补齐
      var full = [];
      for (var k = 0; k <= maxCol; k++) full[k] = rowArr[k] === undefined ? '' : rowArr[k];
      if (full.length) rows.push(full);
    }
    return rows;
  }

  function getEntryData(bytes, view, entry) {
    var p = entry.localOffset;
    if (readU32(view, p) !== 0x04034b50) throw new Error('zip 局部头损坏');
    var nameLen = readU16(view, p + 26);
    var extraLen = readU16(view, p + 28);
    var start = p + 30 + nameLen + extraLen;
    var data = bytes.subarray(start, start + entry.compSize);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRaw(data);
    throw new Error('不支持的压缩方式: ' + entry.method);
  }

  async function inflateRaw(data) {
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([data]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  function readZipEntries(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    var view = new DataView(arrayBuffer);
    var eocd = -1;
    var minPos = Math.max(0, bytes.length - 22 - 65535);
    for (var i = bytes.length - 22; i >= minPos; i--) {
      if (readU32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 .xlsx 文件（找不到 zip 结尾）');
    var count = readU16(view, eocd + 10);
    var cdOffset = readU32(view, eocd + 16);
    var entries = {};
    var p = cdOffset;
    for (var n = 0; n < count; n++) {
      if (readU32(view, p) !== 0x02014b50) break;
      var method = readU16(view, p + 10);
      var compSize = readU32(view, p + 20);
      var uncompSize = readU32(view, p + 24);
      var nameLen = readU16(view, p + 28);
      var extraLen = readU16(view, p + 30);
      var commentLen = readU16(view, p + 32);
      var localOffset = readU32(view, p + 42);
      var name = utf8(bytes.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { method: method, compSize: compSize, uncompSize: uncompSize, localOffset: localOffset };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { bytes: bytes, view: view, entries: entries };
  }

  async function parseXlsx(arrayBuffer) {
    var zip = readZipEntries(arrayBuffer);
    var cache = {};
    async function readText(name) {
      if (cache[name] !== undefined) return cache[name];
      var e = zip.entries[name];
      if (!e) { cache[name] = null; return null; }
      var data = await getEntryData(zip.bytes, zip.view, e);
      var txt = utf8(data);
      cache[name] = txt;
      return txt;
    }

    var shared = parseSharedStrings(await readText('xl/sharedStrings.xml'));
    var dateStyles = parseStyles(await readText('xl/styles.xml'));

    // 工作表名称
    var wb = await readText('xl/workbook.xml');
    var rels = await readText('xl/_rels/workbook.xml.rels');
    var relMap = {};
    if (rels) {
      var rr = /<Relationship\b[^>]*\/>/g, rm;
      while ((rm = rr.exec(rels))) { var a = attrs(rm[0]); relMap[a.Id] = a.Target; }
    }
    var sheets = [];
    if (wb) {
      var sr = /<sheet\b[^>]*\/>/g, sm;
      while ((sm = sr.exec(wb))) {
        var a2 = attrs(sm[0]);
        var rid = a2['r:id'] || a2.id;
        var target = relMap[rid] || '';
        target = target.replace(/^\/?xl\//, '').replace(/^\.\.\//, '');
        sheets.push({ name: a2.name || ('Sheet' + (sheets.length + 1)), path: 'xl/' + target });
      }
    }
    var parsed = [];
    // 只解析实际存在的工作表，若解析不到再退回扫描
    var candidates = sheets.length ? sheets : listSheetFiles(zip.entries);
    for (var s = 0; s < candidates.length; s++) {
      var path = candidates[s].path || candidates[s];
      var xml = await readText(path);
      if (!xml) continue;
      parsed.push({ name: candidates[s].name || ('Sheet' + (s + 1)), rows: parseSheet(xml, shared, dateStyles) });
    }
    // 过滤掉完全空的工作表
    parsed = parsed.filter(function (sh) { return sh.rows && sh.rows.length; });
    if (!parsed.length) throw new Error('xlsx 中没有找到任何工作表数据');
    return { sheets: parsed };
  }

  function listSheetFiles(entries) {
    return Object.keys(entries).filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); })
      .sort(function (a, b) {
        var na = parseInt(a.match(/\d+/)[0], 10), nb = parseInt(b.match(/\d+/)[0], 10);
        return na - nb;
      });
  }

  /* ============================================== 统一入口：任意文件 -> 表格 */
  async function parseFile(fileName, data, opts) {
    opts = opts || {};
    var name = (fileName || '').toLowerCase();
    if (/\.xlsx?$/.test(name)) {
      var res = await parseXlsx(data);
      var sheet = opts.sheetIndex === undefined ? 0 : opts.sheetIndex;
      if (sheet >= res.sheets.length) sheet = 0;
      var rows = res.sheets[sheet].rows;
      return finishTable(rows, fileName, res);
    }
    // 文本
    var bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    var dec = decodeBytes(bytes);
    return finishTable(parseDelimited(dec.text), fileName, { encoding: dec.encoding, text: dec.text });
  }

  function finishTable(rows, fileName, meta) {
    var headerIdx = findHeaderRow(rows);
    if (headerIdx === -1) {
      // 没有标准表头，尝试自由文本解析
      if (meta && meta.text) {
        var ft = parseFreeText(meta.text);
        if (ft.rows.length) return { headers: ft.headers, rows: ft.rows, headerIndex: -1, freeText: true, fileName: fileName, meta: meta };
      }
      // 当作无表头，用第一行当表头
      headerIdx = 0;
    }
    var headers = rows[headerIdx] || [];
    var dataRows = rows.slice(headerIdx + 1).filter(function (r) {
      return r.some(function (c) { return c !== undefined && String(c).trim() !== ''; });
    });
    return {
      headers: headers,
      rows: dataRows,
      headerIndex: headerIdx,
      freeText: false,
      fileName: fileName,
      meta: meta
    };
  }

  /* 直接从文本解析（用于粘贴文本导入） */
  function parseText(text, fileName) {
    return finishTable(parseDelimited(text), fileName, { text: text, encoding: 'text' });
  }

  return {
    decodeBytes: decodeBytes,
    sniffDelimiter: sniffDelimiter,
    parseDelimited: parseDelimited,
    findHeaderRow: findHeaderRow,
    mapColumns: mapColumns,
    sniffSource: sniffSource,
    normalizeSource: normalizeSource,
    SOURCE_LABELS: SOURCE_LABELS,
    SOURCE_KEYS: SOURCE_KEYS_ORDER,
    normalizeDate: normalizeDate,
    normalizeTime: normalizeTime,
    extractRow: extractRow,
    parseFreeText: parseFreeText,
    parseXlsx: parseXlsx,
    parseText: parseText,
    parseFile: parseFile
  };
});
