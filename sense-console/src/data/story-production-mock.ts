import type { ArtAsset, Chapter, Character, Shot, Story } from "@/contracts/story-production"

export const stories: Story[] = [
  {
    id: "story-du-kou",
    title: "渡口",
    logline: "民国年间的清晨渡口，四个各怀心事的乘客同船过河，浓雾散尽时，谁都回不到原来的岸。",
    source: "adapted",
    status: "in_production",
    chapterCount: 6,
    hookCount: 4,
    sceneSlotCount: 9,
    beatCount: 210,
    segmentCount: 10,
    shotCount: 34,
    characterCount: 5,
    artAssetCount: 6,
    updatedAt: "刚刚",
  },
  {
    id: "story-chang-ye",
    title: "长夜信使",
    logline: "战时城市的最后一班邮差，在宵禁前把一封信送到该去的地方。",
    source: "original",
    status: "draft",
    chapterCount: 3,
    hookCount: 2,
    sceneSlotCount: 4,
    beatCount: 86,
    segmentCount: 5,
    shotCount: 12,
    characterCount: 3,
    artAssetCount: 3,
    updatedAt: "3 天前",
  },
]

export const chapters: Chapter[] = [
  { id: "chap-dk-1", storyId: "story-du-kou", index: 1, title: "第一章 · 雾锁渡口", hook: "旧皮箱与陌生船票" },
  { id: "chap-dk-2", storyId: "story-du-kou", index: 2, title: "第二章 · 河心无岸", hook: "货担里的秘密" },
  { id: "chap-dk-3", storyId: "story-du-kou", index: 3, title: "第三章 · 灯笼未燃", hook: "老周的四十年" },
  { id: "chap-dk-4", storyId: "story-du-kou", index: 4, title: "第四章 · 对岸芦苇", hook: "谁在等船靠岸" },
  { id: "chap-dk-5", storyId: "story-du-kou", index: 5, title: "第五章 · 反转戏", hook: "看不见的对岸" },
  { id: "chap-dk-6", storyId: "story-du-kou", index: 6, title: "第六章 · 离岸", hook: "没有说出口的来路" },
  { id: "chap-cy-1", storyId: "story-chang-ye", index: 1, title: "第一章 · 最后一班", hook: "宵禁前的邮包" },
  { id: "chap-cy-2", storyId: "story-chang-ye", index: 2, title: "第二章 · 街角盘查", hook: "信封上的旧地址" },
  { id: "chap-cy-3", storyId: "story-chang-ye", index: 3, title: "第三章 · 该去的地方", hook: "信到了，人没到" },
]

export const shots: Shot[] = [
  { id: "shot-dk-1-1", chapterId: "chap-dk-1", index: 1, shotType: "远景", duration: "4s", description: "浓雾中的渡口栈桥，老船夫已经在船头等候。", status: "approved" },
  { id: "shot-dk-1-2", chapterId: "chap-dk-1", index: 2, shotType: "中景", duration: "3s", description: "沈知微抱着旧皮箱，独自走上栈桥，脚步犹豫。", status: "approved" },
  { id: "shot-dk-1-3", chapterId: "chap-dk-1", index: 3, shotType: "特写", duration: "2s", description: "她攥紧箱柄，指节发白。", status: "generated" },
  { id: "shot-dk-1-4", chapterId: "chap-dk-1", index: 4, shotType: "近景", duration: "3s", description: "陆行远随后登船，右手始终揣在大衣口袋里。", status: "generated" },
  { id: "shot-dk-2-1", chapterId: "chap-dk-2", index: 1, shotType: "全景", duration: "5s", description: "船行至河心，四人分坐两侧，各自沉默。", status: "pending" },
  { id: "shot-dk-2-2", chapterId: "chap-dk-2", index: 2, shotType: "近景", duration: "3s", description: "胡二爷的货担压得船舷微微倾斜，铜铃轻响。", status: "pending" },
  { id: "shot-dk-2-3", chapterId: "chap-dk-2", index: 3, shotType: "特写", duration: "2s", description: "老周的独眼扫过船上众人，什么也没说。", status: "pending" },
  { id: "shot-dk-3-1", chapterId: "chap-dk-3", index: 1, shotType: "中景", duration: "4s", description: "船舱一角，未点燃的纸灯笼随水波晃动。", status: "pending" },
  { id: "shot-cy-1-1", chapterId: "chap-cy-1", index: 1, shotType: "远景", duration: "3s", description: "宵禁灯光下，邮差的自行车驶入空荡的街道。", status: "generated" },
  { id: "shot-cy-1-2", chapterId: "chap-cy-1", index: 2, shotType: "特写", duration: "2s", description: "邮包里最后一封信，地址已经被雨水晕开。", status: "pending" },
]

