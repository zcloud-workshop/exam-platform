# Exam Platform

考试题库管理后端, 使用 NestJS 11, TypeScript, PostgreSQL 和 Prisma 6. 提供题库协作, 题目管理, 组卷, 考试分配, 草稿与自动判分, 公开练习, AI 辅助, 文件管理和操作日志. 本仓库不包含前端应用.

完整文档集中在 [docs/](docs/README.md):

| 文档                                             | 内容                                  |
| ------------------------------------------------ | ------------------------------------- |
| [开发与运行](docs/getting-started.md)            | Node/pnpm, 安装, 环境变量, 启动与验证 |
| [Docker Compose 部署](docs/docker-deployment.md) | 容器构建, 环境变量, 迁移和部署运维    |
| [系统架构](docs/architecture.md)                 | 架构图, 请求链路, 模块职责与外部依赖  |
| [业务逻辑](docs/business-logic.md)               | 权限, 题库, 组卷, 考试, 判分与流程图  |
| [接口参考](docs/api.md)                          | 实际路由, 请求参数, 权限与返回约定    |
| [前端接入](docs/frontend-api-doc.md)             | 登录态, 数据解析, 考试接入与展示边界  |
| [数据库](docs/database.md)                       | ER 图, 数据约束, 迁移, 连接恢复与归档 |

首次运行请从 [开发与运行](docs/getting-started.md) 开始. API 前缀为 `/api`, 开发环境 Swagger 地址为 `http://localhost:3000/swagger`.

文档以当前仓库实现为准. 现有权限, 计分和成绩可见性限制见 [业务逻辑](docs/business-logic.md), 开发约定见 [AGENTS.md](AGENTS.md).
