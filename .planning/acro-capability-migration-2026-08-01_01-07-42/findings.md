# 调研与结论：acro-capability-migration

- 任务 ID：`acro-capability-migration-2026-08-01_01-07-42`
- 创建时间：`2026-08-01_01-07-42`

## 需求事实

- 用户选择以 `harryisfish/magie`（`pingdotgg/t3code` Fork）继续开发，并要求立即优先实现“同一服务器多个 Host”和“Terminal 多端显示”。
- 用户希望完整保留 T3 的 UI/UX 与 Agent IDE 体验，同时吸收 Acro 的远程连接和原生 Terminal 优势。
- Acro Mobile 无历史兼容负担；但 Magie 当前已有独立 Web/Desktop/Mobile，能力应通过共享 contract/runtime 落到三端，而不是重建另一套客户端。

## 基线调用链（实现前）

- 多 Host：`BearerConnectionProfile` 目前只存 `httpBaseUrl/wsBaseUrl` → `ConnectionResolver.prepare` 只授权一个 endpoint → `ConnectionDriver.connect` 只打开一个 RPC Session → `EnvironmentSupervisor` 对同一个 entry 重试。
- 连接持久化：`ConnectionCatalogDocument` schemaVersion 1 直接编码 `ConnectionProfile`；增加 optional endpoint list 可兼容旧文档且无需全局 DB migration。
- 连接编辑：`ConnectionOnboarding.updateBearer` 是共享写入口；Mobile 已有 URL 编辑 UI，Web/Desktop 当前主要负责配对、展示、重连和移除。
- Terminal：`terminal.attach` → `apps/server/src/ws.ts` → `TerminalManager.attachStream`；Manager 对一个 session 支持多个 listener，并发送 snapshot 后 fan-out live event。
- Terminal 输入：Web 和 Mobile 都直接调用共享 `terminalEnvironment.write/resize` → RPC → `TerminalManager.write/resize`，当前没有 owner 门禁。
- 设备身份：每条 WebSocket 都有 `AuthenticatedSession.sessionId`；`SessionStore` 已按 sessionId 计数并区分最后一个连接断开，可直接作为控制 owner 生命周期基础。

## 调研结论

- T3 已具备“多端同时看”的传输基础，缺的是 Acro 的唯一输入/尺寸 owner 语义；无需重写 terminal stream。
- endpoint fallback 必须覆盖 `prepare`、socket opening 和 initial synchronization；只在 resolver 内换 URL 会遗漏 WebSocket 打开失败。
- 多入口仍属于一个 Environment，不能按 URL 创建多个 catalog target。
- Acro 的 focus owner、owner-only resize 和最后连接释放是已验证语义；本轮按 T3 Auth Session / Effect RPC 形状重新实现，不复制 Acro Swift/UI 或 GPL-derived 代码。
- Acro 的 detached daemon、snapshot/sequence 精确 replay 是下一增量；当前 T3 Server 重启仍会终止 live PTY，必须在交付中如实保留这个边界。
- `Machine → Environment`、`Session → TerminalSession`；Acro Workspace/WorkspaceGroup 和只读 Git 投影不迁入 Magie。
- 恢复执行时 worktree 已有未提交草案，不能把局部测试通过当作已交付；最终以完整 focused 回归、类型检查、diff 审计和 planning 收敛为准。
- 审计发现并修复了 `write` / `resize` 隐式 claim；RPC 调用现在必须先显式 claim，服务端 setup script 走 trusted `null` caller。
- Mobile 的真实全屏 Terminal 入口是 `ThreadTerminalRouteScreen`（由 `apps/mobile/src/Stack.tsx` 注册）；控制逻辑已落到该入口，无调用方 Panel 的草案改动已撤回。
- Web `ThreadTerminalDrawer`、`ChatView` 脚本路径和 Mobile initial input 均已覆盖 claim-before-write 与 observer 输入门禁。
- `Manager.test.ts` 已覆盖双 listener snapshot/live fan-out、owner-only write/resize、force takeover、自然退出后 reopen 的 viewer-relative control、迟到旧 owner release 和同 Session 控制释放。
- `EnvironmentSupervisor.prepared` 现在由 Web/Desktop 与 Mobile 设置行消费；连接到 fallback 时展示实际 active endpoint，Showcase 不再绕过 cosmetic 投影泄露真实地址。
- `releaseSessionControls` 在每个 Terminal 的 thread lock 内再次核对 owner，迟到的旧 owner release 不会覆盖新 controller。
- `SessionStore.markDisconnected` 在连接生命周期锁内执行最后断开 callback；同 Auth Session 重连必须等释放完成，避免清理新连接刚取得的控制权。
- Acro 的已验证语义是“静默默认 claim 只能拿无主会话，force takeover 必须来自遮罩按钮”；因此 Magie 可在首次 attach hydration 后对 `available` 发一次非 force claim，但后续 owner 释放时不应让所有 observer 自动竞抢，observer / available 都需保留显式 Take control 入口。
- `ProjectSetupScriptRunner` 是真实的服务端内部 Terminal writer。若用永久 pseudo Auth Session 兼容旧调用，它会留下无法由 WebSocket 生命周期释放的 owner；正确最小边界是让内部 writer 显式走 trusted `null` caller，而所有 RPC write / resize 都必须携带真实 Auth Session 并先 claim。
- 连接预算已下沉为每 endpoint 15 秒，Supervisor watchdog 覆盖最多 8 个候选；首入口卡住仍可在同一 attempt 轮换。
- endpoint 轮换使用严格 allowlist：仅 `network`、`timeout`、`transport`、`endpoint-unavailable`；`remote-unavailable` / `relay-unavailable` 回到 Supervisor backoff。
- WebSocket 初始 `server.getConfig` 会再次核对 Environment ID；HTTP 与 WS 指向不同 Server 时 fail closed。

