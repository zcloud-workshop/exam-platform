# 开发与运行

[返回文档导航](README.md)

## 环境准备

从仓库根目录执行命令. Node 版本以 [.nvmrc](../.nvmrc) 为准, 当前为 24.16.0. 使用 nvm 和 pnpm, 不混用 npm 安装依赖.

```bash
nvm install
nvm use
pnpm install
pnpm exec prisma generate
```

如果终端尚未加载已安装的 nvm, 先执行 `source "$HOME/.nvm/nvm.sh"`. nvm 未安装或不可用时先解决运行环境, 不切换到系统 Node.

依赖的安装脚本许可位于 [pnpm-workspace.yaml](../pnpm-workspace.yaml). 项目使用 Prisma 6 和 PostgreSQL; 数据库模板按 PostgreSQL 18 配置. S3 和 AI 在调用对应功能时需要可用的外部服务.

## 首次配置

仅在 `.env` 不存在时复制模板:

```bash
test -f .env || cp .env.example .env
```

编辑 `.env`, 配置实际数据库连接和 JWT_SECRET. 保留模板中的 `CHANGE_ME` 无法完成连接或提供合适的签名密钥. 环境文件不进入 Git.

| 变量                             | 当前用途与默认行为                                                            |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`                   | Prisma CLI 和应用连接. 模板使用 `public` schema                               |
| `DATABASE_URL_PROD`              | 生产连接参考值, 不会根据 NODE_ENV 自动替换 DATABASE_URL                       |
| `TEST_DATABASE_URL`              | E2E 专用连接, 必须含 `schema=exam_test`                                       |
| `JWT_SECRET`                     | JWT 签名密钥, 无硬编码后备值                                                  |
| `NODE_ENV`                       | 为 `production` 时启用生产 Cookie, CORS 和 Swagger 行为                       |
| `PORT`                           | 监听端口, 默认 3000, 地址为 `0.0.0.0`                                         |
| `CORS_ORIGIN`                    | 允许的前端 origin, 英文逗号分隔. 未配置时开发环境允许跨域, 生产环境不开放跨域 |
| `SWAGGER_ENABLED`                | 生产环境仅设为字符串 `true` 时开放 Swagger; 非生产环境始终开放                |
| `S3_ENDPOINT`                    | S3 兼容端点, 代码后备值为 `http://localhost:9000`                             |
| `S3_BUCKET`                      | 默认 `exam-platform`, 需要预先创建                                            |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | 对象存储凭证                                                                  |
| `S3_REGION`                      | 默认 `us-east-1`                                                              |
| `OPENAI_BASE_URL`                | AI 服务根地址, 代码在末尾拼接 `/v1/chat/completions`                          |
| `OPENAI_API_KEY`                 | AI 服务凭证                                                                   |
| `OPENAI_MODEL`                   | 模板值为 `deepseek-chat`, 未配置时代码后备值为 `gpt-3.5-turbo`                |

配置依据: [.env.example](../.env.example), [main.ts](../src/main.ts), [认证模块](../src/auth/auth.module.ts), [S3Service](../src/files/s3.service.ts), [AiService](../src/ai/ai.service.ts). AI 的 URL 不应重复包含代码会追加的路径.

数据库账号, schema, SSL 和迁移条件见 [数据库](database.md). 密码中的特殊字符需要 URL 编码.

## 初始化数据库

配置好开发数据库后应用已有迁移, 再运行初始化脚本:

```bash
pnpm exec prisma migrate deploy
pnpm exec ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
```

[seed.ts](../prisma/seed.ts) 创建 `admin` 超级管理员和 id 为 `default` 的默认题库, 初始密码由脚本随机生成并只在创建时打印一次, 已存在的同名管理员不会被重置也不会重新生成密码. 初次登录后修改初始密码. 部分业务 DTO 要求 bankId 为 UUID, 因而首次通过接口操作时应创建新题库并使用返回的 id, 不把字符串 `default` 当作 UUID.

## 启动命令

从仓库根目录执行, 先用 `nvm use` 切换到项目指定的 Node 版本. 以下脚本来自 [package.json](../package.json), 适用于环境变量已由终端或进程管理器注入的情况:

| 场景     | 命令                                  | 行为                                          |
| -------- | ------------------------------------- | --------------------------------------------- |
| 普通启动 | `pnpm start`                          | 编译并启动, 不监听文件变化                    |
| 开发启动 | `pnpm start:dev`                      | 监听源码变化并自动重启                        |
| 调试启动 | `pnpm start:debug`                    | 开启 Node 调试并监听源码变化                  |
| 生产启动 | `NODE_ENV=production pnpm start:prod` | 运行 dist 中的构建产物, 需先执行 `pnpm build` |

[main.ts](../src/main.ts) 未显式调用 dotenv. 使用仓库 `.env` 配置时, 执行下面的显式加载命令.

### 开发启动

加载 `.env` 并监听源码变化:

```bash
pnpm exec node --env-file=.env node_modules/@nestjs/cli/bin/nest.js start --watch
```

### 调试启动

加载 `.env`, 开启调试并监听源码变化:

```bash
pnpm exec node --env-file=.env node_modules/@nestjs/cli/bin/nest.js start --debug --watch
```

