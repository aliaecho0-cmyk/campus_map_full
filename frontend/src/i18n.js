/** Lightweight runtime localization. Map artwork remains unchanged by design. */
let language = 'zh';

const UI = {
  zh: {
    appTitle: '百团大战 · 活动导览',
    map: '地图', clubs: '社团/组织', events: '活动',
    searchClubs: '搜索社团', searchClubNames: '搜索社团名称', search: '搜索',
    clubBooths: '社团摊位', lawnPlaza: '草坪 / 广场', stonePath: '石板路',
    boothIntro: '摊位介绍', boothEmail: '摊位邮箱', clubEmail: '社团邮箱', gameRules: '游戏规则', viewDetails: '查看详情',
    gameOverview: '游戏总览\n\n本次百团大战开启线上+线下双重闯关模式！\n\n线上玩法\n\n在电子地图浏览20个及以上摊位信息，即可解锁成就徽章「百事通」。持徽章前往社联摊位，即可兑换童年怀旧小零食一份或饮料一瓶！\n\n线下玩法\n\n活动开启后，请先前往社联摊位领取专属集章手册及限定小扇子伴手礼！奔赴各个社团摊位，完成各摊位指定任务收集印章。每集齐8枚印章，即可回到社联摊位获取一次抽奖机会！',
    announcement: '公告', acknowledge: '知道了', booth: '摊位 {id}',
    boothStatus: '摊位 {id} · {status}', noSearchResults: '未找到匹配的社团',
    all: '全部', academic: '学术', tech: '科技', art: '艺术', sport: '体育', volunteer: '志愿',
    practicalExperience: '实践体验类', academicTechnology: '学术科技类', sportsClubs: '体育运动类',
    cultureArt: '文化艺术类', studentOrganizations: '学生组织',
    open: '营业中', break: '休息中', closed: '待营业',
    totalClubs: '共 {count} 个摊位', viewOnMap: '在地图查看',
    noClubs: '暂无社团，换个分类或关键词试试', noDescription: '暂无简介',
    clubDetails: '社团详情', studentOrganizationDetails: '学生组织详情', clubProfile: '社团简介', studentOrganizationProfile: '学生组织简介', boothLocation: '摊位位置',
    boothNumber: '摊位号 {id}', mapView: '地图查看', clubMissing: '社团不存在',
    loading: '加载中', stage: '舞台', hiddenQuest: '隐藏任务', prizePoint: '兑奖点',
    npc: 'NPC', prize: '兑奖', allDay: '全天', goThere: '去现场', noEvents: '暂无活动',
    eventDetails: '活动详情', stageShow: '舞台表演', clubEvent: '社团活动',
    event: '活动', location: '地点', time: '时间', starts: '开始', eventIntro: '活动介绍', programList: '节目单',
    eventMissing: '活动不存在', skip: '跳过', next: '下一步', complete: '完成',
    tutorialHint: '★ 新手提示', tutorialPrevious: '◀ 上一步',
    tutorialNext: '下一步 ▶', startExploring: '开始探索 ▶',
    confirm: '确定', cancel: '取消', loadingEllipsis: '加载中…',
    pauseRecord: '暂停唱片', resumeRecord: '继续播放唱片', replayTutorial: '重新播放新手教程', langSwitch: '切换语言', notProvided: '未提供',
    copyEmail: '复制邮箱', emailCopied: '已复制', copyFailed: '复制失败',

    reward: '奖励', redeem: '核销',
    badgeProgress: '徽章进度', claimReward: '奖励领取',
    badgeRule: '规则：首页点击格子/点进社团详情页后，停留三秒，算作“浏览摊位 +1”的计数。',
    badgeUnlocked: '已解锁', badgeFallback: '徽章',
    viewedBooths: '已浏览 {count} / {required} 个摊位',
    claimable: '可领取', claimed: '已首签', redeemed: '已核销',
    eventEnded: '活动已结束', eventTimePending: '活动时间待定',
    countdown: '距离活动结束还有 {days} 天 {hours} 小时 {mins} 分',
    keepBrowsing: '继续浏览摊位，集满进度后可领取奖励',
    claimHint: '已解锁，点击领取你的奖励券',
    voucher: '奖励券', qrAlt: '领取码二维码',
    voucherNote: '出示本券由工作人员核销',

    collectPlusOne: '摊位收集 +1',
    collectComplete: '摊位收集任务已完成，可领取奖励',
    syncingBadge: '正在全力加载中…',

    staffLogin: '工作人员登录', enterName: '请输入姓名', login: '登录',
    invalidLink: '链接无效，请联系管理员',
    codeNameError: '识别码或姓名错误，请确认后重试',
    scanRedeem: '扫码核销', staffLabel: '工作人员：',
    noAccess: '无权访问，即将返回主页',
    loginExpired: '登录已失效，即将返回主页，请重新用工作台链接进入',
    cameraError: '无法启动摄像头，请检查权限或使用 HTTPS/localhost',
    redeeming: '核销中…', redeemSuccess: '核销成功', redeemFail: '核销失败，请重试',

    networkError: '网络异常，请稍后重试',
    requestTimeout: '连接超时，请稍后重试；地图和社团资料仍可浏览',
    retry: '重试',
    err_INVALID_REQUEST: '请求参数错误',
    err_AUTH_REQUIRED: '未登录，请携带 JWT',
    err_INVALID_TOKEN: 'JWT 无效或已过期',
    err_STAFF_REQUIRED: '需要工作人员权限',
    err_BADGE_NOT_UNLOCKED: '未解锁 knowitall，无法操作',
    err_EVENT_NOT_FOUND: '活动不存在',
    err_CLAIM_TOKEN_NOT_FOUND: '领取码不存在',
    err_EVENT_NOT_ACTIVE: '活动当前不可用',
    err_CLAIM_TOKEN_EXPIRED: '已超过活动截止时间',
    err_CLAIM_TOKEN_REDEEMED: '领取码已经核销',
    err_SQLITE_BUSY: '数据库繁忙，请稍后重试',
  },
  en: {
    appTitle: 'Clubs Fair · Event Guide',
    map: 'Map', clubs: 'Clubs/Orgs', events: 'Events',
    searchClubs: 'Search clubs', searchClubNames: 'Search club names', search: 'Search',
    clubBooths: 'Club Booths', lawnPlaza: 'Lawn / Plaza', stonePath: 'Stone Path',
    boothIntro: 'Booth Profile', boothEmail: 'Booth Email', clubEmail: 'Club Email', gameRules: 'Activity Rules', viewDetails: 'View Details',
    gameOverview: 'Game Overview\n\nGet ready for the Clubs Fair! Explore virtually and join the fun in person!\n\nOnline Gameplay\n\nBrowse information for 20 or more booths on the map to unlock the「Know-It-All」badge. Redeem it at the Student Associations Union booth (SAUD) for a pack of nostalgic childhood snacks or a free drink!\n\nOn-site Gameplay\n\nStart by visiting the Student Associations Union booth to grab your Stamp Collection Booklet and a limited-edition fan gift. Then, hunt down club booths and collect stamps by completing their tasks. Every 8 stamps for a lucky draw chance at the Student Associations Union booth (SAUD)!',
    announcement: 'Notice', acknowledge: 'Got it', booth: 'Booth {id}',
    boothStatus: 'Booth {id} · {status}', noSearchResults: 'No matching clubs found',
    all: 'All', academic: 'Academic', tech: 'Technology', art: 'Arts', sport: 'Sports', volunteer: 'Community',
    practicalExperience: 'Practical Experience Clubs', academicTechnology: 'Academic & Science-Technology Clubs',
    sportsClubs: 'Sports Clubs', cultureArt: 'Culture & Art Clubs', studentOrganizations: 'Student Organizations',
    open: 'Open', break: 'On Break', closed: 'Not Yet Open',
    totalClubs: '{count} booths', viewOnMap: 'View on Map',
    noClubs: 'No clubs found. Try another category or keyword.', noDescription: 'No description available.',
    clubDetails: 'Club Details', studentOrganizationDetails: 'Student Organization Details', clubProfile: 'Club Profile', studentOrganizationProfile: 'Student Organization Profile', boothLocation: 'Booth Location',
    boothNumber: 'Booth {id}', mapView: 'View on Map', clubMissing: 'Club not found',
    loading: 'Loading', stage: 'Stage', hiddenQuest: 'Hidden Quest', prizePoint: 'Prize Point',
    npc: 'NPC', prize: 'Prize', allDay: 'All Day', goThere: 'Go There', noEvents: 'No events',
    eventDetails: 'Event Details', stageShow: 'Stage Performance', clubEvent: 'Club Event',
    event: 'Event', location: 'Location', time: 'Time', starts: 'Starts', eventIntro: 'About This Event', programList: 'Program',
    eventMissing: 'Event not found', skip: 'Skip', next: 'Next', complete: 'Done',
    tutorialHint: '★ Rookie Guide', tutorialPrevious: '◀ Previous',
    tutorialNext: 'Next ▶', startExploring: 'Start Exploring ▶',
    confirm: 'Confirm', cancel: 'Cancel', loadingEllipsis: 'Loading…',
    pauseRecord: 'Pause record', resumeRecord: 'Resume record', replayTutorial: 'Replay rookie guide', langSwitch: 'Switch language', notProvided: 'Not provided',
    copyEmail: 'Copy email', emailCopied: 'Copied', copyFailed: 'Copy failed',

    reward: 'Rewards', redeem: 'Redeem',
    badgeProgress: 'Badge Progress', claimReward: 'Claim Reward',
    badgeRule: 'Rule: Tap a grid tile on the home page or open a club detail page and stay for three seconds to count as “Booth viewed +1”.',
    badgeUnlocked: 'Unlocked', badgeFallback: 'Badge',
    viewedBooths: 'Viewed {count} / {required} booths',
    claimable: 'Claimable', claimed: 'Claimed', redeemed: 'Redeemed',
    eventEnded: 'Event ended', eventTimePending: 'Event time TBD',
    countdown: '{days}d {hours}h {mins}m until the event ends',
    keepBrowsing: 'Keep visiting booths — unlock the reward once progress is full.',
    claimHint: 'Unlocked! Tap to claim your reward voucher.',
    voucher: 'Reward Voucher', qrAlt: 'Claim code QR',
    voucherNote: 'Show this voucher to staff for redemption',

    collectPlusOne: 'Booth collected +1',
    collectComplete: 'All booths collected — the reward is ready to claim',
    syncingBadge: 'Confirming views…',

    staffLogin: 'Staff Login', enterName: 'Enter your name', login: 'Log in',
    invalidLink: 'Invalid link, please contact the administrator',
    codeNameError: 'Wrong access code or name, please try again',
    scanRedeem: 'Scan to Redeem', staffLabel: 'Staff: ',
    noAccess: 'No access, returning to home',
    loginExpired: 'Session expired, returning to home — please re-enter from the staff link',
    cameraError: 'Cannot start the camera. Check permissions or use HTTPS/localhost',
    redeeming: 'Redeeming…', redeemSuccess: 'Redeemed successfully', redeemFail: 'Redemption failed, please retry',

    networkError: 'Network error, please try again later',
    requestTimeout: 'Connection timed out. Please retry; the map and club information remain available.',
    retry: 'Retry',
    err_INVALID_REQUEST: 'Invalid request parameters',
    err_AUTH_REQUIRED: 'Not signed in, JWT required',
    err_INVALID_TOKEN: 'Invalid or expired JWT',
    err_STAFF_REQUIRED: 'Staff permission required',
    err_BADGE_NOT_UNLOCKED: 'knowitall not unlocked',
    err_EVENT_NOT_FOUND: 'Event not found',
    err_CLAIM_TOKEN_NOT_FOUND: 'Claim code not found',
    err_EVENT_NOT_ACTIVE: 'Event is not available',
    err_CLAIM_TOKEN_EXPIRED: 'Past the event deadline',
    err_CLAIM_TOKEN_REDEEMED: 'Claim code already redeemed',
    err_SQLITE_BUSY: 'Database busy, please try again later',
  },
};

