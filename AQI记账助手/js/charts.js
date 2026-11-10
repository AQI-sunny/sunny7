/* ============================================================================
 * charts.js —— 纯 Canvas 图表（不依赖任何第三方库）
 * 支持：柱形图 / 条形图 / 饼图 / 环形图 / 折线图 / 面积图 / 堆叠柱形图 / 分组柱形图
 * 数据以 { label, value(Number), valueText(精确文本), color } 形式传入，
 * 金额文本始终来自 Money，图形几何只用 Number 近似，不影响任何金额计算结果。
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Charts = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var PALETTE = ['#4fc3f7', '#ff8a65', '#ba68c8', '#81c784', '#ffd54f', '#f06292', '#7986cb',
    '#4db6ac', '#ffb74d', '#a1887f', '#9575cd', '#4dd0e1', '#e57373', '#aed581', '#90a4ae',
    '#66bb6a', '#ffca28', '#26a69a', '#42a5f5', '#8d6e63', '#7e57c2', '#9ccc65', '#607d8b'];

  function color(i) { return PALETTE[i % PALETTE.length]; }

  function niceMax(v) {
    if (v <= 0) return 1;
    var exp = Math.floor(Math.log10(v));
    var base = Math.pow(10, exp);
    var f = v / base;
    var nf;
    if (f <= 1) nf = 1; else if (f <= 2) nf = 2; else if (f <= 2.5) nf = 2.5;
    else if (f <= 5) nf = 5; else nf = 10;
    return nf * base;
  }

  function setup(canvas, w, h) {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function sizeCanvas(canvas) {
    var w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    var h = canvas.clientHeight;
    if (!h || h < 40) h = Math.round(w * 0.55);
    return { w: w, h: h };
  }

  function emptyState(ctx, w, h) {
    ctx.fillStyle = '#8a93a6';
    ctx.font = '14px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('暂无数据', w / 2, h / 2);
  }

  /* -------------------------------------------------------------- 点击热区
   * 每个绘制函数把可点的区域记到 canvas.__hits（下标对应 items/labels），
   * hitAt(canvas, x, y) 返回命中的下标，供 ui 层打开该组的账单明细。 */
  function hitAt(canvas, x, y) {
    var hits = canvas.__hits;
    if (!hits) return null;
    for (var k = 0; k < hits.length; k++) {
      var h = hits[k];
      if (h.pie) {
        var dx = x - h.cx, dy = y - h.cy;
        var r = Math.sqrt(dx * dx + dy * dy);
        if (r < h.r0 || r > h.r1) continue;
        var a = Math.atan2(dy, dx);
        if (a < h.a0) a += Math.PI * 2;   /* 扇区从 -PI/2 起连续绕一圈 */
        if (a >= h.a0 && a <= h.a1) return h.i;
      } else if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        return h.i;
      }
    }
    return null;
  }

  /* -------------------------------------------------------------- 单一序列柱形/条形 */
  function drawBars(canvas, spec) {
    var s = sizeCanvas(canvas);
    var ctx = setup(canvas, s.w, s.h);
    var items = spec.items.filter(function (i) { return i.value > 0; });
    canvas.__hits = [];
    if (!items.length) return emptyState(ctx, s.w, s.h);
    var horizontal = spec.type === 'hbar';
    var maxVal = niceMax(Math.max.apply(null, items.map(function (i) { return i.value; })));

    if (horizontal) {
      var padL = 96, padR = 70, padT = 12, padB = 12;
      var areaW = s.w - padL - padR, areaH = s.h - padT - padB;
      var rowH = areaH / items.length;
      ctx.font = '12px system-ui,sans-serif';
      items.forEach(function (it, i) {
        var y = padT + i * rowH;
        var bw = maxVal ? (it.value / maxVal) * areaW : 0;
        ctx.fillStyle = it.color || color(i);
        roundRect(ctx, padL, y + rowH * 0.18, bw, rowH * 0.64, 4);
        ctx.fill();
        canvas.__hits.push({ x: 0, y: y, w: s.w, h: rowH, i: i });
        ctx.fillStyle = '#c7cede';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(trim(it.label, 12), padL - 8, y + rowH / 2);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#e8ecf5';
        ctx.fillText(it.valueText, padL + bw + 6, y + rowH / 2);
      });
    } else {
      var pL = 52, pR = 12, pT = 22, pB = 40;
      var aW = s.w - pL - pR, aH = s.h - pT - pB;
      // 网格 + y 轴刻度
      ctx.font = '11px system-ui,sans-serif';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (var g = 0; g <= 4; g++) {
        var gy = pT + aH - (aH * g / 4);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath(); ctx.moveTo(pL, gy); ctx.lineTo(s.w - pR, gy); ctx.stroke();
        ctx.fillStyle = '#8a93a6';
        ctx.fillText(fmtShort(maxVal * g / 4), pL - 6, gy);
      }
      var n = items.length;
      var slot = aW / n;
      var bw2 = Math.min(slot * 0.62, 46);
      items.forEach(function (it, i) {
        var cx = pL + slot * (i + 0.5);
        var bh = maxVal ? (it.value / maxVal) * aH : 0;
        var y = pT + aH - bh;
        ctx.fillStyle = it.color || color(i);
        roundRect(ctx, cx - bw2 / 2, y, bw2, bh, 4); ctx.fill();
        canvas.__hits.push({ x: pL + slot * i, y: pT, w: slot, h: aH, i: i });
        // 值
        ctx.fillStyle = '#e8ecf5'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.font = '11px system-ui,sans-serif';
        ctx.fillText(it.valueText, cx, y - 4);
        // 标签（可旋转）
        ctx.fillStyle = '#a8b0c2';
        ctx.save();
        ctx.translate(cx, pT + aH + 6);
        if (n > 6) { ctx.rotate(-Math.PI / 5); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; }
        else { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; }
        ctx.fillText(trim(it.label, 10), 0, 0);
        ctx.restore();
      });
    }
  }

  /* -------------------------------------------------------------- 饼图/环形 */
  function drawPie(canvas, spec) {
    var s = sizeCanvas(canvas);
    var ctx = setup(canvas, s.w, s.h);
    var items = spec.items.filter(function (i) { return i.value > 0; });
    canvas.__hits = [];
    if (!items.length) return emptyState(ctx, s.w, s.h);
    var total = items.reduce(function (a, b) { return a + b.value; }, 0);
    var cx = s.h * 0.5 + 10, cy = s.h / 2;
    var R = Math.min(s.h * 0.4, s.w * 0.30);
    var inner = spec.type === 'donut' ? R * 0.58 : 0;
    var ang = -Math.PI / 2;
    items.forEach(function (it, i) {
      var a = (it.value / total) * Math.PI * 2;
      var a0 = ang, a1 = ang + a;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = it.color || color(i);
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,14,24,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      canvas.__hits.push({ pie: 1, cx: cx, cy: cy, r0: inner, r1: R, a0: a0, a1: a1, i: i });
      ang = a1;
    });
    if (inner > 0) {
      ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2);
      ctx.fillStyle = '#151a27'; ctx.fill();
      ctx.fillStyle = '#e8ecf5'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 15px system-ui,sans-serif';
      ctx.fillText(spec.centerText || '', cx, cy);
    }
    // 图例
    var lx = cx + R + 22, ly = Math.max(16, cy - items.length * 11);
    ctx.font = '12px system-ui,sans-serif';
    ctx.textBaseline = 'middle';
    items.forEach(function (it, i) {
      var y = ly + i * 22;
      canvas.__hits.push({ x: lx - 22, y: y - 11, w: s.w - lx + 22, h: 22, i: i });
      ctx.fillStyle = it.color || color(i);
      roundRect(ctx, lx, y - 6, 12, 12, 3); ctx.fill();
      ctx.fillStyle = '#c7cede'; ctx.textAlign = 'left';
      ctx.fillText(trim(it.label, 10), lx + 18, y);
      ctx.fillStyle = '#8a93a6';
      ctx.fillText((it.value / total * 100).toFixed(1) + '%  ' + it.valueText, lx + 18 + 76, y);
    });
  }

  /* -------------------------------------------------------------- 折线 / 面积 */
  function drawLine(canvas, spec) {
    var s = sizeCanvas(canvas);
    var ctx = setup(canvas, s.w, s.h);
    var items = spec.items;
    canvas.__hits = [];
    if (!items.length) return emptyState(ctx, s.w, s.h);
    var pL = 56, pR = 14, pT = 20, pB = 42;
    var aW = s.w - pL - pR, aH = s.h - pT - pB;
    var vals = items.map(function (i) { return i.value; });
    var maxVal = niceMax(Math.max.apply(null, vals.concat([0])));
    var minV = Math.min.apply(null, vals.concat([0]));
    var minVal = minV < 0 ? -niceMax(-minV) : 0;
    var range = (maxVal - minVal) || 1;

    ctx.font = '11px system-ui,sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) {
      var gy = pT + aH - aH * g / 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.moveTo(pL, gy); ctx.lineTo(s.w - pR, gy); ctx.stroke();
      ctx.fillStyle = '#8a93a6';
      ctx.fillText(fmtShort(minVal + range * g / 4), pL - 6, gy);
    }
    var n = items.length;
    var step = n > 1 ? aW / (n - 1) : 0;
    function px(i) { return pL + (n > 1 ? step * i : aW / 2); }
    function py(v) { return pT + aH - ((v - minVal) / range) * aH; }

    var col = spec.color || '#4fc3f7';
    if (spec.type === 'area') {
      ctx.beginPath();
      ctx.moveTo(px(0), py(items[0].value));
      for (var i = 1; i < n; i++) ctx.lineTo(px(i), py(items[i].value));
      ctx.lineTo(px(n - 1), pT + aH); ctx.lineTo(px(0), pT + aH); ctx.closePath();
      var grd = ctx.createLinearGradient(0, pT, 0, pT + aH);
      grd.addColorStop(0, 'rgba(79,195,247,0.45)');
      grd.addColorStop(1, 'rgba(79,195,247,0.02)');
      ctx.fillStyle = grd; ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(px(0), py(items[0].value));
    for (var j = 1; j < n; j++) ctx.lineTo(px(j), py(items[j].value));
    ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.stroke();
    items.forEach(function (it, i) {
      // 热区：相邻两点的中点之间的一整列，方便手指/鼠标点中
      var left = i === 0 ? pL : (px(i - 1) + px(i)) / 2;
      var right = i === n - 1 ? s.w - pR : (px(i) + px(i + 1)) / 2;
      canvas.__hits.push({ x: left, y: pT, w: Math.max(4, right - left), h: aH, i: i });
      if (n <= 40) {
        ctx.beginPath(); ctx.arc(px(i), py(it.value), 3, 0, Math.PI * 2);
        ctx.fillStyle = '#151a27'; ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      }
      if (n <= 14) {
        ctx.fillStyle = '#e8ecf5'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.font = '11px system-ui,sans-serif';
        ctx.fillText(it.valueText, px(i), py(it.value) - 7);
      }
      // x 标签
      ctx.fillStyle = '#a8b0c2';
      ctx.save(); ctx.translate(px(i), pT + aH + 6);
      if (n > 8) { ctx.rotate(-Math.PI / 5); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; }
      else { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; }
      ctx.font = '11px system-ui,sans-serif';
      ctx.fillText(trim(it.label, 8), 0, 0);
      ctx.restore();
    });
  }

  /* -------------------------------------------------------------- 堆叠柱形 */
  function drawStacked(canvas, spec) {
    var s = sizeCanvas(canvas);
    var ctx = setup(canvas, s.w, s.h);
    var labels = spec.labels, series = spec.series;
    canvas.__hits = [];
    if (!labels.length || !series.length) return emptyState(ctx, s.w, s.h);
    var pL = 56, pR = 14, pT = 18, pB = 56;
    var aW = s.w - pL - pR, aH = s.h - pT - pB;
    var totals = labels.map(function (_, i) {
      return series.reduce(function (a, se) { return a + (se.values[i] || 0); }, 0);
    });
    var maxVal = niceMax(Math.max.apply(null, totals.concat([0])));
    ctx.font = '11px system-ui,sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) {
      var gy = pT + aH - aH * g / 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.moveTo(pL, gy); ctx.lineTo(s.w - pR, gy); ctx.stroke();
      ctx.fillStyle = '#8a93a6';
      ctx.fillText(fmtShort(maxVal * g / 4), pL - 6, gy);
    }
    var slot = aW / labels.length;
    var bw = Math.min(slot * 0.6, 40);
    labels.forEach(function (lb, i) {
      var cx = pL + slot * (i + 0.5);
      var base = pT + aH;
      canvas.__hits.push({ x: pL + slot * i, y: pT, w: slot, h: aH, i: i });
      series.forEach(function (se, si) {
        var v = se.values[i] || 0;
        if (v <= 0) return;
        var bh = (v / maxVal) * aH;
        ctx.fillStyle = se.color || color(si);
        roundRect(ctx, cx - bw / 2, base - bh, bw, bh, 3); ctx.fill();
        base -= bh;
      });
      ctx.fillStyle = '#a8b0c2'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(trim(lb, 8), cx, pT + aH + 6);
    });
    // 图例
    var ly = s.h - 14; var lxx = pL;
    series.forEach(function (se, si) {
      ctx.fillStyle = se.color || color(si);
      roundRect(ctx, lxx, ly - 6, 11, 11, 3); ctx.fill();
      ctx.fillStyle = '#c7cede'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(se.name, lxx + 16, ly);
      lxx += 16 + ctx.measureText(se.name).width + 18;
    });
  }

  /* -------------------------------------------------------------- 分组柱形 */
  function drawGrouped(canvas, spec) {
    var s = sizeCanvas(canvas);
    var ctx = setup(canvas, s.w, s.h);
    var labels = spec.labels, series = spec.series;
    canvas.__hits = [];
    if (!labels.length || !series.length) return emptyState(ctx, s.w, s.h);
    var pL = 56, pR = 14, pT = 18, pB = 56;
    var aW = s.w - pL - pR, aH = s.h - pT - pB;
    var maxVal = 0;
    series.forEach(function (se) { se.values.forEach(function (v) { if (v > maxVal) maxVal = v; }); });
    maxVal = niceMax(maxVal);
    ctx.font = '11px system-ui,sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = 0; g <= 4; g++) {
      var gy = pT + aH - aH * g / 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.moveTo(pL, gy); ctx.lineTo(s.w - pR, gy); ctx.stroke();
      ctx.fillStyle = '#8a93a6';
      ctx.fillText(fmtShort(maxVal * g / 4), pL - 6, gy);
    }
    var slot = aW / labels.length;
    var totalBars = series.length;
    var bw = Math.min((slot * 0.7) / totalBars, 26);
    labels.forEach(function (lb, i) {
      var cx = pL + slot * (i + 0.5);
      var startX = cx - (bw * totalBars) / 2;
      canvas.__hits.push({ x: pL + slot * i, y: pT, w: slot, h: aH, i: i });
      series.forEach(function (se, si) {
        var v = se.values[i] || 0;
        var bh = maxVal ? (v / maxVal) * aH : 0;
        ctx.fillStyle = se.color || color(si);
        roundRect(ctx, startX + si * bw + 1, pT + aH - bh, bw - 2, bh, 3); ctx.fill();
      });
      ctx.fillStyle = '#a8b0c2'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(trim(lb, 8), cx, pT + aH + 6);
    });
    var ly = s.h - 14; var lxx = pL;
    series.forEach(function (se, si) {
      ctx.fillStyle = se.color || color(si);
      roundRect(ctx, lxx, ly - 6, 11, 11, 3); ctx.fill();
      ctx.fillStyle = '#c7cede'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(se.name, lxx + 16, ly);
      lxx += 16 + ctx.measureText(se.name).width + 18;
    });
  }

  function trim(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function fmtShort(v) {
    v = Number(v) || 0;
    var a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(1) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(1) + '万';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return String(Math.round(v * 100) / 100);
  }

  function render(canvas, spec) {
    switch (spec.type) {
      case 'pie':
      case 'donut': return drawPie(canvas, spec);
      case 'line':
      case 'area': return drawLine(canvas, spec);
      case 'stacked': return drawStacked(canvas, spec);
      case 'grouped': return drawGrouped(canvas, spec);
      case 'hbar': return drawBars(canvas, spec);
      default: return drawBars(canvas, spec);
    }
  }

  return { render: render, color: color, PALETTE: PALETTE, fmtShort: fmtShort, hitAt: hitAt };
});
