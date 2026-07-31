# 任务计划：acro-capability-migration

- 任务 ID：`acro-capability-migration-2026-08-01_01-07-42`
- 创建时间：`2026-08-01_01-07-42`

## 目标

以 T3 Fork（Magie）为唯一产品主线，先迁入 Acro 最核心且不会复制 T3 领域模型的两个能力：

1. 一个已保存的远程 Environment 可配置多个有序 Host / URL，当前入口不可用时自动尝试下一个入口，Environment、Project、Thread 与 Terminal 身份不变。
2. 同一个 Terminal 可在 Web / Desktop / Mobile 多端同时显示；服务端只允许当前控制者输入和调整 PTY 尺寸，其他客户端保持只读观察。

## 范围

- 扩展共享 connection profile，使 Bearer Environment 保存多个 endpoint，并兼容现有单 endpoint 文档。
- 在一次连接尝试内覆盖授权、WebSocket 打开和初始同步三个阶段的 endpoint 轮换；配置、认证或 Environment ID 不匹配时停止轮换。
- 更新现有连接编辑入口与展示投影；Web、Electron Desktop 和 Mobile 共用 `packages/client-runtime` 的连接模型。
- 扩展 Terminal RPC、服务端 `TerminalManager` 与共享客户端状态，加入控制权声明、控制状态投影及 owner-only write / resize。
- 保留现有 snapshot-first attach 和多订阅 fan-out，并以两个并发订阅的回归测试证明多端同时显示。
- 在最后一个属于控制者 Auth Session 的 WebSocket 断开后释放其控制权。
- 更新用户可见文档和内部架构说明，只记录本轮已经交付的行为。

## 非目标

- 本轮不迁入 detached terminal daemon，不承诺 Server 进程重启后 PTY 仍存活；这是后续独立增量。
- 本轮不迁入 Acro 的 Workspace、Session、Project registry、Git 或 Worktree 状态；T3 的 Environment / Project / Thread / Terminal 是唯一真相源。
- 本轮不实现 E2EE、RuntimeHub、Browser、Simulator、Computer Use 或 Structured / Terminal 同进程双向接管。
- 本轮不迁移 `~/.t3`、`~/.acro` 数据，不触碰 Acro 正在运行的 daemon 与 live PTY。
- 本轮不改品牌、签名、Updater、npm / Expo 身份，不发布、不部署、不创建 PR。

## 关键约束

- 保持 T3 现有 UI/UX、Event Sourcing、Provider、Git、Diff 与终端渲染路径；复杂性放在 connection 和 terminal adapter 边界。
- `environmentId` 与 `connectionId` 是稳定身份；endpoint 只是同一服务器的访问路径，切换不得创建第二个 Environment。
- 旧 `{ httpBaseUrl, wsBaseUrl }` profile 必须可继续解码和连接；新增保存格式不得读取或写入真实 `~/.t3/userdata`。
- endpoint 只在可重试的 network / timeout / transport / endpoint-unavailable 失败时轮换；authentication / configuration / permission / unsupported 必须 fail closed。
- Terminal 控制者以服务端认证 Session 标识；attach 不隐式抢占，显式 claim 才改变控制者。
- 多端显示不能让观察端 resize 改变操作者看到的终端尺寸。
- 共享 contract 变更必须同时覆盖 Server、Web/Desktop 和 Mobile；只运行针对性测试，不运行 repo-wide check。
- 保持上游代码形状和 MIT 边界；不直接复制 Acro 的 GPL / cmux-derived Swift 代码。

## 修改路径

1. `packages/client-runtime/src/connection/`：endpoint 模型、旧数据兼容、连接轮换、编辑输入与展示。
2. `apps/mobile/src/features/connection/` 与必要的 Web 连接设置表面：多 URL 编辑和当前入口展示。
3. `packages/contracts/src/terminal.ts`、`packages/contracts/src/rpc.ts`：控制权 contract、事件和 RPC。
4. `apps/server/src/terminal/Manager.ts`、`apps/server/src/ws.ts`、`apps/server/src/auth/SessionStore.ts`：控制状态、写入/尺寸门禁和断线释放。
5. `packages/client-runtime/src/state/terminal*.ts`、Web / Mobile Terminal 表面：控制状态投影、显式 claim、观察模式。
6. 对应 focused tests 与 `docs/user` / `docs/internals` 文档。

