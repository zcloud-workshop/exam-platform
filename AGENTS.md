# 仓库开发约定

## 工作方式

- 使用中文回复, 使用英文标点, 不使用表情符号.
- 修改前先读取文件, 搜索已有实现和调用点, 分析影响范围. 先确认方案简单, 范围必要, 风格一致.
- 优先 CLI 和本地代码工具. 使用 `rg` 定位实现与引用; 不依据过时文档或注释推断行为.
- 保持现有外部行为, 不加入推测性功能. 关键路径显式处理错误, 不改无关注释, 类型或代码.
- 变更后清理临时文件, 未使用导入和调试输出, 运行最小有意义的验证. 函数签名变化须更新所有调用点.
- 复杂任务可使用子代理隔离上下文, 为各代理分配不重叠的文件范围.
- 每个文件单独提交, 使用 `feat: ...`, `fix: ...`, `refactor: ...`, `docs: ...` 或 `chore: ...`.

## 工具链

Node 由 nvm 管理, 必须遵循 [.nvmrc](.nvmrc). nvm 不可用时先询问用户, 不静默切换运行时. 包管理统一使用 pnpm.

```bash
nvm install
nvm use
pnpm install
```

常用命令和环境准备见 [开发与运行](docs/getting-started.md). 安装脚本审批维护在 [pnpm-workspace.yaml](pnpm-workspace.yaml), 不复制到 package.json.

## 代码入口

| 需要修改的内容           | 先阅读                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| 全局配置, 守卫, 模块注册 | [main.ts](src/main.ts), [app.module.ts](src/app.module.ts)                                   |
| 接口权限和输入输出       | 对应模块的 controller, dto, service; [接口参考](docs/api.md)                                 |
| 题库授权                 | [BankPermissionService](src/common/services/bank-permission.service.ts)                      |
| 数据模型与迁移           | [schema.prisma](prisma/schema.prisma), [数据库文档](docs/database.md)                        |
| 考试和判分               | [ExamsService](src/exams/exams.service.ts), [RecordsService](src/records/records.service.ts) |
| 翻译数据兼容             | [localize.ts](src/common/utils/localize.ts) 和对应单元测试                                   |
| E2E 环境                 | [test-utils.ts](test/test-utils.ts), [jest-e2e.json](test/jest-e2e.json)                     |

## 实现约束

- 当前依赖为 Prisma 6, generator 为 `prisma-client-js`. TypeScript 使用 strict 和 node16 模块解析, package.json 没有 `type: module`. 不顺手升级 Prisma 大版本或改变模块体系.
- PrismaModule 和 CommonModule 为全局模块. 业务服务直接注入 PrismaService, 题库访问复用 BankPermissionService.
- 角色权限, 题库权限和学生考试分配是不同检查. 当前实际权限见 [业务逻辑](docs/business-logic.md), 不把 editor/exam_manager 当成已经隔离的权限域.
- 题目 options/translations 和答题记录 answers 在数据库中是 JSON 字符串. 不同接口解析方式不同, 修改时同时检查调用方, 见 [前端接入](docs/frontend-api-doc.md).
- 普通响应由 TransformInterceptor 包装为 `{ data }`, 文件下载和 Excel 导出由控制器直接写二进制响应.
- JWT_SECRET 必须配置. 浏览器 Cookie 和 Bearer 认证均已实现.
- Prisma 的 Record 模型可能与 TypeScript 的 `Record<K, V>` 同名, 导入时避免冲突.

## 数据和验证

- 不读取或提交 `.env` 中的密钥; 配置格式参照 [.env.example](.env.example).
- E2E 仅允许 `TEST_DATABASE_URL` 指向 `schema=exam_test`. 测试会部署迁移并清空测试表, 禁止指向业务 schema.
- 应用已有迁移用 `pnpm exec prisma migrate deploy`. 创建迁移用 `pnpm exec prisma migrate dev`, 需要 shadow database 条件.
- `pnpm lint` 会自动修复代码. 只检查时使用 `pnpm lint:check`. 两个命令均要求零错误和零警告.
- 纯文档修改检查 Markdown 格式, 链接, 图表语法和源码一致性; 不为此运行会清库的 E2E.

## 文档维护

完整项目文档统一放在 [docs/](docs/README.md). 根 README 保留简介和导航, CLAUDE.md 只引用本文件.

接口变化更新接口参考, 业务行为变化更新业务逻辑, 模型变化更新数据库文档. 架构与业务图使用 Mermaid, 保持源码可编辑. 不维护固定测试数量, 已完成阶段清单, 重复配置块或未经实现验证的能力说明.