const CLUB_NAMES_EN = {
  '校园媒体人': 'Campus Media Agency (CMA)',
  '交通社': 'Transport Fans Club',
  '尚饮社': 'Tea & Bartending Club',
  '模拟联合国协会': 'The Model United Nations of CUHKSZ (MUN)',
  '跑步社': 'Running Club',
  '“沉浸人生”推理协会': 'Life in Mystery',
  'HIPHOP音乐社': 'HIPHOP Club',
  'TIDE Club': 'TIDE Club',
  '经管头马演讲俱乐部': 'SME Toastmasters Club',
  '学生大使团': 'The Student Ambassador Group',
  '金融工程学会': 'Finance Engineering Club',
  '英辩队': 'English Debate Team',
  '国旗护卫队': 'National Flag Guard',
  '国际学生协会': "International Students' Association",
  '台球社': 'Billiards Club',
  'Encore音乐剧社': 'Encore Musical Club',
  '唯在设计': 'Wesign',
  'Lg足球社': 'Lg Football Club',
  '桌游社': 'Board Game Club',
  '羽毛球社': 'Badminton Club',
  '分类大师': 'Sorting Master',
  '城市特派队': 'City Wanderers',
  '知津公益剧社': 'LifePedia',
  '微光公益': 'Shimmer',
  'SPC主摊位': 'Social Practice Center (SPC)',
  'uBuddies': 'uBuddies',
  '青年会': 'Youth Union',
  '电音社': 'Electronic Music Club',
  '2Tired骑行社': '2Tired Cycling Club',
  'ACE网球社': 'ACE Tennis Club',
  'English Animator': 'English Animator',
  '睡眠社': 'Sleep Matters Club',
  '颜究所': 'The Mask Studio',
  'PIC摄影社': 'P.I.C. Photography Association',
  '涤纶诗社': 'Dylan Poetry Club',
  '酷滑社': 'SkateCool Club',
  '人文历史社': 'Humanities and History Club',
  '桥牌社': 'Bridge Club',
  '天文社': 'Astronomy Society',
  '粤语社': 'Cantonese Club',
  '鹿鸣配音社': 'The Voice of Deer Dubbing Club (VDDC)',
  '化学协会': 'ChemA Community',
  '新能源学会': 'New Energy Association',
  '游戏研究社': 'Gaming Odyssey',
  'IEA投资启蒙协会': 'Investment Enlightenment Association',
  '物理学会': 'Physical Society',
  '计算机协会': 'Computer Association',
  '凤凰漫研社': 'Phoenix ACG Club',
  '生物科学学会': 'DeepBio Association',
  '武联社': 'Martial Arts Union',
  '逸夫青年研习社': 'Shaw Awakened Youth',
  'Respecx 青春健康同伴社': 'Respecx',
  '奇点科幻社': 'Singularity Science Fiction',
  '魅影戏剧社': 'Phantom Club',
  '乒乓球社': 'Table Tennis Club',
  '机智协会': 'Electronic Intelligence Association',
  '棒球社': 'Baseball Club',
  'V8橄榄球俱乐部': 'V8 Football Club',
  '匹克球社': 'Pickleball Club',
  '排球社': 'Volleyball Club',
  '击剑社': 'The First Sword Fencing Club',
  '聚乐部': 'Music Union',
  '极限飞盘协会': 'Ultimate Frisbee Organization',
  '高尔夫社': 'Golf Association',
  '电竞社': 'E-sport Club',
  'LGUBA篮球社': 'Basketball Club',
  '游泳社': 'Swimming Club',
  '淇奥手创社': 'iCraft Club',
  'CP 食研社': 'Cooking Pioneer',
  '润泽书社': 'Runze Book Society',
  '攀岩社': 'Climbing Club',
  '趣旅行': 'Darlingo',
  '戏曲社': 'Chinese Opera Association',
  '掬月社': 'Jvyue Club',
  '醉红学': 'Redology Club',
  '弈秋棋社': 'Chess Club',
  '锦灰社': 'Jinhui Club',
  '手极社': 'Hand Extreme Sports Club',
  '精舞团': 'Max Dancing Club',
  'TEDxCUHKSZ': 'TEDxCUHKSZ',
  '自说自话脱口秀社': 'SOMIC Stand-Up Comedy Club',
  '南露书法社': 'Nanlu Calligraphy Club',
  '数独社': 'Sudoku Club',
  '电影俱乐部': 'Film Club',
  '客属联谊会': 'Hakka Association',
  '健身社': 'Fitness Club',
  '万寿模型社': 'Bantako Model Club',
  '研究生会': 'The Graduate Student Union',
};

