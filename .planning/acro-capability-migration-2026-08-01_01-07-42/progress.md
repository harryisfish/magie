# 执行进度：acro-capability-migration

- 任务 ID：`acro-capability-migration-2026-08-01_01-07-42`
- 创建时间：`2026-08-01_01-07-42`
- 当前状态：`ready_for_delivery`

## 已完成

- 创建 Magie Fork、配置 `origin` / `upstream`，固定上游基线 `a041981276b4c789fed8132e3b8a320749bf25e8`。
- 创建隔离 worktree 和 planning 三文件，验证项目基线有效。
- 核对 T3 与 Acro 的连接、Terminal、Workspace、Surface、迁移和发布边界。
- 确认本轮只实现多 Host fallback 与 Terminal 多端控制语义，不迁第二套 Workspace/Session 状态。
- 完成多 endpoint Bearer profile：兼容旧单 endpoint 文档，最多保存 8 个有序 URL。
- 完成一次连接动作内的 endpoint 轮换，覆盖授权、WebSocket 打开与初始同步；blocked 错误停止轮换。
- Web/Desktop 与 Mobile 的 Environment 设置均可按行编辑多个 URL，并展示 fallback 数量。
- 将连接超时下沉为每 endpoint 15 秒预算，Supervisor 仅保留覆盖最多 8 个 endpoint 的 watchdog，首入口卡住不再阻断后续入口。
- 将 endpoint 轮换限制为 network / timeout / transport / endpoint-unavailable；remote-unavailable 与所有 blocked 错误停止探测。
- WebSocket 初始 `server.getConfig` 会再次核对 Environment ID，不匹配时 fail closed。
- Web/Desktop 与 Mobile 的 Environment 设置会消费 active prepared connection；连到 fallback 时可显示实际 endpoint。Showcase 投影不再覆盖未命中环境的 fallback 列表。
- legacy 首 endpoint 始终是新旧客户端共同的第一真相；URL 上限在规范化去重后执行，真实 JSON roundtrip 兼容测试已覆盖旧文档。
- 完成 Terminal control contract、viewer-relative attach 投影、服务端 owner 门禁、force takeover 与最后 Auth Session 连接断开释放。
- `write` / `resize` 不再隐式 claim；Web/Desktop 与真实 Mobile Route 首次 hydration 可静默领取无主 Terminal，observer / released 状态提供显式 Take control，观察端输入和尺寸上报均被拦截。
- `terminal.open` 对运行中 PTY 的 resize / launch-context 变更服从 controller；服务端 setup script 使用显式 trusted caller，不会留下永久 pseudo owner。
- 双 attach 回归证明两个客户端收到同一 snapshot 和 live output；takeover 后旧 owner 立即投影为 observer，断线释放后投影为 available。
- 自然退出后重新 open 的 live snapshot 会按 viewer Auth Session 保留 `controller` / `observer` 真相，不再固定投影为 `available`。
- Showcase 环境不会通过 live prepared connection 绕过 cosmetic URL 映射；只改 label 时仍保存完整真实 fallback URL 列表。
- 更新用户远程访问文档、connection runtime、remote architecture 与 glossary，并保留 Server 重启不保活 PTY 的非目标边界。

## 进行中

- 无；代码、文档、验证和交付前 diff 审计已完成，等待只读 preflight、commit 与 push。

## 修改文件

- `.gitignore`：忽略仓库本地 `.worktrees/`。
- `.planning/acro-capability-migration-2026-08-01_01-07-42/{task_plan,findings,progress}.md`：本任务持久化计划。
- `packages/client-runtime/src/connection/*`、`rpc/session*`、`platform/storageDocument.test.ts`：多 endpoint schema、旧数据兼容、轮换、预算、Environment ID 复核、展示与回归。
- `packages/contracts/src/{terminal,rpc,ipc}.ts`、`packages/client-runtime/src/state/terminal*.ts`：Terminal control contract、RPC 与客户端投影。
- `apps/server/src/{terminal/Manager*,auth/SessionStore*,auth/RpcAuthorization.ts,ws.ts,project/ProjectSetupScriptRunner*,server.test.ts}`：owner 门禁、双订阅、最后连接释放、trusted setup caller 与 RPC seam。
- `apps/web/src/{connection/onboarding.ts,state/environments.ts,components/ChatView.tsx,components/ThreadTerminalDrawer.tsx,components/settings/ConnectionsSettings.tsx}`：Web/Desktop 多 URL 编辑、active endpoint 与 Terminal control UI。
- `apps/mobile/src/{connection,state,features/connection,features/settings,features/showcase,features/terminal}/...`：Mobile 多 URL、Showcase 安全投影与真实 Terminal Route 控制 UI。
- `docs/user/remote-access.md`、`docs/internals/{connection-runtime,remote,glossary}.md`：用户行为和内部架构说明。

## 验证结果

| 检查                                                         | 结果                                                                                  | 状态   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------ |
| `leaperone-dev-init --check`                                 | 项目基线有效                                                                          | 通过   |
| Connection focused tests                                     | 7 files / 72 tests                                                                    | 通过   |
| Terminal contracts / client state                            | 2 files / 31 tests                                                                    | 通过   |
| Terminal Server focused tests                                | RpcAuthorization、SessionStore、ProjectSetupScriptRunner、Manager：4 files / 68 tests | 通过   |
| Terminal RPC route seam                                      | 1 file / 2 selected tests（114 skipped）                                              | 通过   |
| Web focused tests                                            | TerminalDrawer、ConnectionsSettings logic、connection storage：3 files / 12 tests     | 通过   |
| Mobile focused tests                                         | Terminal、Environment、Showcase、storage/migration：8 files / 42 tests                | 通过   |
| Contracts / Client Runtime / Server / Web / Mobile typecheck | 五包全部通过；仅有既存的 Effect suggestions                                           | 通过   |
| Formatter                                                    | `vp fmt --write` 覆盖 57 个本任务文件                                                 | 通过   |
| `git diff --check`                                           | 无 whitespace error                                                                   | 通过   |
| 调用方与文档终审                                             | Connection、Terminal client/server、tests、docs 五路只读审计无剩余 blocker            | 通过   |
| 浏览器 / 模拟器视觉验收                                      | 未执行；本任务未授权启动浏览器或 Computer Use，未将源码/测试证据冒充视觉验收          | 未执行 |

## 错误与恢复

| 错误                           | 尝试 | 解决方式                                                                     |
| ------------------------------ | ---: | ---------------------------------------------------------------------------- |
| 当前 shell 找不到 `vp`         |    1 | 使用锁定的 `pnpm exec vp`；首次执行完成 worktree 依赖安装，未修改 lockfile。 |
| Resolver endpoint 被推断为可空 |    1 | 将 endpoint helper 返回类型收紧为非空 tuple，typecheck 通过。                |
| Showcase 显示真实 prepared URL |    1 | Showcase route 隐藏 active endpoint；真实 fallback 保存逻辑保持不变。        |
| live reopen control 投影失真   |    1 | `started` snapshot 按 viewer 读取 control，并补双 viewer reopen 回归。       |

## 交付边界

- 仅在 `docs/acro-capability-migration` 分支 commit 并 push。
- 不创建 PR，不 merge，不 release，不 deploy；preflight 必须使用 `--no-merge`。