export const characters: Character[] = [
  { id: "char-dk-1", storyId: "story-du-kou", name: "沈知微", alias: "姑娘", weight: "protagonist", logline: "十九岁，抱着一只旧皮箱独自过河北上，把所有害怕都攥在发白的指节里。", voice: "轻而带气声的年轻女声", avatarUrl: null },
  { id: "char-dk-2", storyId: "story-du-kou", name: "陆行远", alias: "陆", weight: "major", logline: "二十七八岁的男人，右手一路揣在大衣口袋，隔着布也能看出握着什么硬东西。", voice: "干涩、聚焦的年轻中音", avatarUrl: null },
  { id: "char-dk-3", storyId: "story-du-kou", name: "老周", alias: "老伯", weight: "major", logline: "在这条河上摆了四十年渡的老船夫，一只眼睛是白的，一船人的来去他都看在另一只里。", voice: "沙哑低沉的男中低音", avatarUrl: null },
  { id: "char-dk-4", storyId: "story-du-kou", name: "胡二爷", alias: "胡", weight: "supporting", logline: "挑着两箱货、走一步响三声的胖货郎，一船人的沉默全靠他一个人填。", voice: "明亮、带金属芒的男高音", avatarUrl: null },
  { id: "char-dk-5", storyId: "story-du-kou", name: "阿禾", alias: "小丫", weight: "supporting", logline: "藏在货担夹层里的偷渡孩童，全程一言不发，只在雾散时露了一次脸。", voice: "极轻的气声，几乎听不清", avatarUrl: null },
  { id: "char-cy-1", storyId: "story-chang-ye", name: "陈延", alias: "老陈", weight: "protagonist", logline: "干了十六年的邮差，宵禁前最后一班永远是他自己申请的。", voice: "沉稳克制的中年男声", avatarUrl: null },
  { id: "char-cy-2", storyId: "story-chang-ye", name: "守卫班长", alias: "班长", weight: "major", logline: "街角盘查哨的班长，认得老陈，但今晚不打算通融。", voice: "生硬的公事公办男声", avatarUrl: null },
  { id: "char-cy-3", storyId: "story-chang-ye", name: "收信人", alias: "秀兰", weight: "supporting", logline: "信该送到的人，天亮前一直没睡，靠在门后听脚步声。", voice: "疲惫又警觉的女声", avatarUrl: null },
]

export const artAssets: ArtAsset[] = [
  { id: "art-dk-s01", storyId: "story-du-kou", code: "S01", kind: "scene", name: "渡船船舱", tag: "主场景", lighting: "晨雾 · 雾散近岸", description: "民国时期中国，旧式木质渡船客舱内部，帆布蓬下，六排磨损的长椅，蓬布一角有补丁。", prompt: "民国时期中国，旧式木质渡船客舱内部，帆布蓬下，六排磨损的长椅，篷布一角有补丁，一缕光从接缝漏入，船头带铜绿的青铜铃，船舷外晨雾弥漫，空荡场景，无人。", thumbnailUrl: null, updatedAt: "6 分钟前" },
  { id: "art-dk-s02", storyId: "story-du-kou", code: "S02", kind: "scene", name: "渡口栈桥", tag: "主场景", lighting: "浓雾清晨", description: "开场与收尾的门面景：一条探进雾里的旧木栈桥，岸端连着土坡，水端消失在白雾里。", prompt: "一座老旧木质渡口栈桥伸入浓密白雾，民国时期江南水乡河岸，第七块木板断裂处用绳索捆绑的原木修补，磨损的系船石墩，倾斜的灯笼杆挂着一盏未点燃的纸灯笼，湿漉漉的木板，空景无人。", thumbnailUrl: null, updatedAt: "42 分钟前" },
  { id: "art-dk-s03", storyId: "story-du-kou", code: "S03", kind: "scene", name: "对岸芦苇滩", tag: "变体 · S02", lighting: "薄雾午前", description: "第 5 集反转戏的远景背板：船过河心隐约可见的对岸。它只需要“存在感”，不需要细节。", prompt: "荒凉的芦苇荡河岸，隔水远望，民国时期江南，柔和的灰色芦苇带，渐薄的暖色薄雾，烂木船骨半埋在泥滩里，湿泥上的冷色反光，空景无人。", thumbnailUrl: null, updatedAt: "1 小时前" },
  { id: "art-dk-s04", storyId: "story-du-kou", code: "S04", kind: "scene", name: "渡船", tag: null, lighting: null, description: "渡船船舱是渡船内部结构的完整外景版本，用于船体全貌镜头。", prompt: "民国时期中国，旧式木质渡船，帆布蓬，船头带铜绿的青铜铃，船舷外晨雾弥漫，空荡场景，无人。远景，渡船外部结构完整清晰。", thumbnailUrl: null, updatedAt: "昨天" },
  { id: "art-dk-p01", storyId: "story-du-kou", code: "P01", kind: "prop", name: "旧皮箱", tag: "沈知微随身", lighting: null, description: "沈知微贯穿全片的随身道具，边角磨损、铜扣氧化，暗示长途跋涉。", prompt: "民国时期旧式牛皮箱，边角磨损露出内衬，铜扣氧化发绿，表面有雨渍水痕，空白背景产品图。", thumbnailUrl: null, updatedAt: "2 天前" },
  { id: "art-dk-p02", storyId: "story-du-kou", code: "P02", kind: "prop", name: "未点燃的纸灯笼", tag: "栈桥道具", lighting: null, description: "悬于栈桥灯笼杆上的信物道具，全片保持未点燃状态，收尾处是否点亮是关键悬念。", prompt: "民国时期竹骨纸灯笼，未点燃，纸面有雨渍晕染的墨迹，悬挂在倾斜的木杆上，空白背景产品图。", thumbnailUrl: null, updatedAt: "2 天前" },
  { id: "art-cy-s01", storyId: "story-chang-ye", code: "S01", kind: "scene", name: "宵禁街角哨卡", tag: "主场景", lighting: "夜 · 探照灯", description: "老陈每晚必经的盘查点，探照灯扫过湿漉漉的石板路。", prompt: "战时城市夜晚的街角哨卡，探照灯光柱扫过湿漉漉的石板路，沙袋工事，空景无人。", thumbnailUrl: null, updatedAt: "3 天前" },
  { id: "art-cy-p01", storyId: "story-chang-ye", code: "P01", kind: "prop", name: "邮差挎包", tag: "陈延随身", lighting: null, description: "老陈的帆布邮差包，边缘磨破，扣带用铁丝加固过。", prompt: "旧帆布邮差挎包，边缘磨破用麻线缝补，铁丝加固的扣带，空白背景产品图。", thumbnailUrl: null, updatedAt: "3 天前" },
]
