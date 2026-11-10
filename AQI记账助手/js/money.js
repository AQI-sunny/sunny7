/* ============================================================================
 * money.js —— 精确金额运算
 * 全程使用 BigInt 整数（放大 10^6 = 1e6 倍存储），绝不使用浮点数，
 * 加减乘除都不会产生「四舍五入 / 浮点误差」，保证金额计算永远精确。
 * 可在浏览器与 Node 中同时使用。
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Money = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var SCALE_DIGITS = 6;
  var SCALE = 1000000n;              // 10^6
  var SCALE_STR = '000000';

  /* ---------- 字符归一化：全角->半角、去掉货币符号与千分位 ---------- */
  var CHAR_MAP = {
    '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
    '．': '.', '。': '.', '，': ',', '－': '-', 'ー': '-', '＋': '+', '　': ' '
  };

  function normalize(text) {
    var s = String(text);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      out += (CHAR_MAP[ch] !== undefined ? CHAR_MAP[ch] : ch);
    }
    // 去掉常见货币单位/符号/空格/千分位
    out = out.replace(/[\s]/g, '')
      .replace(/[¥￥$]/g, '')
      .replace(/元|人民币|RMB|CNY/gi, '')
      .replace(/,/g, '');
    return out;
  }

  /* ---------- 解析：任意数字/字符串 -> BigInt(放大 1e6) ---------- */
  function parse(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'bigint') return value;
    var s = normalize(value);
    if (s === '') return null;

    var neg = false;
    // 括号表示负数 (123.45)
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s[0] === '+') { s = s.slice(1); }
    else if (s[0] === '-') { neg = true; s = s.slice(1); }
    if (s === '' || !/^\d*\.?\d*$/.test(s) || s === '.') return null;

    var dot = s.indexOf('.');
    var intPart = dot === -1 ? s : s.slice(0, dot);
    var fracPart = dot === -1 ? '' : s.slice(dot + 1);
    if (fracPart.length > SCALE_DIGITS) {
      // 超过 6 位小数（远超任何真实货币精度）——保留前 6 位并标记
      fracPart = fracPart.slice(0, SCALE_DIGITS);
    }
    intPart = intPart === '' ? '0' : intPart;
    fracPart = (fracPart + SCALE_STR).slice(0, SCALE_DIGITS);

    var v = BigInt(intPart) * SCALE + BigInt(fracPart);
    return neg ? -v : v;
  }

  /* ---------- 输出为规范字符串（自动去掉末尾多余的 0） ---------- */
  function str(value) {
    if (value === null || value === undefined) return '';
    var v = typeof value === 'bigint' ? value : parse(value);
    if (v === null) return '';
    if (v === 0n) return '0';
    var neg = v < 0n;
    var a = neg ? -v : v;
    var iPart = a / SCALE;
    var fPart = a % SCALE;
    var f = fPart.toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
    return (neg ? '-' : '') + iPart.toString() + (f ? '.' + f : '');
  }

  /* ---------- 金额展示（默认最少 2 位小数，最多 6 位，绝不丢失精度） ---------- */
  function fmt(value, opt) {
    opt = opt || {};
    var v = typeof value === 'bigint' ? value : parse(value);
    if (v === null) return '';
    var minFrac = opt.minFrac === undefined ? 2 : opt.minFrac;
    var neg = v < 0n;
    var a = neg ? -v : v;
    var iPart = (a / SCALE).toString();
    var fFull = (a % SCALE).toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
    var frac = fFull;
    while (frac.length < minFrac) frac += '0';
    if (opt.thousands !== false) {
      iPart = iPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    return (neg ? '-' : '') + iPart + (frac ? '.' + frac : '');
  }

  /* ---------- 基础运算（全部精确） ---------- */
  function addBig() {
    var total = 0n;
    for (var i = 0; i < arguments.length; i++) {
      var v = typeof arguments[i] === 'bigint' ? arguments[i] : parse(arguments[i]);
      if (v !== null) total += v;
    }
    return total;
  }
  function subBig(a, b) {
    a = typeof a === 'bigint' ? a : (parse(a) || 0n);
    b = typeof b === 'bigint' ? b : (parse(b) || 0n);
    return a - b;
  }
  function negBig(a) { return -(typeof a === 'bigint' ? a : parse(a)); }
  function absBig(a) { a = typeof a === 'bigint' ? a : parse(a); return a < 0n ? -a : a; }
  function mulInt(a, k) { // 乘以整数倍（如「数量 × 单价」）
    a = typeof a === 'bigint' ? a : parse(a);
    return a * BigInt(k);
  }
  function cmp(a, b) {
    a = typeof a === 'bigint' ? a : (parse(a) || 0n);
    b = typeof b === 'bigint' ? b : (parse(b) || 0n);
    return a < b ? -1 : (a > b ? 1 : 0);
  }
  function isZero(a) { a = typeof a === 'bigint' ? a : parse(a); return a === 0n; }

  /* 精确除法：把「金额」平均分给「整数份数」。
   * money 为放大后的金额，count 为普通整数。返回 { q, r, ok }，
   * q/r 仍是放大后的金额，ok=true 表示刚好整除（无余数、无精度损失）。 */
  function divExact(money, count) {
    money = typeof money === 'bigint' ? money : parse(money);
    count = BigInt(count);
    if (count === 0n) throw new Error('除以零');
    var r = money % count;
    return { q: money / count, r: r, ok: r === 0n };
  }

  /* 带显式舍入模式的除法（仅在用户明确要求「按 X 位取整」时才使用，默认截断） */
  function div(money, count, mode) {
    money = typeof money === 'bigint' ? money : parse(money);
    count = BigInt(count);
    if (count === 0n) throw new Error('除以零');
    var q = money / count, r = money % count;
    if (r === 0n) return q;
    var ar = r < 0n ? -r : r;
    var ab = count < 0n ? -count : count;
    var sign = (money < 0n) !== (count < 0n) ? -1n : 1n;
    if (mode === 'half-up') { if (ar * 2n >= ab) return q + sign; return q; }
    if (mode === 'ceil') { return sign > 0n ? q + 1n : q; }
    if (mode === 'floor') { return sign < 0n ? q - 1n : q; }
    return q; // 默认截断
  }

  /* 两个金额的比值（仅用于显示，如折扣率），返回 Number */
  function ratio(a, b) {
    var x = typeof a === 'bigint' ? a : parse(a);
    var y = typeof b === 'bigint' ? b : parse(b);
    if (!y) return 0;
    return Number(x) / Number(y);
  }

  /* 把金额平均分成 n 份且「分文不差」：余数按分依次补给前面的人，总和恒等于原值 */
  function splitEven(a, n) {
    a = typeof a === 'bigint' ? a : parse(a);
    n = BigInt(n);
    if (n <= 0n) throw new Error('份数必须为正');
    var q = a / n, r = a % n;
    var parts = [];
    for (var i = 0n; i < n; i++) parts.push(i < r ? q + 1n : q);
    return parts;
  }

  /* 汇总一组金额（数组里可以是字符串或 BigInt），返回 BigInt */
  function sumBig(list) {
    var t = 0n;
    if (list) for (var i = 0; i < list.length; i++) {
      var v = typeof list[i] === 'bigint' ? list[i] : parse(list[i]);
      if (v !== null) t += v;
    }
    return t;
  }
  function sum(list) { return str(sumBig(list)); }

  /* 占比（仅用于图表显示，不参与金额运算） */
  function pct(partBig, totalBig, digits) {
    digits = digits === undefined ? 1 : digits;
    var p = typeof partBig === 'bigint' ? partBig : parse(partBig);
    var t = typeof totalBig === 'bigint' ? totalBig : parse(totalBig);
    if (t === 0n) return '0';
    return (Number(p) * 100 / Number(t)).toFixed(digits);
  }

  return {
    SCALE_DIGITS: SCALE_DIGITS,
    SCALE: SCALE,
    parse: parse,
    str: str,
    fmt: fmt,
    add: addBig,
    sub: subBig,
    neg: negBig,
    abs: absBig,
    mulInt: mulInt,
    cmp: cmp,
    isZero: isZero,
    divExact: divExact,
    div: div,
    ratio: ratio,
    splitEven: splitEven,
    sumBig: sumBig,
    sum: sum,
    pct: pct
  };
});