服务默认监听以下地址, 在终端按 `Ctrl+C` 停止运行:

- API 根路径: `http://localhost:3000/api`.
- Swagger: `http://localhost:3000/swagger`, 可查询接口并使用 Bearer Token 调试.
- 当前没有单独的健康检查接口, API 根路径也不是首页.

### 生产启动

先构建, 再加载 `.env` 启动生产进程:

```bash
pnpm build
NODE_ENV=production pnpm exec node --env-file=.env dist/main.js
```

启动生产进程前, 必须将部署环境的 `DATABASE_URL` 配置为生产连接. 仅设置 NODE_ENV 或填写 DATABASE_URL_PROD 不会切换数据库. 生产 Cookie 需要 HTTPS; 跨域浏览器接入还需正确的 CORS_ORIGIN 和凭证设置, 见 [前端接入](frontend-api-doc.md).

### Docker 启动

使用 Docker Compose 部署见 [Docker Compose 部署](docker-deployment.md), 包含 `.env` 设置, 构建, 迁移, 首次初始化和更新步骤. 以下为直接使用 Docker CLI 的方式.

[Dockerfile](../Dockerfile) 使用与 `.nvmrc` 一致的 Node 24.16.0, 通过 pnpm 安装锁定依赖, 生成 Prisma Client 并构建应用. 最终镜像仅保留生产依赖, 构建产物和数据库迁移文件, 以非 root 用户运行, 默认端口为 3000.

```bash
docker build -t exam-platform .
```

环境变量在运行时注入, `.env` 不进入镜像. 使用下面的 `--env-file .env` 前, 将 `.env` 中的配置写成 `KEY=value`, 去掉值两侧的引号; Docker 不会像 dotenv 一样去除这些引号. `DATABASE_URL` 必须指向容器可访问的数据库, `JWT_SECRET` 必须配置. 容器内的 `localhost` 指容器自身.

启动应用前单独应用已有迁移:

```bash
docker run --rm --env-file .env exam-platform \
  node node_modules/prisma/build/index.js migrate deploy
```

迁移成功后启动服务:

```bash
docker run -d --name exam-platform \
  --restart unless-stopped \
  --env-file .env \
  -e NODE_ENV=production -e PORT=3000 \
  -p 3000:3000 \
  exam-platform
```

首次部署的管理员初始化仍按上面的 [初始化数据库](#初始化数据库) 在本机执行, 连接同一数据库. 镜像不包含运行 seed 所需的开发依赖, 启动时也不会自动迁移或初始化数据.

## 常用验证

命令来源为 [package.json](../package.json). 选择与改动对应的最小验证范围.

| 目的               | 命令                                                                 | 范围                                 |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------ |
| 构建               | `pnpm build`                                                         | 编译 src, 不包含 test 和单元测试文件 |
| 单元测试           | `pnpm test --runInBand`                                              | src 下的 `.spec.ts`                  |
| 指定单元测试       | `pnpm test --runInBand localize.spec.ts`                             | 翻译序列化与兼容处理                 |
| 只检查代码规范     | `pnpm lint:check`                                                    | 不修改文件, 要求零错误和零警告       |
| 修复代码规范       | `pnpm lint`                                                          | 自动修复, 要求零错误和零警告         |
| 检查 Markdown 格式 | `pnpm exec prettier --check "*.md" "docs/**/*.md"`                   | 文档格式                             |
| E2E 全量           | `pnpm test:e2e`                                                      | 按测试配置串行执行                   |
| 指定 E2E           | `pnpm exec jest --config ./test/jest-e2e.json test/auth.e2e-spec.ts` | 单个接口测试文件                     |

E2E 会先部署迁移, 再清空测试表. [test-utils.ts](../test/test-utils.ts) 强制检查 `TEST_DATABASE_URL` 中的 schema 为 `exam_test`, 不允许使用开发或生产业务 schema. AI 和文件 E2E 会调用实际外部服务, 并非完全离线测试. 纯文档修改不需要执行清库测试.

## 问题定位

| 现象                     | 先检查                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------ |
| 启动时连接数据库失败     | DATABASE_URL, SSL, 网络和账号; 查看 PrismaService 日志, 详见 [连接恢复](database.md) |
| JWT 初始化失败或请求 401 | JWT_SECRET 是否在模块初始化前加载; Cookie/Bearer 是否存在且未过期                    |
| 浏览器无法跨域请求       | CORS_ORIGIN 是否与页面 origin 完全对应, 请求是否携带凭证                             |
| 返回 403                 | controller 角色声明及对应题库授权; 不只检查登录状态                                  |
| 返回 400                 | DTO 类型/额外字段, 关联数据, 考试分配和考试时间窗口                                  |
| AI 请求提示未配置        | OPENAI_BASE_URL 和 OPENAI_API_KEY, 以及实际拼接的请求地址                            |
| 文件接口失败             | S3 端点, 桶是否存在, 凭证与桶权限                                                    |

服务端错误统一由 [AllExceptionsFilter](../src/common/filters/all-exceptions.filter.ts) 输出. 未转换为 HttpException 的数据库或外部服务异常返回 500, 需要结合服务日志定位.
