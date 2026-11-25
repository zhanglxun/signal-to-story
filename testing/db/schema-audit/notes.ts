/**
 * Human-written meaning of every table and column, merged with the real catalog by build.ts.
 * Types, keys and constraints are NOT written here: they come from the migrations (PGlite).
 * A column missing here shows up as "（未写说明）" on the page and fails the build check.
 */

export type Fate = "保留" | "改造" | "重写" | "新建" | "退役" | "不上线"

export interface TableNote {
  purpose: string
  fate: Fate
  /** What happens to the table in 0.5 (database.md §3). */
  fateNote?: string
  /** Reply to the reviewer's round-1 comment (database.md §9.1). */
  reply?: string
  cols: Record<string, string>
}

export interface PlannedColumn {
  name: string
  type: string
  keys: string
  note: string
  meaning: string
}

export interface PlannedTable {
  name: string
  kind: "table" | "view"
  purpose: string
  fateNote: string
  reply?: string
  cols: PlannedColumn[]
}

export interface Category {
  key: string
  title: string
  intro: string
  tables: string[]
}

/** Columns that mean the same thing everywhere; a table entry overrides them. */
export const COMMON: Record<string, string> = {
  organization_id: "所属组织（租户隔离键）。RLS 按它判断当前用户在该组织的权限；表间外键带上它，防止跨组织引用",
  created_by: "创建人（auth.users.id）",
  created_at: "创建时间（服务端 now()）",
  updated_by: "最后修改人",
  updated_at: "最后修改时间（触发器维护）",
}

export const CATEGORIES: Category[] = [
  {
    key: "base",
    title: "基座：组织、权限、审计",
    intro: "所有业务表都挂在组织下；权限由角色的权限点数组决定，RLS 统一调用 private.has_organization_permission。",
    tables: ["organizations", "profiles", "organization_members", "organization_roles", "audit_events"],
  },
  {
    key: "intake",
    title: "资讯收集",
    intro: "MVP：所有入口（Web、IM、API、Chat）统一写 intake_events（11 列，其余进 payload）；IM 也只是一种连接。",
    tables: [
      "intake_events",
      "source_categories",
      "intake_connections",
    ],
  },
  {
    key: "board",
    title: "看板 / 事项",
    intro: "MVP：一张卡一行，status 直接决定看板列；不建看板视图（R1）。",
    tables: ["work_items"],
  },
  {
    key: "content",
    title: "内容生产",
    intro: "只有 content_documents 一张表，它同时是稿件和发布记录（published_* 列，DB4）；不存历史版本（R2），审核历史进 audit_events，AI 直接写草稿（base_revision 防覆盖）。",
    tables: [
      "content_documents",
    ],
  },
  {
    key: "exec",
    title: "Agent 执行",
    intro: "DB2c-1 已实施：agent_jobs 21 列、步骤 10 列；批准和提问共用一张表；通知靠 notified_at，不建 outbox（R4）。",
    tables: ["agent_jobs", "agent_job_steps", "approval_requests", "runner_nodes"],
  },
  {
    key: "chat",
    title: "Chat",
    intro: "DB3 已建表：界面在 Console，循环和执行在 workers/agent（R3）；每个回合是一条 agent_jobs(kind = chat_turn)。",
    tables: ["chat_sessions", "chat_messages"],
  },
  {
    key: "knowledge",
    title: "知识与记忆",
    intro: "知识库和决定记忆不建表，worker 直接读仓库 knowledge-base/ 文件（R8）；prompt_examples 已上线，保留不动。",
    tables: ["prompt_examples"],
  },
  {
    key: "video",
    title: "视频",
    intro: "DB5 已实施：只有计划和镜头两张表；AI 直接写草稿分镜（write_video_draft），render_status 就是进度；预估费用在付费渲染审批的 payload 里（R5、R6）。",
    tables: ["video_plans", "video_shots"],
  },
  {
    key: "assets",
    title: "资产与系统配置",
    intro: "媒体二进制在对象存储，这里只存元数据和存储配置。",
    tables: ["assets", "storage_provider_configs"],
  },
]

