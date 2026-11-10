/* ============================================================================
 * categorize.js —— 账单分类：分类字典 + 关键词自动分类规则
 * 支持：支出/收入/转账三大类；关键词命中自动归类；可扩展自定义规则。
 * 命名空间：window.Categorize / module.exports
 * ==========================================================================*/
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Categorize = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* ------------------------------------------------------------------ 分类字典 */
  var EXPENSE = [
    { id: 'food',         name: '餐饮美食', icon: '🍜', color: '#ff8a65' },
    { id: 'transport',    name: '交通出行', icon: '🚗', color: '#4fc3f7' },
    { id: 'shopping',     name: '购物消费', icon: '🛍️', color: '#ba68c8' },
    { id: 'clothing',     name: '服饰美容', icon: '👗', color: '#f06292' },
    { id: 'housing',      name: '居住物业', icon: '🏠', color: '#a1887f' },
    { id: 'life',         name: '生活服务', icon: '🧾', color: '#90a4ae' },
    { id: 'digital',      name: '数码通讯', icon: '📱', color: '#7986cb' },
    { id: 'medical',      name: '医疗健康', icon: '💊', color: '#4db6ac' },
    { id: 'education',    name: '教育学习', icon: '📚', color: '#ffb74d' },
    { id: 'entertainment',name: '娱乐休闲', icon: '🎮', color: '#9575cd' },
    { id: 'travel',       name: '旅行度假', icon: '✈️', color: '#4dd0e1' },
    { id: 'social',       name: '人情往来', icon: '🧧', color: '#e57373' },
    { id: 'finance',      name: '金融保险', icon: '💰', color: '#aed581' },
    { id: 'pet',          name: '宠物花费', icon: '🐾', color: '#ffb300' },
    { id: 'sports',       name: '运动健身', icon: '🏃', color: '#81c784' },
    { id: 'baby',         name: '母婴亲子', icon: '🍼', color: '#f8bbd0' },
    { id: 'drink',        name: '烟酒饮品', icon: '🍺', color: '#ffd54f' },
    { id: 'other',        name: '其他支出', icon: '💸', color: '#b0bec5' }
  ];

  var INCOME = [
    { id: 'salary',       name: '工资薪酬', icon: '💼', color: '#66bb6a' },
    { id: 'bonus',        name: '奖金补贴', icon: '🏅', color: '#ffca28' },
    { id: 'parttime',     name: '兼职外快', icon: '💪', color: '#26a69a' },
    { id: 'invest',       name: '投资收益', icon: '📈', color: '#42a5f5' },
    { id: 'refund',       name: '报销退款', icon: '↩️', color: '#8d6e63' },
    { id: 'transfer_in',  name: '转账收款', icon: '🔁', color: '#7e57c2' },
    { id: 'other_in',     name: '其他收入', icon: '💰', color: '#9ccc65' }
  ];

  var TRANSFER = [
    { id: 'transfer',     name: '内部转账', icon: '🔄', color: '#607d8b' },
    { id: 'repay',        name: '信用卡还款', icon: '💳', color: '#78909c' },
    { id: 'fund',         name: '理财存取', icon: '📊', color: '#8d6e63' }
  ];

  var ALL = EXPENSE.concat(INCOME, TRANSFER);
  var BY_ID = {};
  ALL.forEach(function (c) { BY_ID[c.id] = c; });

  function getCategory(id) {
    return BY_ID[id] || { id: id || 'other', name: '未分类', icon: '❓', color: '#90a4ae' };
  }
  function categoriesByType(type) {
    if (type === 'income') return INCOME;
    if (type === 'transfer') return TRANSFER;
    return EXPENSE;
  }

  /* ------------------------------------------------------------------ 关键词规则 */
  /* 命中越靠后（越长）的关键词优先级越高；同一分类命中可累积权重 */
  function R(cat, words) { return { cat: cat, words: words }; }

  var RULES = [
    /* ---- 交通出行 ---- */
    R('transport', ['12306', '铁路', '动车', '高铁', '火车', '机票', '航空', '航班', '飞机', '出租车', '滴滴', '快的', '曹操出行', 'T3出行', '高德打车', '美团打车', '花小猪', '哈啰', '青桔', '摩拜', '共享单车', '单车', '公交', '地铁', '轨道交通', '通勤', '加油', '中国石化', '中国石油', '中石化', '中石油', '壳牌', '停车', '停车费', '高速', 'ETC', '过路', '违章', '车检', '车险', '洗车', '代驾', '顺风车', '长途汽车', '轮渡', '船票', '交通罚款']),
    /* ---- 餐饮美食 ---- */
    R('food', ['美团外卖', '饿了么', '外卖', '肯德基', 'KFC', '麦当劳', 'McDonald', '必胜客', '汉堡王', '星巴克', 'Starbucks', '瑞幸', 'luckin', '库迪', '蜜雪冰城', '喜茶', '奈雪', '茶百道', '古茗', '沪上阿姨', '奶茶', '咖啡', '茶饮', '火锅', '烤肉', '烧烤', '麻辣烫', '米线', '快餐', '饭店', '餐厅', '餐馆', '酒楼', '小吃', '美食', '食堂', '早餐', '午餐', '晚餐', '夜宵', '面包', '蛋糕', '甜品', '烘焙', '便利店', '海底捞', '西贝', '真功夫', '老乡鸡', '沙县', '兰州拉面', '黄焖鸡', '外卖订单', '呷哺', '吉野家', '德克士', '华莱士', '杨国福', '张亮']),
    /* ---- 购物消费 ---- */
    R('shopping', ['淘宝', '天猫', 'Tmall', '京东', 'JD', '拼多多', '唯品会', '苏宁', '国美', '抖音商城', '抖店', '小红书', '得物', '小红书商城', '当当', '亚马逊', 'Amazon', 'ebay', '天猫超市', '京东超市', '超市', '百货', '商场', '沃尔玛', '永辉', '盒马', '大润发', '家乐福', '华润万家', '罗森', '全家', '7-11', 'seven', '美宜佳', '菜市场', '生鲜', '果蔬', '买菜', '多多买菜', '美团优选', '淘菜菜', '山姆', 'Costco', '宜家', 'IKEA', '名创优品', '生活超市', '购物']),
    /* ---- 服饰美容 ---- */
    R('clothing', ['优衣库', 'UNIQLO', 'ZARA', 'HM', 'H&M', '耐克', 'Nike', '阿迪达斯', 'Adidas', '李宁', '安踏', '服饰', '服装', '衣服', '鞋', '裤', '裙', '帽子', '包包', '手袋', '化妆', '护肤', '美妆', '面膜', '口红', '丝芙兰', '屈臣氏', '理发', '美发', '美容', 'spa', '按摩', '美甲', '美睫', '饰品', '珠宝', '黄金', '眼镜', '手表']),
    /* ---- 居住物业 ---- */
    R('housing', ['房租', '租金', '房东', '中介', '链家', '贝壳', '自如', '蛋壳', '物业', '物业管理', '水费', '电费', '燃气', '天然气', '暖气', '取暖', '取暖费', '自来水', '国家电网', '水电', '维修', '装修', '家政', '保洁', '搬家公司', '家电维修', '马桶', '家具', '床垫', '门窗']),
    /* ---- 生活服务 ---- */
    R('life', ['快递', '运费', '邮寄', '顺丰', '菜鸟', '驿收发', '邮费', '洗衣', '干洗', '拍照', '证件照', '复印', '打印', '殡葬', '公证', '诉讼', '罚款', '停车管理', '锁', '钥匙', '收费站', '回收', '垃圾', '物业服务', '生活缴费', '缴费']),
    /* ---- 数码通讯 ---- */
    R('digital', ['话费', '手机充值', '充值话费', '中国移动', '中国联通', '中国电信', '移动', '联通', '电信', '宽带', '流量', '手机', 'iPhone', '华为', '小米', 'OPPO', 'vivo', '荣耀', '一加', 'realme', '苹果店', '电脑', '笔记本', 'MacBook', '联想', '戴尔', '华硕', '显示器', '键盘', '鼠标', '耳机', 'AirPods', '音响', '相机', '镜头', '路由器', '硬盘', 'U盘', '充电', '数据线', '数据服务']),
    /* ---- 医疗健康 ---- */
    R('medical', ['医院', '门诊', '挂号', '医药', '药店', '药房', '大药房', '诊所', '牙科', '口腔', '体检', '住院', '手术', '化验', '疫苗', '保健', '同仁堂', '老百姓大药房', '阿里健康', '健康', '理疗', '中医', '康复']),
    /* ---- 教育学习 ---- */
    R('education', ['学费', '培训', '教育', '网课', '课程', '书本', '图书', '书籍', '文具', '考试', '报名费', '学而思', '新东方', '得到', '知乎', '樊登', '粉笔', '驾校', '驾照', '考研', '学杂费', '辅导']),
    /* ---- 娱乐休闲 ---- */
    R('entertainment', ['电影', '影票', '猫眼', '淘票票', '影院', 'KTV', '网吧', '游戏', 'Steam', 'steam', '网易游戏', '腾讯游戏', '点卡', '皮肤', '充点券', '游乐场', '密室', '剧本杀', '桌游', '酒吧', 'livehouse', '演唱会', '音乐会', '展会', '门票', '会员', '视频会员', '爱奇艺', '腾讯视频', '优酷', '芒果TV', '网易云音乐', 'QQ音乐', 'Spotify', 'Netflix', '抖音', '快手', '直播', '打赏', 'B站', 'bilibili', '订阅', '彩券', '彩票', '麻将', '牌']),
    /* ---- 旅行度假 ---- */
    R('travel', ['酒店', '民宿', '宾馆', '民宿', '携程', '去哪儿', '飞猪', '同程', '马蜂窝', '旅行', '旅游', '度假', '门票', '景区', '景点', '导游', '签证', '护照', '出境', 'airbnb', 'Airbnb', 'Booking', 'Agoda', '青旅', '旅拍']),
    /* ---- 人情往来 ---- */
    R('social', ['红包', '随礼', '份子', '礼金', '礼品', '礼物', '请客', '转账给', '微信红包', '支付宝红包', '慰问', '捐助', '捐款', '打赏', '彩礼', '压岁钱']),
    /* ---- 金融保险 ---- */
    R('finance', ['保险', '保费', '平安', '中国人寿', '太平洋保险', '基金', '股票', '证券', '利息', '手续费', '服务费', '年费', '账户管理费', '理财', '贷款', '还款', '分期', '花呗', '借呗', '微粒贷', '白条', '信用卡', '银行']),
    /* ---- 宠物 ---- */
    R('pet', ['宠物', '猫粮', '狗粮', '宠物医院', '宠物店', '兽医', '猫砂', '驱虫', '疫苗', '宠物用品', '寄养', '洗护', '宠物美容']),
    /* ---- 运动健身 ---- */
    R('sports', ['健身', '健身房', '游泳', '球场', '羽毛球', '篮球', '足球', '乒乓球', '网球', '瑜伽', '跑步', '马拉松', 'keep', 'Keep', '运动', '球鞋', '体育', '器械', '骑行', '登山', '滑雪', '攀岩']),
    /* ---- 母婴亲子 ---- */
    R('baby', ['奶粉', '纸尿裤', '尿不湿', '母婴', '婴童', '玩具', '幼儿园', '早教', '亲子', '童装', '婴儿', '育儿', '奶瓶', '辅食']),
    /* ---- 烟酒饮品 ---- */
    R('drink', ['香烟', '烟草', '白酒', '啤酒', '红酒', '葡萄酒', '茅台', '五粮液', '饮品', '饮料', '矿泉水', '酒水', '便利店酒']),

    /* ---- 收入 ---- */
    R('salary', ['工资', '薪资', '薪酬', '月薪', '代发工资', '薪资发放', '劳务报酬', '工资发放', '退休金', '养老金', '五险一金']),
    R('bonus', ['奖金', '绩效', '年终奖', '补贴', '津贴', '补助', '分红', '压岁钱收入']),
    R('parttime', ['兼职', '稿费', '稿酬', '副业', '外快', '佣金', '提成', '稿费']),
    R('invest', ['理财收益', '投资收益', '基金收益', '股票收益', '余额宝收益', '零钱通收益', '利息收入', '分红收入', '定期利息', '国债']),
    R('refund', ['退款', '退还', '退回', '退货', '报销', '理赔', '赔付', '返现', '撤单', '失败退款', '原路退回']),
    R('transfer_in', ['转账', '收款', '收到', '入账', '转入', '微信转账', '支付宝转账']),

    /* ---- 转账 / 不计收支 ---- */
    R('repay', ['信用卡还款', '花呗还款', '借呗还款', '白条还款', '还款']),
    R('fund', ['余额宝', '零钱通', '余利宝', '理财通', '基金申购', '基金赎回', '转入余额宝', '转出余额宝', '转入零钱通', '朝朝宝', '定期存款', '购买理财', '赎回']),
    R('transfer', ['内部转账', '账户转账', '转账到', '提现', '充值余额', '转入', '转出'])
  ];

  /* 描述「交易性质」的分类优先级更高（退款/还款/理财等，与商品类关键词冲突时优先） */
  var CAT_BONUS = { refund: 5, repay: 5, fund: 5, transfer_in: 3, transfer: 3 };

  /* 生成扁平关键词表（长词优先） */
  function buildMatcher(customRules) {
    var list = [];
    (customRules || []).forEach(function (r) {
      if (!r || !r.cat || !r.word) return;
      list.push({ cat: r.cat, word: String(r.word).toLowerCase(), weight: 3, bonus: CAT_BONUS[r.cat] || 0, custom: true, type: r.type });
    });
    RULES.forEach(function (group) {
      group.words.forEach(function (w) {
        list.push({ cat: group.cat, word: String(w).toLowerCase(), weight: 1, bonus: CAT_BONUS[group.cat] || 0, custom: false });
      });
    });
    list.sort(function (a, b) { return b.word.length - a.word.length; });
    return list;
  }

  /* 从文本推测收支类型 */
  function guessType(text, hint) {
    if (hint === 'income' || hint === 'expense' || hint === 'transfer') return hint;
    var s = String(text || '');
    if (/不计收支|转账|还款|余额宝|零钱通|理财/.test(s)) return 'transfer';
    if (/收入|收款|退款|报销|工资|奖金|利息|入账|转入|收到/.test(s)) return 'income';
    return 'expense';
  }

  /* 核心：根据若干文本片段自动分类 */
  function classify(parts, matcher, typeHint) {
    var text = parts.filter(Boolean).join(' ').toLowerCase();
    if (!text) return { cat: typeHint === 'income' ? 'other_in' : (typeHint === 'transfer' ? 'transfer' : 'other'), score: 0 };
    var best = null;
    for (var i = 0; i < matcher.length; i++) {
      var rule = matcher[i];
      if (text.indexOf(rule.word) === -1) continue;
      var score = (rule.weight + (rule.bonus || 0)) * 1000 + rule.word.length;
      if (!best || score > best.score) best = { cat: rule.cat, score: score, word: rule.word };
    }
    if (!best) return { cat: typeHint === 'income' ? 'other_in' : (typeHint === 'transfer' ? 'transfer' : 'other'), score: 0 };
    return best;
  }

  return {
    EXPENSE: EXPENSE,
    INCOME: INCOME,
    TRANSFER: TRANSFER,
    ALL: ALL,
    getCategory: getCategory,
    categoriesByType: categoriesByType,
    buildMatcher: buildMatcher,
    classify: classify,
    guessType: guessType,
    RULES: RULES
  };
});