## 验证方式

- Connection：运行 catalog/storage、onboarding、resolver/driver/supervisor 的针对性测试，覆盖旧单 URL 解码、顺序尝试、第一入口授权失败、第一入口 WebSocket/同步失败、blocked 错误停止轮换。
- Terminal contract/state：运行 contracts 与 client-runtime 的针对性测试。
- Terminal server：运行 `Manager.test.ts`、Auth/WS 相关 focused tests，覆盖两个 attach 同时收到 snapshot/live、owner-only write/resize、抢占、同一 Auth Session 多连接和最后断开释放。
- UI：运行受影响 Web/Mobile 文件的 targeted typecheck/test；不启动浏览器或 Computer Use。
- 交付：检查 diff、staged 文件、planning 完整性；commit 并 push 当前分支，不创建 PR。

## 验收标准

- 旧的单 URL 已保存 Environment 无需迁移即可正常连接。
- 新 profile 可保存至少两个有序 URL；第一个入口不可达时同一连接动作自动连到第二个入口。
- 任一入口返回认证、权限、配置或 Environment ID 不匹配时不继续探测其他入口。
- failover 前后 `environmentId`、Project、Thread、Terminal ID 和路由不变，并可展示实际连上的 endpoint。
- Web/Desktop 与 Mobile 同时 attach 同一 Terminal 时都收到同一初始 snapshot 和后续 output。
- 未持有控制权的客户端不能写入或 resize；显式 claim 后新 owner 可操作，旧 owner 立即变为观察者。
- 同一 owner 的一条连接断开不会释放控制；该 Auth Session 的最后连接断开后控制权释放。
- 本轮涉及的 focused tests 和类型检查全部通过，planning 检查通过，分支已 commit / push。

## 未确认事项

没有则写“无”。

- 无。默认采用 Acro 已验证的“显式抢占、最后连接断开才释放”语义；后续 detached daemon 增量再处理 Server 重启后的 PTY 和精确 replay。

## 执行状态

- [x] 完成只读探索并确认真实调用链
- [x] 完成实现
- [x] 完成验证
- [x] 完成交付前收敛检查

## 决策

| 决策                                                    | 理由                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 以 T3 Fork 为唯一产品主线                               | 可直接保留完整 T3 Web/Desktop/Mobile UI/UX 与上游历史，Acro 只提供差异化底层能力。                   |
| Machine 映射为 Environment；不迁 Acro Workspace/Session | T3 已有 Project/Thread/Terminal 真相源；复制 Acro 聚合模型会产生双状态和删除语义冲突。               |
| 多 Host 先落在 Bearer profile                           | 自定义 LAN / 公网入口实际走已保存 Bearer Environment；Primary、Relay、SSH 各有独立平台管理路径。     |
| Terminal attach 与 control 分离                         | 多端默认都能看，只有显式 claim 才能输入和 resize，避免打开页面即抢走控制权。                         |
| 当前 Auth Session 作为设备级 owner                      | T3 已用 Auth Session 稳定标识配对客户端，并统计同 Session 的 WebSocket 数量，无需新增设备注册系统。  |
| detached daemon 延后                                    | 当前 T3 已具备多订阅 snapshot/live fan-out；先补控制权是最小完整增量，PTY 持久化可独立替换 backend。 |

## 错误与处理

| 错误                                       | 尝试 | 处理结果                                                           |
| ------------------------------------------ | ---: | ------------------------------------------------------------------ |
| 当前 shell 找不到 `vp`                     |    1 | 改用仓库锁定的 `pnpm exec vp`，未修改 lockfile。                   |
| Resolver endpoint 一度被推断为可空         |    1 | 收紧 helper 为非空 tuple，五包 typecheck 通过。                    |
| Showcase 绕过 cosmetic URL 显示真实入口    |    1 | Showcase 行隐藏 live active endpoint，保留真实多 URL 保存。        |
| live `started` snapshot 固定为 `available` |    1 | 改为按 viewer Auth Session 投影，并补 exit → open 双 viewer 回归。 |