/** Row counts in the live project (database.md §1.1, snapshot 2026-11-16). */
export const LIVE_ROWS: Record<string, number> = {
  organizations: 1, profiles: 2, organization_members: 2, organization_roles: 4, audit_events: 2,
  assets: 2, storage_provider_configs: 2, prompt_examples: 5,
  source_categories: 10, signals: 33, selections: 4,
  content_projects: 1, content_documents: 3, content_revisions: 6, content_review_events: 9, content_ai_proposals: 0, content_project_assets: 0,
  publishing_channels: 0, content_publications: 0, publication_metrics: 0,
  intake_connections: 1, intake_receipts: 2, intake_oauth_requests: 0, intake_oauth_grants: 0, intake_oauth_tokens: 0,
}

/** Column-level 0.5 plans shown as a badge next to an existing column. */
export const COLUMN_PLANS: Record<string, string> = {}

/** Columns added to existing tables in DB2–DB5 (database.md §4.4). */
export const PLANNED_COLUMNS: Record<string, PlannedColumn[]> = {}


export const PLANNED_TABLES: PlannedTable[] = []

export const TABLES: Record<string, TableNote> = {
  chat_sessions: {
    purpose: "Chat 会话；可以挂在某张事项卡上，在卡上和 AI 对话",
    fate: "新建",
    fateNote: "DB3 已建（database.md §4.5）；只有所有人可读写自己的会话",
    cols: {
      id: "主键",
      owner_id: "会话所有人（插入时取当前用户，不可修改）",
      work_item_id: "在哪张卡上聊（可空）",
      title: "会话标题",
      exec_session: "驱动、原生会话 id 等续接信息（只能由服务端写）",
      last_seq: "最后一条消息的序号（服务端在会话行锁下递增）",
      archived_at: "归档时间；归档后不能再发消息",
      runtime_config: "上次选用的节点 / 运行时 / 模型 / 推理强度（DB3b；浏览器可改，发消息时也会同步）",
    },
  },
  chat_messages: {
    purpose: "Chat 消息，只追加；user 消息只能经 send_chat_message 写，assistant 消息只能由执行节点写",
    fate: "新建",
    fateNote: "DB3 已建（B8：seq 由 RPC 锁会话行分配）",
    cols: {
      id: "主键",
      session_id: "所属会话",
      seq: "会话内序号（服务端分配）",
      role: "user / assistant / system / tool",
      content: "消息内容",
      agent_job_id: "这条消息对应的回合任务（kind = chat_turn）",
      parts: "结构化片段（思考、计划、工具调用、报错、引用芯片），刷新后还原界面用（DB3b）",
      status: "completed / cancelled / error：回合正常结束、被中断或出错（DB3b）",
      reply_to_message_id: "助手消息回复的是哪条 user 消息；重新生成的多个版本指向同一条（DB3b）",
    },
  },
  intake_events: {
    purpose: "一条外部输入一行，不可变：Web 速记、IM 消息、外部 API、Chat 里的「帮我做这个」都写这里",
    fate: "新建",
    fateNote: "DB2a 已建（20261115090000_mvp_core）；取代 signals、intake_receipts、quick_captures",
    reply: "R11 采纳：18 列减到 11 列；strength / intent / disposition / actor / legacy / reply_to 都并入 payload，去向由 work_item_id 和 ignored_at 表达",
    cols: {
      id: "主键",
      source: "从哪类入口来",
      connection_id: "经哪个连接进来（IM 机器人也是一种连接）",
      external_id: "来源内的事件 id，重复推送只收一次",
      text: "原始文本",
      url: "原始链接",
      payload: "其余全部：附件引用、发送者、reply_to 回复地址、intent、回填来源 legacy",
      work_item_id: "归入哪个事项",
      ignored_at: "人忽略这条输入的时间",
      created_by: COMMON.created_by,
    },
  },
  work_items: {
    purpose: "看板上的一张卡（选题 / 事项）；status 直接决定在哪一列",
    fate: "新建",
    fateNote: "DB2a 已建（20261115090000_mvp_core）；取代 selections、content_projects",
    reply: "R1 采纳：看板视图不做，status 直接存列，由人拖卡和少数 RPC（入队、提问、写完草稿）写入",
    cols: {
      id: "主键",
      kind: "产出形态",
      title: "选题标题",
      brief: "Brief：角度、平台、content_kind、target_seconds、aspect_ratio、旧 Brief 文本、回填来源 legacy",
      category_id: "分类",
      status: "看板列：待办、AI 在做、等你回答或批准、待审核、完成、放弃",
      created_by: COMMON.created_by,
      updated_at: COMMON.updated_at,
    },
  },
  // ── 基座 ─────────────────────────────────────────────
  organizations: {
    purpose: "组织（租户）。所有业务数据都挂在某个组织下",
    fate: "保留",
    cols: { id: "主键", slug: "组织短名（URL 用，全局唯一）", name: "组织显示名", domain: "组织域名（可选，例如 susense.cn）" },
  },
  profiles: {
    purpose: "后台账号资料，与 auth.users 一对一",
    fate: "保留",
    cols: {
      user_id: "主键，等于 auth.users.id",
      email: "登录邮箱（小写去空格，全局唯一）",
      display_name: "显示名",
      status: "账号状态：active 正常 / suspended 停用（停用后 RLS 不再放行）",
    },
  },
  organization_members: {
    purpose: "组织成员关系：哪个账号在哪个组织里担任什么角色",
    fate: "保留",
    cols: { user_id: "成员账号（auth.users.id）", role: "角色键，对应 organization_roles.role_key", created_by: "谁把他加进来的" },
  },
  organization_roles: {
    purpose: "组织内的角色定义和权限点；系统预置 owner / admin / editor / viewer 等",
    fate: "保留",
    cols: {
      role_key: "角色键（小写下划线），组织内唯一",
      name: "角色显示名",
      description: "角色说明",
      permissions: "权限点数组，例如 content.manage、content.review；RLS 按它判断",
      assignment_permission: "要把这个角色分配给别人，操作者自己需要的权限点",
      is_system: "系统预置角色，不能删除或改键",
      is_assignable: "是否允许在界面上分配给成员",
      sort_order: "列表排序",
    },
  },
  audit_events: {
    purpose: "审计日志：敏感操作（审批、回答、权限变更等）追加写入，不修改",
    fate: "保留",
    cols: {
      id: "自增主键",
      actor_user_id: "操作人；系统或节点操作时为空",
      action: "动作，例如 approval.decided、question.answered",
      target_type: "对象类型",
      target_id: "对象 id（文本，兼容 uuid 和 bigint）",
      metadata: "补充信息（JSON 对象）",
    },
  },

  // ── 资讯收集 ─────────────────────────────────────────
  source_categories: {
    purpose: "信源 / 事项分类，最多两级（parent_id）",
    fate: "保留",
    fateNote: "0.5 作为 work_items 的分类继续用",
    cols: {
      id: "自增主键",
      parent_id: "父分类；为空表示一级分类（不能指向自己）",
      name: "分类名（≤36 字）",
      icon_url: "图标地址",
      sort_order: "同级排序",
      is_active: "是否启用；停用代替删除",
      description: "分类说明",
    },
  },
  intake_connections: {
    purpose: "外部收录连接：给外部工具（Dot、通用 webhook、飞书、企微）发的令牌",
    fate: "保留",
    cols: {
      id: "主键",
      created_by: "创建连接的人",
      name: "连接名",
      adapter: "适配器类型：dot / generic / feishu / wecom",
      token_hash: "令牌的 sha256；明文只在创建时显示一次",
      expires_at: "过期时间（默认 30 天）",
      revoked_at: "吊销时间；非空即失效",
    },
  },

  // ── 内容生产 ─────────────────────────────────────────
  content_documents: {
    purpose: "稿件：某张事项卡在某个平台的一份当前稿（master 为母稿）；同时是发布记录",
    fate: "改造",
    fateNote: "DB2：改挂 work_item_id；发布列 published_* 并入本表（读者站和外部发布都看这里）；AI 写草稿走 write_document_draft(base_revision)",
    reply: "R7：本表同时承担发布记录，读者站直接读已发布列，不再建成果表",
    cols: {
      id: "主键",
      work_item_id: "稿件属于哪张事项卡（必填；V1 的 project_id 已在退役迁移中回填并删除）",
      platform: "平台：master 母稿 / wechat_channels / wechat_official / xiaohongshu / douyin / x / youtube / reddit",
      title: "当前标题",
      body: "当前正文（Markdown，≤10 万字）",
      status: "审核状态：draft / in_review / approved / changes_requested；正文变化自动回到 draft",
      revision: "当前版本号；标题或正文变化时由触发器 +1（只计数，不存历史快照）",
      review_note: "最近一次审核意见；必须随审核决定一起提交",
      published_revision: "读者站上线的是哪个版本（只能由 publish_document 写）",
      published_title: "发布时的标题快照；改稿不影响线上",
      published_body: "发布时的正文快照；anon 只能读这类 published_* 列",
      published_meta: "发布展示信息：摘要、内容形式、封面、媒体、来源引用",
      published_at: "读者站上线时间；为空 = 未发布或已下线（RLS 只给 anon 放行非空的行）",
      published_url: "人工发布到外部平台后回填的链接（set_document_published_url）",
      slug: "读者站 URL 路径名；组织内唯一",
    },
  },

  // ── 发布与复盘 ───────────────────────────────────────

  // ── 读者站（本地，不上线）─────────────────────────────

  // ── Agent 执行 ───────────────────────────────────────
  agent_jobs: {
    purpose: "Agent 持久任务队列：入队 → 节点认领（lease_epoch +1）→ 心跳 → 回写结果；目标、批准、上限在 payload，用量从步骤推出",
    fate: "重写",
    fateNote: "DB2c-1 已实施：21 列；删掉的列及去向见 docs/database.md §4.4",
    reply: "R9：精简采纳。看板关联需要，只要一个 work_item_id——卡片显示「AI 在做 / 等你」、同一事项不并发都靠它",
    cols: {
      id: "主键",
      work_item_id: "属于哪张看板卡；任务状态变化同步卡片列（done / dropped 不动）；同一卡同时最多一个运行中的非 Chat 任务",
      kind: "任务类型，例如 content_draft、video_storyboard、chat_turn（原 job_type）",
      status: "queued / running / pending_review / blocked_needs_human / succeeded / failed / cancelled",
      payload: "任务输入（≤256KB）；target = {type, id, revision?} 被处理对象，approval_request_id 门禁批准，limits = {max_rounds, max_hops, budget_cents, token_budget?} 上限",
      result: "任务结果；旧行的进度列保存在 result.legacy_columns",
      idempotency_key: "幂等键（组织内唯一），重复入队返回同一任务",
      attempts: "已尝试次数（= 0 表示从未被认领）",
      max_attempts: "最多尝试次数",
      run_after: "最早可执行时间（重试退避）；认领按 run_after、created_at 先进先出",
      node_id: "当前认领的节点（FK → runner_nodes，节点删除时置空；离开 running 后清空）",
      locked_until: "租约到期时间；过期可被其他节点重新认领",
      lease_epoch: "租约代数：每次认领 +1；心跳、步骤、完成、失败、提问都必须带当前值，旧节点的迟到写入被拒",
      cancel_requested_at: "人请求取消的时间；节点在下一步检查后停止",
      notified_at: "「需要人处理」的通知已发出的时间；状态变化时清空（取代 outbox）",
      error: "错误信息",
      error_code: "错误码，例如 needs_answer、budget、stale_target",
      created_by: "入队人",
    },
  },
  agent_job_steps: {
    purpose: "任务的每一步一行，只追加；循环从最后一步恢复，任务的轮次、用量、耗时都从这里推出",
    fate: "重写",
    fateNote: "DB2c-1 已实施：10 列，只能经 record_agent_job_step（带 lease_epoch）写入",
    reply: "R10 采纳",
    cols: {
      id: "主键",
      job_id: "所属任务",
      seq: "第几步（每个任务从 1 递增，UQ(job_id, seq)）",
      kind: "context / fetch / generate / check / persist（check 的 output.stage = precheck / evaluate）",
      status: "succeeded / failed",
      output: "输出；含 round、stage、input_digest、input_summary、evaluation",
      usage: "用量：input_tokens、output_tokens、cost_cents、model、driver、duration_ms",
      error: "错误信息",
    },
  },
  runner_nodes: {
    purpose: "执行节点身份：每台跑 worker 的电脑或容器一个可吊销令牌，取代 worker 持有 service_role",
    fate: "新建",
    fateNote: "DB2c-2 已建（20261124100000_runner_nodes）；DB-D16：令牌由数据库 node_* RPC 直接校验，不再经 Edge Function 代理；MVP 去掉 allowed_job_types",
    cols: {
      id: "主键",
      organization_id: "所属组织；节点只能认领本组织的任务",
      name: "节点名（例如某台电脑）；未吊销的节点在组织内不重名",
      token_hash: "节点令牌的 sha256；明文只在创建时显示一次，浏览器读不到这一列",
      revoked_at: "吊销时间；吊销后令牌的所有调用都被拒绝",
      last_seen_at: "最近一次调用数据库的时间；两分钟内算在线",
      created_at: "创建时间",
      capabilities: "节点上报的能力目录（运行时、模型、HTTP 入口地址），不含任何密钥（DB3b）",
      capabilities_updated_at: "能力目录最近一次上报时间（DB3b）",
    },
  },
  approval_requests: {
    purpose: "Mandate 人工批准与 Agent 提问：只能经 RPC 写入，只有登录的人能决定或回答",
    fate: "重写",
    fateNote: "DB1 已加提问；DB2c-1 加 notified_at（取代 outbox）；预估费用并入 payload 待后续",
    reply: "R4：outbox 去掉，通知靠这里和 agent_jobs 的 notified_at",
    cols: {
      id: "主键",
      kind: "approval 批准 / question 提问",
      action: "批准的动作：publish_external / publish_site / paid_video_render / rotate_credentials / delete_project / change_org_permissions（提问时为空）",
      target_type: "对象类型",
      target_id: "对象 id",
      target_revision: "批准绑定的版本；对象改了批准自动失效",
      question: "提问内容：title、options、recommended",
      answer: "人的回答：text",
      status: "pending / approved / rejected / answered / expired",
      summary: "列表里显示的摘要",
      payload: "批准时需要的参数（例如发布渠道）",
      estimated_cost_cents: "预估费用（付费渲染）",
      requested_by_job: "由哪个任务发起（任务的 payload.approval_request_id 是正向引用）",
      requested_by: "由哪个人发起",
      decided_by: "决定 / 回答的人",
      decided_at: "决定时间",
      reason: "决定理由",
      expires_at: "过期时间（默认 7 天）",
      notified_at: "待办通知已发出的时间；为空且 pending = 待通知（取代 outbox）",
    },
  },

  // ── 知识与记忆 ───────────────────────────────────────
  prompt_examples: {
    purpose: "提示词示例库（主要是生图提示词和示例图）",
    fate: "保留",
    fateNote: "已上线 5 行、V1 有页面；保留不动、不再投入",
    reply: "R8：删除就要删数据，建议保留不动，请确认",
    cols: {
      id: "自增主键",
      title: "标题",
      prompt_text: "提示词正文",
      negative_prompt: "反向提示词",
      example_image_url: "示例图外部地址",
      example_asset_id: "示例图对应的资产",
      source_url: "来源链接",
      source_author: "来源作者",
      origin_type: "collected 收集 / self_created 自创",
      tags: "标签（≤12 个）",
      status: "inbox 待整理 / curated 已整理 / archived",
      visibility: "private 仅自己 / shared 组织内共享",
      notes: "备注",
      example_storage_path: "示例图在存储桶里的路径",
    },
  },

  // ── 视频 ─────────────────────────────────────────────
  video_plans: {
    purpose: "视频分镜计划；任何分镜内容变化都会递增 revision，付费渲染批准绑定 (计划, revision)",
    fate: "重写",
    fateNote: "DB5：改挂 work_item_id；AI 直接写 draft 计划；DB1 已改资产复合外键",
    reply: "R5：分镜提案表不做，AI 直接写本表",
    cols: {
      id: "主键",
      work_item_id: "视频计划属于哪张事项卡（取代 project_id）",
      source_document_id: "来源稿件",
      source_document_revision: "来源稿件版本",
      title: "计划标题",
      aspect_ratio: "画幅 9:16 / 16:9 / 1:1",
      target_seconds: "目标时长（3–600 秒）",
      style: "整体视觉风格描述",
      default_voice: "默认配音音色",
      tts_provider: "配音服务：edge_tts / cloud_tts",
      bgm_track: "背景音乐",
      status: "draft / rendering / rendered / failed / archived",
      revision: "计划版本号",
      composed_video_asset_id: "合成成片资产（组织内）",
      final_duration_ms: "成片实际时长",
      error: "失败原因",
    },
  },
  video_shots: {
    purpose: "分镜镜头：内容列由人编辑；渲染状态、资产、实际时长、成本由 worker 回写",
    fate: "重写",
    fateNote: "DB5：去掉成本列；render_status 就是进度",
    reply: "R6：进度复用本表",
    cols: {
      id: "主键",
      plan_id: "所属计划",
      position: "镜头顺序（计划内唯一，可延迟检查便于调序）",
      shot_size: "景别：extreme_wide / wide / full / medium / close_up / extreme_close_up",
      camera_motion: "运镜：zoom_in / zoom_out / pan_left / pan_right / pan_up / static",
      motion_mode: "动态方式：local_ken_burns 本地推拉 / cloud_video_model 云端视频模型（付费）",
      visual_prompt: "画面提示词",
      narration: "旁白",
      voice: "本镜头音色（为空用计划默认）",
      sfx_description: "音效描述",
      target_duration_ms: "目标时长",
      actual_duration_ms: "实际时长",
      keyframe_asset_id: "关键帧图资产",
      audio_asset_id: "配音资产",
      video_asset_id: "镜头视频资产",
      render_status: "pending / queued / rendering / rendered / failed",
      estimated_cost_cents: "预估费用（分）",
      actual_cost_cents: "实际费用（分，由账本汇总）",
      error: "失败原因",
    },
  },

  // ── 资产与配置 ───────────────────────────────────────
  assets: {
    purpose: "资产元数据（角色、场景、道具、声音、风格、视频工坊生成物）；二进制在对象存储",
    fate: "保留",
    cols: {
      id: "自增主键",
      asset_type: "业务分类：character / scene / prop / sound / style / video_studio",
      category: "二级分类，例如 food；video_studio 下为 keyframe / voiceover / shot_clip / final_video",
      media_type: "媒介：image / audio / video / model / document / other",
      name: "资产名",
      cloud_url: "对象存储或受控外部地址",
      local_path: "仅供受控执行端使用的本机路径，不向普通 Web 查询开放",
      thumbnail_url: "预览图地址",
      is_active: "启用状态；停用代替物理删除",
      description: "说明",
      metadata: "补充元数据",
      search_text: "生成列：名称 + 分类 + 描述，用于搜索",
    },
  },
  storage_provider_configs: {
    purpose: "对象存储配置（每个组织每种服务商一条）；密钥不在这里",
    fate: "保留",
    cols: {
      id: "自增主键",
      provider: "supabase / qiniu_kodo / aliyun_oss / tencent_cos / cloudflare_r2",
      bucket: "存储桶名",
      object_prefix: "对象路径前缀",
      endpoint: "服务端点",
      public_base_url: "公开访问的基础地址",
      status: "ready 可用 / pending_secret 待配置密钥 / disabled",
      is_default: "是否为组织默认存储",
    },
  },
}