const EVENT_EN = {
  'evt-stage-1': { title: 'Phoenix ACG Club Band Performance', location: 'Sunken Plaza Stage', desc: 'The Phoenix ACG Club band performs four distinctive live songs.' },
  'evt-stage-2': { title: 'Max Dancing Club Performance', location: 'Sunken Plaza Stage', desc: 'Max Dancing Club presents a dynamic showcase spanning multiple dance styles.' },
  'evt-stage-3': { title: 'Encore Musical Theatre Club Performance', location: 'Sunken Plaza Stage', desc: 'Encore Musical Theatre Club brings classic musical theatre selections to the stage.' },
  'evt-stage-4': { title: 'Phoenix ACG Club Otaku Dance Performance', location: 'Sunken Plaza Stage', desc: 'Phoenix ACG Club presents five energetic otaku dance pieces.' },
  'evt-stage-5': { title: 'Music Union Performance', location: 'Sunken Plaza Stage', desc: 'Music Union lights up the stage with a live vocal performance.' },
  'evt-stage-6': { title: 'HIPHOP Music Club Performance', location: 'Sunken Plaza Stage', desc: 'HIPHOP Music Club performs a live song medley.' },
  'evt-stage-7': { title: 'Max Dancing Club Open Dance', location: 'Sunken Plaza Stage', desc: 'Join Max Dancing Club for a free-form interactive dance session.' },
  'evt-reward': {
    title: 'Student Association Redemption',
    location: 'Student Association Booth',
    desc: 'Game Overview\n\nGet ready for the Clubs Fair! Explore virtually and join the fun in person!\n\nOnline Gameplay\n\nBrowse information for 20 or more booths on the map to unlock the「Know-It-All」badge. Redeem it at the Student Associations Union booth (SAUD) for a pack of nostalgic childhood snacks or a free drink!\n\nOn-site Gameplay\n\nStart by visiting the Student Associations Union booth to grab your Stamp Collection Booklet and a limited-edition fan gift. Then, hunt down club booths and collect stamps by completing their tasks. Every 8 stamps for a lucky draw chance at the Student Associations Union booth (SAUD)!',
  },
};

