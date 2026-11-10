/* ============================================================================
 * util.js —— 通用工具
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Util = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var seq = 0;
  function uid(prefix) {
    seq++;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + seq.toString(36) + '_' +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  /* 归一化「具体项」文本，用于去重比较：去空格/标点/大小写差异 */
  function normItem(s) {
    return String(s || '')
      .replace(/[\s\u3000]+/g, '')
      .replace(/[，。！？、；：""''（）()[\]【】{}<>《》\-_—\.,!\?;:'"`~·•|\\\/]/g, '')
      .toLowerCase();
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function todayISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function nowISO(d) {
    d = d || new Date();
    return todayISO(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function monthOf(date) { return date ? String(date).slice(0, 7) : ''; }
  function yearOf(date) { return date ? String(date).slice(0, 4) : ''; }

  var WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function weekday(date) {
    var d = new Date(String(date) + 'T00:00:00');
    return isNaN(d.getTime()) ? '' : WD[d.getDay()];
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function unique(arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function (v) { if (!seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }

  function groupBy(arr, fn) {
    var m = {};
    (arr || []).forEach(function (v) {
      var k = fn(v);
      (m[k] = m[k] || []).push(v);
    });
    return m;
  }

  function countBy(arr, fn) {
    var m = {};
    (arr || []).forEach(function (v) { var k = fn(v); m[k] = (m[k] || 0) + 1; });
    return m;
  }

  function sortBy(arr, fn, desc) {
    return arr.slice().sort(function (a, b) {
      var x = fn(a), y = fn(b);
      if (x === y) return 0;
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    });
  }

  /* 比较日期字符串（YYYY-MM-DD） */
  function dateBefore(a, b) { return String(a) < String(b); }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 200);
    };
  }

  /* 触发浏览器下载。注意：file:// 页面里 URL.createObjectURL 得到的
   * blob:null/... 会被 Chrome 拦截（点了没反应/网络错误），所以文本一律
   * 走 data: URL，二进制（图片）走 canvas.toDataURL / FileReader。 */
  function saveAs(url, filename, revoke) {
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () {
      if (a.parentNode) document.body.removeChild(a);
      if (revoke) { try { URL.revokeObjectURL(revoke); } catch (e) {} }
    }, 150);
  }

  function download(filename, data, mime) {
    if (typeof data === 'string') {
      var url = 'data:' + (mime || 'text/plain') + ';charset=utf-8,' + encodeURIComponent(data);
      return saveAs(url, filename);
    }
    // Blob / File
    var fr = new FileReader();
    fr.onload = function () { saveAs(fr.result, filename); };
    fr.onerror = function () {
      // 兜底：仍尝试 blob URL
      try { saveAs(URL.createObjectURL(data), filename, true); } catch (e) {}
    };
    fr.readAsDataURL(data);
  }

  return {
    uid: uid, normItem: normItem, pad2: pad2, todayISO: todayISO, nowISO: nowISO,
    monthOf: monthOf, yearOf: yearOf, weekday: weekday, escapeHtml: escapeHtml,
    unique: unique, groupBy: groupBy, countBy: countBy, sortBy: sortBy,
    dateBefore: dateBefore, clamp: clamp, debounce: debounce, download: download
  };
});
