/* ============================================================================
 * exportImage.js —— 把账单渲染成一张好看的 PNG 图片（卡片模板 + 统计亮点）
 * 依赖：Money / Util / Categorize / Parse
 * ==========================================================================*/
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ExportImage = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function dep(name, path) {
    if (typeof window !== 'undefined' && window[name]) return window[name];
    if (typeof require !== 'undefined') return require(path);
    return null;
  }
  var Money = dep('Money', './money.js');
  var Util = dep('Util', './util.js');
  var Categorize = dep('Categorize', './categorize.js');
  var Parse = dep('Parse', './parse.js');

  var F = 'system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif';

  /* 两套模板配色：light 干净卡片 / dark 夜间 */
  var THEMES = {
    light: {
      bg1: '#eaf0fa', bg2: '#ffffff',
      card: '#ffffff', cardBorder: '#e3e9f4',
      grad: ['#2f6fed', '#4fc3f7'],
      text: '#16203a', sub: '#6b7690', line: '#e8edf6', panel: '#f6f9fe',
      head: '#eef3fb', headText: '#5a6a86',
      expense: '#e5484d', income: '#17a15e', transfer: '#7a869e',
      kpiBg: '#f6f9fe', kpiBorder: '#e8eef8',
      dot: 'rgba(255,255,255,.75)'
    },
    dark: {
      bg1: '#0a0f18', bg2: '#0f1621',
      card: '#141d2b', cardBorder: '#223047',
      grad: ['#1d4ed8', '#0ea5e9'],
      text: '#e9effc', sub: '#93a3bd', line: '#24334a', panel: '#1a2536',
      head: '#1b2738', headText: '#9db0cd',
      expense: '#ff6b6b', income: '#35d07f', transfer: '#93a3bd',
      kpiBg: '#1a2536', kpiBorder: '#25344b',
      dot: 'rgba(255,255,255,.7)'
    }
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function ellipsis(ctx, text, maxW) {
    text = String(text == null ? '' : text);
    if (ctx.measureText(text).width <= maxW) return text;
    var lo = 0, hi = text.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo) + '…';
  }

  function srcLabel(s) {
    return (Parse && Parse.SOURCE_LABELS && Parse.SOURCE_LABELS[s]) ? Parse.SOURCE_LABELS[s] : (s || '');
  }

  /* 统计亮点：单笔最大支出/收入、最贵的一天、支出最多的分类 */
  function highlights(bills) {
    var out = {};
    var maxExp = null, maxInc = null;
    var byDay = {}, byCat = {};
    bills.forEach(function (b) {
      var amt = Money.parse(b.amount) || 0n;
      if (b.type === 'expense') {
        if (!maxExp || Money.cmp(amt, Money.parse(maxExp.amount)) > 0) maxExp = b;
        byDay[b.date || '—'] = (byDay[b.date || '—'] || 0n) + amt;
        var cn = Categorize ? Categorize.getCategory(b.category).name : b.category;
        byCat[cn] = (byCat[cn] || 0n) + amt;
      } else if (b.type === 'income') {
        if (!maxInc || Money.cmp(amt, Money.parse(maxInc.amount)) > 0) maxInc = b;
      }
    });
    var dayKey = null, dayBig = -1n;
    Object.keys(byDay).forEach(function (k) { if (byDay[k] > dayBig) { dayBig = byDay[k]; dayKey = k; } });
    var catKey = null, catBig = -1n;
    Object.keys(byCat).forEach(function (k) { if (byCat[k] > catBig) { catBig = byCat[k]; catKey = k; } });
    out.maxExpense = maxExp;
    out.maxIncome = maxInc;
    out.maxDay = dayKey ? { date: dayKey, amount: Money.str(dayBig) } : null;
    out.topCategory = catKey ? { name: catKey, amount: Money.str(catBig) } : null;
    return out;
  }

  /**
   * @param {Array} bills
   * @param {object} opts { title, subtitle, note, currency, style:'light'|'dark' }
   * @returns {HTMLCanvasElement}
   */
  function render(bills, opts) {
    opts = opts || {};
    var T = THEMES[opts.style === 'dark' ? 'dark' : 'light'];
    var currency = opts.currency || '¥';
    var scale = 2;
    var W = 920;
    var cardX = 26, cardW = W - cardX * 2, padX = cardX + 28;
    var innerW = cardW - 56;
    var gap = 16;

    var hasTime = bills.some(function (b) { return b.time; });

    var cols = [
      { key: 'idx', title: '#', w: 34, align: 'left' },
      { key: 'date', title: '日期', w: 98, align: 'left' }
    ];
    if (hasTime) cols.push({ key: 'time', title: '时间', w: 74, align: 'left' });
    cols.push({ key: 'item', title: '项目', w: 'flex', align: 'left' });
    cols.push({ key: 'category', title: '分类', w: 92, align: 'left' });
    cols.push({ key: 'source', title: '来源', w: 66, align: 'left' });
    cols.push({ key: 'amount', title: '金额', w: 122, align: 'right' });

    var headBlockH = 116;
    var kpiH = 82;
    var tableHeadH = 38;
    var rowH = 33;
    var hlH = 58;
    var footH = 74;

    var N = bills.length;
    var rowsH = Math.max(1, N) * rowH;

    var y = cardX;              // 卡片顶
    var contentTop = y + headBlockH;
    var kpiTop = contentTop + gap;
    var tableTop = kpiTop + kpiH + gap;
    var tableH = tableHeadH + rowsH;
    var hlTop = tableTop + tableH + gap;
    var footTop = hlTop + hlH;
    var cardH = (footTop + footH) - y;

    var H = y + cardH + cardX;

    var canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    var ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.textBaseline = 'middle';

    // 背景渐变
    var bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, T.bg1); bg.addColorStop(1, T.bg2);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // 卡片
    ctx.save();
    ctx.shadowColor = 'rgba(20,40,80,.16)';
    ctx.shadowBlur = 26; ctx.shadowOffsetY = 8;
    ctx.fillStyle = T.card;
    roundRect(ctx, cardX, y, cardW, cardH, 20); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = T.cardBorder; ctx.lineWidth = 1;
    roundRect(ctx, cardX + .5, y + .5, cardW - 1, cardH - 1, 20); ctx.stroke();

    // 顶部渐变头
    ctx.save();
    roundRect(ctx, cardX, y, cardW, headBlockH, 20); ctx.clip();
    var hg = ctx.createLinearGradient(cardX, y, cardX + cardW, y + headBlockH);
    hg.addColorStop(0, T.grad[0]); hg.addColorStop(1, T.grad[1]);
    ctx.fillStyle = hg; ctx.fillRect(cardX, y, cardW, headBlockH);
    // 装饰圆
    ctx.globalAlpha = .18; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(cardX + cardW - 60, y + 20, 96, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cardX + cardW - 168, y + headBlockH - 6, 54, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // 标题
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 25px ' + F;
    ctx.fillText(ellipsis(ctx, opts.title || '账单明细', innerW - 160), padX, y + 42);
    ctx.font = '13px ' + F;
    ctx.globalAlpha = .92; ctx.fillStyle = '#ffffff';
    var sub = opts.subtitle || (bills.length ? (bills[0].date || '') + ' ~ ' + (bills[bills.length - 1].date || '') : '');
    ctx.fillText(ellipsis(ctx, sub, innerW - 160), padX, y + 72);
    ctx.globalAlpha = 1;

    // 右上角笔数徽标
    var badge = '共 ' + N + ' 笔';
    ctx.font = 'bold 13px ' + F;
    var bw = ctx.measureText(badge).width + 26;
    ctx.fillStyle = T.dot;
    roundRect(ctx, cardX + cardW - 24 - bw, y + 34, bw, 30, 15); ctx.fill();
    ctx.fillStyle = T.grad[0];
    ctx.textAlign = 'center';
    ctx.fillText(badge, cardX + cardW - 24 - bw / 2, y + 49);

    // KPI 卡片
    var expBig = 0n, incBig = 0n, trBig = 0n;
    bills.forEach(function (b) {
      var a = Money.parse(b.amount) || 0n;
      if (b.type === 'income') incBig += a; else if (b.type === 'transfer') trBig += a; else expBig += a;
    });
    var netBig = Money.sub(incBig, expBig);
    var kpis = [
      { k: '支出合计', v: currency + Money.fmt(expBig), c: T.expense },
      { k: '收入合计', v: currency + Money.fmt(incBig), c: T.income },
      { k: '净额', v: currency + Money.fmt(netBig), c: (netBig < 0n ? T.expense : T.grad[0]) },
      { k: '账单笔数', v: String(N), c: T.text }
    ];
    var kw = (innerW - gap * 3) / 4;
    kpis.forEach(function (kpi, i) {
      var kx = padX + i * (kw + gap);
      ctx.fillStyle = T.kpiBg;
      roundRect(ctx, kx, kpiTop, kw, kpiH, 12); ctx.fill();
      ctx.strokeStyle = T.kpiBorder; ctx.lineWidth = 1;
      roundRect(ctx, kx + .5, kpiTop + .5, kw - 1, kpiH - 1, 12); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.font = '12px ' + F; ctx.fillStyle = T.sub;
      ctx.fillText(kpi.k, kx + 14, kpiTop + 22);
      ctx.font = 'bold 20px ' + F; ctx.fillStyle = kpi.c;
      ctx.fillText(ellipsis(ctx, kpi.v, kw - 28), kx + 14, kpiTop + 52);
    });

    // 表头
    var tableW = innerW;
    var fixed = 0;
    cols.forEach(function (c) { if (c.w !== 'flex') fixed += c.w; });
    var flexW = tableW - fixed - (cols.length - 1) * 8;
    function colX(i) {
      var x = padX;
      for (var k = 0; k < i; k++) x += (cols[k].w === 'flex' ? flexW : cols[k].w) + 8;
      return x;
    }
    ctx.fillStyle = T.head;
    roundRect(ctx, padX, tableTop, tableW, tableHeadH, 10); ctx.fill();
    ctx.font = 'bold 12.5px ' + F; ctx.fillStyle = T.headText;
    cols.forEach(function (c, i) {
      var w = c.w === 'flex' ? flexW : c.w;
      ctx.textAlign = c.align;
      ctx.fillText(c.title, c.align === 'right' ? colX(i) + w : colX(i), tableTop + tableHeadH / 2);
    });

    // 数据行
    for (var r = 0; r < N; r++) {
      var b = bills[r];
      var ry = tableTop + tableHeadH + r * rowH;
      if (r % 2 === 1) { ctx.fillStyle = T.panel; ctx.fillRect(padX, ry, tableW, rowH); }
      var cat = Categorize ? Categorize.getCategory(b.category) : { name: b.category, color: '#888' };
      var vals = {
        idx: String(r + 1),
        date: b.date || '',
        time: b.time || '',
        item: b.item || '',
        category: cat.name,
        source: srcLabel(b.source),
        amount: (b.type === 'income' ? '+' : (b.type === 'transfer' ? '' : '-')) + currency + Money.fmt(b.amount)
      };
      cols.forEach(function (c, i) {
        var w = c.w === 'flex' ? flexW : c.w;
        var cx = c.align === 'right' ? colX(i) + w : colX(i);
        ctx.textAlign = c.align;
        if (c.key === 'amount') {
          ctx.font = 'bold 13px ' + F;
          ctx.fillStyle = b.type === 'income' ? T.income : (b.type === 'transfer' ? T.transfer : T.expense);
          ctx.fillText(ellipsis(ctx, vals.amount, w), cx, ry + rowH / 2);
        } else if (c.key === 'category') {
          ctx.font = '13px ' + F; ctx.fillStyle = T.text;
          var dotR = 4, dotX = cx + dotR, cy = ry + rowH / 2;
          ctx.save(); ctx.beginPath(); ctx.arc(dotX, cy, dotR, 0, Math.PI * 2);
          ctx.fillStyle = cat.color || T.sub; ctx.fill(); ctx.restore();
          ctx.fillText(ellipsis(ctx, vals.category, w - 14), dotX + dotR + 5, cy);
        } else {
          ctx.font = (c.key === 'item' ? '13px ' : '12.5px ') + F;
          ctx.fillStyle = (c.key === 'item') ? T.text : T.sub;
          ctx.fillText(ellipsis(ctx, vals[c.key], w), cx, ry + rowH / 2);
        }
      });
      ctx.strokeStyle = T.line; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padX, ry + rowH); ctx.lineTo(padX + tableW, ry + rowH); ctx.stroke();
    }

    // 统计亮点条
    var hl = highlights(bills);
    ctx.fillStyle = T.panel;
    roundRect(ctx, padX, hlTop, tableW, hlH, 12); ctx.fill();
    ctx.textAlign = 'left';
    var ax = padX + 16;
    var cyH = hlTop + hlH / 2;
    function chip(label, value, color) {
      ctx.font = '12px ' + F; ctx.fillStyle = T.sub;
      var lw = ctx.measureText(label).width;
      ctx.fillText(label, ax, cyH);
      ax += lw + 6;
      ctx.font = 'bold 13px ' + F; ctx.fillStyle = color;
      var vw = ctx.measureText(value).width;
      ctx.fillText(value, ax, cyH);
      ax += vw + 26;
      ctx.strokeStyle = T.line; ctx.beginPath();
      ctx.moveTo(ax - 13, cyH - 12); ctx.lineTo(ax - 13, cyH + 12); ctx.stroke();
    }
    if (hl.maxExpense) chip('最大单笔支出', currency + Money.fmt(hl.maxExpense.amount) + '（' + (hl.maxExpense.item || '').slice(0, 8) + ' · ' + (hl.maxExpense.date || '') + '）', T.expense);
    else if (hl.topCategory) chip('支出最多分类', hl.topCategory.name + ' ' + currency + Money.fmt(hl.topCategory.amount), T.grad[0]);
    if (hl.maxDay) chip('单日最高', currency + Money.fmt(hl.maxDay.amount) + '（' + hl.maxDay.date + '）', T.grad[0]);
    if (hl.topCategory && hl.maxExpense) chip('消费最多', hl.topCategory.name, T.income);

    // 页脚
    ctx.textAlign = 'left';
    ctx.font = '12px ' + F; ctx.fillStyle = T.sub;
    ctx.fillText(ellipsis(ctx, opts.note || '', innerW - 260), padX, footTop + 22);
    ctx.fillStyle = T.sub;
    ctx.fillText('生成时间：' + (Util ? Util.nowISO() : new Date().toLocaleString()), padX, footTop + 46);
    ctx.textAlign = 'right';
    ctx.font = 'bold 12px ' + F;
    ctx.fillStyle = T.grad[0];
    ctx.fillText('AQI的记账助手 · 本地离线 · 金额精确', padX + innerW, footTop + 46);

    return canvas;
  }

  /* file:// 下 blob 下载会被拦截，直接用 dataURL 最稳 */
  function download(canvas, filename) {
    var url = canvas.toDataURL('image/png');
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || ('账单明细_' + (Util ? Util.todayISO() : '') + '.png');
    document.body.appendChild(a); a.click();
    setTimeout(function () { if (a.parentNode) document.body.removeChild(a); }, 150);
  }

  function copyToClipboard(canvas) {
    return new Promise(function (resolve, reject) {
      if (!navigator.clipboard || !window.ClipboardItem) return reject(new Error('当前浏览器不支持复制图片'));
      canvas.toBlob(function (blob) {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(resolve, reject);
      }, 'image/png');
    });
  }

  return { render: render, download: download, copyToClipboard: copyToClipboard, highlights: highlights };
});