const ANNOUNCEMENT_EN = {
  'ann-1': {
    title: 'Game Overview',
    content: 'Click on the Student Associations Union Department booth introduction to learn more about the gameplay. Complete the interactive tasks at the club booths to redeem great gifts; there are also stage performances waiting for you on site!',
  },
};

/** 徽章名英文（后端 badges.name 为中文，按 code 映射） */
const BADGE_EN = {
  knowitall: 'Know-It-All',
};

const CATEGORY_KEYS = {
  学术: 'academic', 科技: 'tech', 艺术: 'art', 体育: 'sport', 志愿: 'volunteer',
  实践体验类: 'practicalExperience', 学术科技类: 'academicTechnology', 体育运动类: 'sportsClubs',
  文化艺术类: 'cultureArt', 学生组织: 'studentOrganizations',
};
const STATUS_KEYS = { open: 'open', break: 'break', closed: 'closed' };

function setLanguage(next) {
  language = next === 'en' ? 'en' : 'zh';
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.title = t('appTitle');
}

function getLanguage() {
  return language;
}

function isEnglish() {
  return language === 'en';
}

function t(key, values = {}) {
  const template = UI[language][key] ?? UI.zh[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
}

function categoryText(category) {
  return isEnglish() ? t(CATEGORY_KEYS[category] || category) : category;
}

function statusText(status) {
  return t(STATUS_KEYS[status] || status);
}

function englishClubName(name) {
  return CLUB_NAMES_EN[name] || name;
}

function englishClubCopy(name, boothId) {
  const booth = boothId ? ` at Booth ${boothId}` : '';
  return {
    slogan: `Meet ${name}${booth}.`,
    intro: `Meet ${name}${booth} and learn about the club and its activities from the team on site.`,
    gameRules: 'Please ask the booth staff for the current activity rules.',
  };
}

function localizeBooth(booth) {
  if (!isEnglish()) return booth;
  const name = booth.nameEn || englishClubName(booth.clubName);
  const fallback = englishClubCopy(name, booth.id);
  return {
    ...booth,
    clubName: name,
    category: categoryText(booth.category),
    ...fallback,
    intro: booth.introEn || fallback.intro,
    gameRules: booth.gameRulesEn || '',
  };
}

function localizeClub(club) {
  if (!isEnglish()) return club;
  const name = club.nameEn || englishClubName(club.name);
  const fallback = englishClubCopy(name, club.boothId);
  return {
    ...club,
    name,
    category: categoryText(club.category),
    ...fallback,
    intro: club.introEn || fallback.intro,
    gameRules: club.gameRulesEn || '',
  };
}

function localizeEvent(event) {
  if (!isEnglish()) return event;
  return { ...event, ...(EVENT_EN[event.id] || {}) };
}

function localizeAnnouncement(announcement) {
  if (!isEnglish()) return announcement;
  return { ...announcement, ...(ANNOUNCEMENT_EN[announcement.id] || {}) };
}

function localizeBadge(badge) {
  if (!isEnglish() || !badge) return badge;
  return { ...badge, name: BADGE_EN[badge.code] || badge.name };
}

export {
  setLanguage,
  getLanguage,
  isEnglish,
  t,
  categoryText,
  statusText,
  localizeBooth,
  localizeClub,
  localizeEvent,
  localizeAnnouncement,
  localizeBadge,
};
