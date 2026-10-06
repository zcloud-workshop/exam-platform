# Docker Compose 部署

[返回文档导航](README.md)

从仓库根目录执行命令. [compose.yaml](../compose.yaml) 使用已有 [Dockerfile](../Dockerfile) 构建并运行后端, 连接已有 PostgreSQL 和 S3 兼容对象存储. 数据库和对象存储需单独准备; 本仓库不包含前端.

## 部署前准备

安装 Docker Engine 和 Compose 插件, 或使用包含 Compose 的 Docker Desktop. 确认 Docker 服务正在运行:

```bash
docker version
docker compose version
```

安装方式见 [Docker Compose 官方文档](https://docs.docker.com/compose/install/). 仅构建和运行容器时, 宿主机无需安装 Node 或 pnpm. 镜像使用与 [.nvmrc](../.nvmrc) 一致的 Node 24.16.0, 安装锁定依赖, 生成 Prisma Client 并构建应用, 最终以非 root 用户运行.

## 设置环境变量

仅在 `.env` 不存在时复制模板, 再编辑实际部署配置:

```bash
test -f .env || cp .env.example .env
```

至少将下面的变量替换为实际值. `DATABASE_URL` 必须直接填写生产数据库连接, `JWT_SECRET` 必须替换为随机密钥:

```dotenv
DATABASE_URL='postgresql://exam_app:CHANGE_ME@db.example.com:5432/exam_platform?schema=exam_platform&sslmode=require&connection_limit=10&pool_timeout=10&connect_timeout=10'
JWT_SECRET='CHANGE_ME_TO_A_LONG_RANDOM_SECRET'
PORT=3000
CORS_ORIGIN='https://exam.example.com'
SWAGGER_ENABLED=false
```

生成 JWT 密钥, 将输出复制到 `.env` 的 `JWT_SECRET`:

```bash
openssl rand -hex 32
```

| 变量              | Compose 部署中的设置方式                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`    | 容器可访问的 PostgreSQL 连接, 账号需具备目标 schema 的迁移权限. 密码中的特殊字符需 URL 编码 |
| `JWT_SECRET`      | JWT 签名密钥, 不能为空. 更新后原有 Token 将失效                                             |
| `PORT`            | 宿主机发布端口, 默认 3000. 容器内固定监听 3000; 例如设为 8080 后通过宿主机 8080 端口访问    |
| `NODE_ENV`        | Compose 固定为 `production`, 覆盖 `.env` 中的同名设置                                       |
| `CORS_ORIGIN`     | 浏览器前端的完整 origin, 含协议和端口, 不含路径. 多个来源用英文逗号分隔                     |
| `SWAGGER_ENABLED` | 默认生产环境关闭 Swagger, 仅字符串 `true` 会开启 `/swagger`                                 |

`DATABASE_URL_PROD` 只是现有模板中的参考值, 应用不会自动读取它替换 `DATABASE_URL`. `TEST_DATABASE_URL` 仅用于 E2E, 部署无需设置. 数据库连接和 SSL 要求见 [数据库](database.md).

使用文件或 AI 功能时, 在同一个 `.env` 中补充对应配置:

```dotenv
S3_ENDPOINT='https://storage.example.com'
S3_BUCKET='exam-platform'
S3_ACCESS_KEY='CHANGE_ME'
S3_SECRET_KEY='CHANGE_ME'
S3_REGION='us-east-1'
OPENAI_BASE_URL='https://ai.example.com'
OPENAI_API_KEY='CHANGE_ME'
OPENAI_MODEL='deepseek-chat'
```

S3 桶需预先创建, 端点应能被后端和下载文件的浏览器访问. AI 地址由代码追加 `/v1/chat/completions`, 不要重复填写该路径. 不使用这些功能时可暂不配置, 调用相应接口前再补齐. 全部变量的默认行为见 [开发与运行](getting-started.md#首次配置).

### `.env` 如何进入容器

Compose 读取根目录 `.env` 进行变量插值, 同时通过 `env_file: .env` 将配置注入容器, 应用直接读取 `process.env`. `.env` 不进入 Git 或镜像, 无需在容器中再执行 dotenv 或 `source .env`.

Compose 支持模板中的引号, 会去掉值两侧的引号. 值含 `$` 时使用单引号以保留原值. 这与 `docker run --env-file` 的处理方式不同, 后者的说明见 [Docker 启动](getting-started.md#docker-启动). 语法依据: [Compose 环境变量插值](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).

`environment` 中的设置覆盖 `env_file`. 本配置的 `DATABASE_URL`, `JWT_SECRET` 和宿主机 `PORT` 使用插值, 已 export 的同名 shell 变量优先于 `.env`; 其他业务变量由 `env_file` 注入. 依据: [容器环境变量优先级](https://docs.docker.com/compose/how-tos/environment-variables/envvars-precedence/).

### 数据库地址如何填写

- 独立数据库服务器: 使用该服务器的域名或 IP 和实际端口, 确保容器网络可达.
- macOS Docker Desktop 上的宿主机数据库: 使用 `host.docker.internal`, 容器中的 `localhost` 指向容器自身. Linux Docker Engine 需另行配置宿主机访问地址, 不直接照搬该名称.
- 同一 Docker 网络中的数据库容器: 使用其服务名和容器端口, 同时确保应用已连接该网络. 当前 Compose 未定义数据库服务.

Docker Desktop 的宿主机访问说明见 [官方网络文档](https://docs.docker.com/desktop/features/networking/networking-how-tos/). 示例连接使用 `sslmode=require`, 实际数据库需支持 SSL; SSL 设置应与目标数据库一致.

## 构建, 迁移和启动

先验证配置并构建镜像:

```bash
docker compose config --quiet
docker compose build app
```

配置检查会在 `DATABASE_URL` 或 `JWT_SECRET` 未设置或为空时报错, 但不会检查占位值, 数据库连通性或账号权限. `--quiet` 只检查配置, 不打印展开后的密钥. 依据: [docker compose config](https://docs.docker.com/reference/cli/docker/compose/config/).

启动前, 使用与应用相同的环境变量应用已有迁移:

```bash
docker compose run --rm --no-deps app \
  node node_modules/prisma/build/index.js migrate deploy
```

迁移失败时先查看错误并修复数据库连接或权限, 成功后再启动. 容器不会自动运行迁移或 seed, 生产部署使用 `migrate deploy`, 不使用需要 shadow database 的 `migrate dev`.

### 首次初始化管理员

新数据库还需运行 [seed.ts](../prisma/seed.ts). 生产镜像未包含 seed 源码和 ts-node, 在能连接同一生产数据库的本机或部署工作机上, 使用 nvm 和 pnpm 执行:

```bash
nvm install
nvm use
pnpm install
pnpm exec prisma generate
pnpm exec node --env-file=.env node_modules/ts-node/dist/bin.js \
  --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
```

执行前确认该机器 `.env` 的 `DATABASE_URL` 指向刚完成迁移的数据库, 地址也能从宿主机访问. seed 创建 `admin/admin123`, 已有同名管理员不会被重置; 初次登录后修改密码. 默认题库和 UUID 使用限制见 [初始化数据库](getting-started.md#初始化数据库).

### 启动和检查

```bash
docker compose up -d app
docker compose ps
docker compose logs --tail=100 app
```

默认 API 地址为 `http://localhost:3000/api`, 远程部署时替换为宿主机地址和配置的发布端口. API 根路径不是首页, 当前没有专用健康检查接口. 可在初始化后通过登录和业务接口确认服务可用.

生产 Cookie 设置了 `Secure`, 浏览器登录需通过 HTTPS 访问 API. 使用反向代理终止 TLS 并转发到应用端口, 同时将前端 origin 配置到 `CORS_ORIGIN`; 浏览器请求需携带凭证, 见 [前端接入](frontend-api-doc.md).

## 更新和常用操作

代码更新后重新构建, 应用迁移, 再替换应用容器:

```bash
docker compose build app
docker compose run --rm --no-deps app \
  node node_modules/prisma/build/index.js migrate deploy
docker compose up -d app
```

修改 `.env` 后重新创建容器以加载新值:

```bash
docker compose config --quiet
docker compose up -d --force-recreate app
```

仅执行 `docker compose restart` 不会加载新的环境变量, 依据: [docker compose restart](https://docs.docker.com/reference/cli/docker/compose/restart/).

| 操作               | 命令                                    |
| ------------------ | --------------------------------------- |
| 持续查看日志       | `docker compose logs -f --tail=100 app` |
| 查看状态           | `docker compose ps`                     |
| 停止服务           | `docker compose stop app`               |
| 删除容器和项目网络 | `docker compose down`                   |

数据库和文件持久化在外部 PostgreSQL 和对象存储, 由相应服务负责备份; 此 Compose 未定义数据卷. `down` 只移除本项目的容器和网络.

## 常见问题

| 现象                          | 检查方式                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| 提示缺少数据库连接或 JWT 密钥 | 检查根目录 `.env` 的 `DATABASE_URL`, `JWT_SECRET`, 以及 shell 中是否存在同名覆盖值         |
| 容器反复重启                  | 执行 `docker compose logs --tail=100 app`, 根据实际启动错误检查数据库, 迁移状态和 JWT 配置 |
| 数据库连接失败                | 检查地址是否使用了容器内 `localhost`, SSL 要求, 数据库账号及网络可达性                     |
| 宿主机端口被占用              | 将 `.env` 中 `PORT` 改为可用端口, 重新创建容器. 容器监听端口仍为 3000                      |
| 修改 `.env` 后配置未生效      | 使用 `up -d --force-recreate`, 检查 Compose 的固定值和 shell 中已 export 的插值变量        |
| 浏览器登录或跨域失败          | 检查 API 是否通过 HTTPS 访问, `CORS_ORIGIN` 是否匹配前端 origin, 请求是否携带凭证          |
| `/swagger` 返回 404           | 生产环境默认关闭, 确需启用时设置 `SWAGGER_ENABLED=true` 并重新创建容器                     |

配置依据: [应用入口](../src/main.ts), [认证模块](../src/auth/auth.module.ts), [认证 Cookie](../src/auth/auth.controller.ts), [PrismaService](../src/prisma/prisma.service.ts), [S3Service](../src/files/s3.service.ts), [AiService](../src/ai/ai.service.ts).
