# 文档导航

这些文档描述当前仓库中的考试题库后端. 以 controller, DTO, service 和 Prisma schema 为依据, 记录实际接口, 业务行为及已知限制.

| 阅读目的                                         | 文档                                        |
| ------------------------------------------------ | ------------------------------------------- |
| 安装, 配置, 启动, 构建和测试                     | [开发与运行](getting-started.md)            |
| 使用 Docker Compose 部署, 配置环境变量和更新容器 | [Docker Compose 部署](docker-deployment.md) |
| 部署 RustFS 1, PostgreSQL 18 和数据库自签证书    | [中间件部署](middleware-deployment.md)      |
| 理解系统组成, 请求处理和模块关系                 | [系统架构](architecture.md)                 |
| 理解权限, 出题, 组卷, 考试和练习                 | [业务逻辑](business-logic.md)               |
| 查找接口与入参                                   | [接口参考](api.md)                          |
| 接入浏览器登录, 答题和文件下载                   | [前端接入](frontend-api-doc.md)             |
| 理解模型, 外键, 环境隔离, 迁移和连接恢复         | [数据库](database.md)                       |

推荐阅读顺序: 开发与运行 -> 系统架构 -> 业务逻辑, 再按工作内容查阅接口和数据库.

架构图, 业务流程图, 作答状态图和 ER 图使用 Mermaid 代码块. 在支持 Mermaid 的 Markdown 查看器中可直接渲染; 图源与说明保存在同一文件中.

仓库只包含后端. 文档中的浏览器交互是接入要求, 不代表本仓库已实现对应页面. 自动判分不包含人工阅卷或代码执行; 其他行为边界见 [业务逻辑](business-logic.md).

开发约定见 [AGENTS.md](../AGENTS.md), 项目入口见 [README.md](../README.md).