## 技术决策

| 决策                                                       | 证据                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Bearer profile 保存有序 endpoints 并保留旧首 endpoint 字段 | `packages/client-runtime/src/connection/catalog.ts` 与 `platform/storageDocument.ts` 当前 schemaVersion 1 可直接兼容 optional 字段。 |
| Driver 顺序尝试 endpoint，Resolver 负责单 endpoint 授权    | socket opening 和 `session.ready` 都在 `connection/driver.ts`，这是覆盖完整失败窗口的最小共享切口。                                  |
| Terminal owner 使用 AuthSessionId                          | `apps/server/src/ws.ts` 已持有 currentSession；`SessionStore` 已对相同 sessionId 的并发 WebSocket 计数。                             |
| attach 不抢控制，新增 claim RPC                            | 当前多个客户端 attach 已可 fan-out；把观察与控制解耦才能避免移动端打开即 resize 桌面 PTY。                                           |
| 不新增 Acro Workspace 数据层                               | Acro 当前运行模型的 Workspace 只是 sessionIds/layout，T3 Thread 已拥有终端组与布局状态。                                             |

## 风险与边界

- 如果 endpoint 轮换只处理授权阶段，第一入口拿到 ticket 后 socket 失败会陷入同入口重试；测试必须覆盖 opening/synchronizing。
- 认证或 Environment ID 不匹配可能意味着错误服务器或凭据泄露风险，不能为了“可用性”继续尝试其他入口。
- 控制权是 Server 进程内临时状态；Server 重启后会清空，与当前 PTY 生命周期一致。
- Auth Session 是设备级近似；同一浏览器会话的多个窗口共享控制权，符合“同设备连接不互相抢占”的目标。
- Web/Desktop 与 Mobile 已复用共享 onboarding 编辑保存远端 URL；UI 不复制连接轮换逻辑。
- Fork 继承上游发布 workflow；本轮只 push feature branch，不打 tag、不合并 main、不触发任何生产发布。

## 参考指针

- Magie：`packages/client-runtime/src/connection/{catalog,resolver,driver,supervisor,onboarding}.ts`
- Magie：`packages/contracts/src/{terminal,rpc}.ts`
- Magie：`apps/server/src/{ws.ts,auth/SessionStore.ts,terminal/Manager.ts}`
- Magie：`packages/client-runtime/src/state/terminal*.ts`
- Magie：`apps/web/src/components/ThreadTerminalDrawer.tsx`
- Magie：`apps/mobile/src/features/terminal/ThreadTerminalRouteScreen.tsx`
- Acro：`packages/protocol/src/rpc.ts`、`apps/runtime/src/index.ts`、`apps/runtime/src/daemon/daemon.ts`、`apps/runtime/src/ws.ts`
- Acro memory：focus-owned resize regression and multi-device e2e, `MEMORY.md` Task Group lines 1579-1694。
