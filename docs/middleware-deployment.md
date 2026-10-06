# 中间件部署: RustFS 1 和 PostgreSQL 18

[返回文档导航](README.md)

本教程使用独立的 Docker Compose 项目部署 RustFS 1.0.0 和 PostgreSQL 18. PostgreSQL 使用自签 CA 签发服务器证书, 强制 TCP 连接使用 TLS, 客户端校验证书和服务器身份. 完成后再按 [后端部署教程](docker-deployment.md) 运行应用.

示例为单机部署, RustFS 使用单节点单磁盘, 没有磁盘或节点冗余. 数据保存在 PostgreSQL 数据卷和 RustFS 宿主机目录中. PostgreSQL 与 RustFS 端口默认只发布到宿主机 `127.0.0.1`, 远程访问方式见 [网络与访问地址](#网络与访问地址).

## 1. 准备目录和凭据

安装 Docker Engine 和 Compose 插件, 或使用 Docker Desktop. 宿主机还需 OpenSSL, 后续中间件命令均在独立部署目录中执行:

```bash
docker version
docker compose version
openssl version
mkdir -p "$HOME/exam-middleware"
cd "$HOME/exam-middleware"
mkdir -p certs/ca postgres/tls rustfs/data rustfs/logs
chmod 700 certs/ca
```

仅在没有 `.env` 时生成随机凭据, 不覆盖已有部署配置:

```bash
if [ ! -e .env ]; then
  (
    umask 077
    cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
RUSTFS_ACCESS_KEY=$(openssl rand -hex 12)
RUSTFS_SECRET_KEY=$(openssl rand -hex 24)
EOF
  )
fi
```

这里的 `.env` 属于中间件项目, 与后端仓库的 `.env` 分开维护. 不提交凭据, 私钥或运行数据. RustFS 管理员登录使用上述 `RUSTFS_ACCESS_KEY` 和 `RUSTFS_SECRET_KEY`, 不使用默认的 `rustfsadmin`. 变量依据见 [RustFS 环境变量](https://docs.rustfs.com/en/reference/environment-variables).

## 2. 生成 PostgreSQL 自签证书

### 自签 CA 和服务器证书

以下步骤只在首次部署时执行. `certs/ca/root.key` 是 CA 私钥, 不挂载到数据库或应用容器, 签发完成后应离线保管. `root.crt` 是客户端需要信任的 CA 公钥证书.

生成有效期 10 年的自签 CA:

```bash
(
  umask 077
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
    -keyout certs/ca/root.key -out certs/ca/root.crt \
    -subj '/CN=Exam PostgreSQL Root CA' \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign'
)
```

创建服务器证书扩展配置. 将 `db.example.com` 换为实际数据库域名; 如果客户端通过服务器 IP 连接, 再加入对应的 `IP.n` 项. SAN 必须覆盖连接 URL 中实际使用的主机名或 IP:

```bash
cat > postgres/server.ext <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names

[alt_names]
DNS.1=postgres
DNS.2=localhost
DNS.3=host.docker.internal
DNS.4=db.example.com
IP.1=127.0.0.1
EOF
```

生成服务器私钥和 CSR, 用自签 CA 签发有效期 1 年的服务器证书:

```bash
(
  umask 077
  openssl req -new -newkey rsa:3072 -sha256 -nodes \
    -keyout postgres/tls/server.key -out postgres/server.csr \
    -subj '/CN=postgres'
  openssl x509 -req -in postgres/server.csr -sha256 -days 365 \
    -CA certs/ca/root.crt -CAkey certs/ca/root.key -CAcreateserial \
    -extfile postgres/server.ext -out postgres/tls/server.crt
)
cp certs/ca/root.crt postgres/tls/root.crt
chmod 644 postgres/tls/server.crt postgres/tls/root.crt
openssl verify -CAfile postgres/tls/root.crt postgres/tls/server.crt
```

最后一条命令应返回 `postgres/tls/server.crt: OK`. PostgreSQL 只需 `server.crt` 和 `server.key` 即可启用服务端 TLS. 本教程额外挂载 `root.crt` 供容器内 `psql` 验证, 仍通过密码认证应用账号, 不要求客户端证书. 证书和私钥要求见 [PostgreSQL 18 服务端 SSL](https://www.postgresql.org/docs/18/ssl-tcp.html).

### 强制 TCP 使用 TLS

创建独立的 `pg_hba.conf`, 允许数据库容器内通过 Unix socket 使用系统用户认证, 拒绝非 TLS 的 TCP 连接, 仅允许 `exam_app` 通过 TLS 访问 `exam_platform` 数据库:

```bash
cat > postgres/pg_hba.conf <<'EOF'
local     all            all       peer
hostnossl all            all       0.0.0.0/0   reject
hostnossl all            all       ::/0        reject
hostssl   exam_platform  exam_app  0.0.0.0/0   scram-sha-256
hostssl   exam_platform  exam_app  ::/0        scram-sha-256
EOF
```

开启 `ssl=on` 本身不会拒绝明文连接, 必须同时限制 HBA 规则. 本例的 TCP 地址范围覆盖 Docker 网络和经宿主机转发的连接, 对外部署时再按实际来源收窄网段, 并配置防火墙. 规则按顺序匹配, 依据见 [PostgreSQL 18 pg_hba.conf](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html).

## 3. 创建 Compose 配置并启动

在中间件目录创建 `compose.yaml`:

```yaml
name: exam-middleware

services:
  postgres:
    image: postgres:18-bookworm
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_DB: exam_platform
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      POSTGRES_INITDB_ARGS: '--auth-host=scram-sha-256 --auth-local=peer'
    command:
      - postgres
      - -c
      - listen_addresses=*
      - -c
      - ssl=on
      - -c
      - ssl_cert_file=/etc/postgresql/tls/server.crt
      - -c
      - ssl_key_file=/etc/postgresql/tls/server.key
      - -c
      - ssl_min_protocol_version=TLSv1.2
      - -c
      - hba_file=/etc/postgresql/pg_hba.conf
      - -c
      - password_encryption=scram-sha-256
    ports:
      - '127.0.0.1:5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql
      - ./postgres/tls:/etc/postgresql/tls:ro
      - ./postgres/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro
    healthcheck:
      test:
        ['CMD-SHELL', 'gosu postgres pg_isready -U postgres -d exam_platform']
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  rustfs:
    image: rustfs/rustfs:1.0.0
    restart: unless-stopped
    environment:
      RUSTFS_ACCESS_KEY: ${RUSTFS_ACCESS_KEY:?Set RUSTFS_ACCESS_KEY in .env}
      RUSTFS_SECRET_KEY: ${RUSTFS_SECRET_KEY:?Set RUSTFS_SECRET_KEY in .env}
      RUSTFS_VOLUMES: /data
      RUSTFS_ADDRESS: ':9000'
      RUSTFS_CONSOLE_ADDRESS: ':9001'
      RUSTFS_CONSOLE_ENABLE: 'true'
      RUSTFS_REGION: us-east-1
      RUSTFS_OBS_LOG_DIRECTORY: /logs
    ports:
      - '127.0.0.1:9000:9000'
      - '127.0.0.1:9001:9001'
    volumes:
      - ./rustfs/data:/data
      - ./rustfs/logs:/logs

volumes:
  postgres_data:

networks:
  default:
    name: exam-middleware
```

PostgreSQL 18 官方镜像默认 `PGDATA` 为 `/var/lib/postgresql/18/docker`, 数据卷挂载到 `/var/lib/postgresql`. 不沿用 17 及更早版本的 `/var/lib/postgresql/data` 挂载方式, 不把旧版数据目录直接交给 18 启动. 镜像初始化变量仅在空数据目录生效. 依据见 [PostgreSQL 官方镜像](https://hub.docker.com/_/postgres).

RustFS 镜像固定为 1.0.0, 发布信息见 [RustFS 1.0.0 GA](https://rustfs.com/blog/announcing-rustfs-1-0-0-ga/). PostgreSQL 镜像跟随 18 系列补丁版本, 如需完全复现, 部署时记录并固定经过验证的镜像 digest.

检查配置, 拉取镜像, 然后通过同一 PostgreSQL 镜像设置目录所有权, 避免猜测宿主机与容器用户的 UID:

```bash
docker compose config --quiet
docker compose pull
docker run --rm --user 0 --entrypoint sh \
  -v "$PWD/postgres/tls:/pg-tls" \
  -v "$PWD/rustfs/data:/rustfs-data" \
  -v "$PWD/rustfs/logs:/rustfs-logs" \
  postgres:18-bookworm -ec '
    chown -R postgres:postgres /pg-tls
    chmod 755 /pg-tls
    chmod 600 /pg-tls/server.key
    chmod 644 /pg-tls/server.crt /pg-tls/root.crt
    chown -R 10001:10001 /rustfs-data /rustfs-logs
  '
docker compose up -d
docker compose ps
docker compose logs --tail=100 postgres rustfs
```

PostgreSQL 私钥必须可由容器中的 `postgres` 用户读取且不能开放给其他用户. RustFS 使用 UID/GID `10001:10001`, 挂载目录必须可写, 依据见 [RustFS Docker 安装](https://rustfs.org/installation/docker/). `pg_isready` 只确认数据库接受连接, 不能代替下一节的 TLS 和账号验证.

## 4. 初始化数据库账号并验证 TLS

确认 PostgreSQL 就绪后, 仅在首次初始化时创建非超级用户和业务 schema:

```bash
docker compose exec -T --user postgres postgres \
  psql -U postgres -d exam_platform -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE exam_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE exam_platform TO exam_app;
CREATE SCHEMA exam_platform AUTHORIZATION exam_app;
SQL
docker compose exec --user postgres postgres \
  psql -U postgres -d exam_platform -c '\password exam_app'
```

最后一条命令会交互要求输入两次应用密码. 使用单独的随机密码, 不复用 `POSTGRES_PASSWORD`. `exam_app` 拥有业务 schema, 可运行本项目已有迁移, 不使用数据库超级用户作为应用账号. 不授予 `CREATEDB`; 开发阶段需要 shadow database 的 `migrate dev` 另行配置, 部署使用 `migrate deploy`.

通过 TCP 连接校验 CA, 主机名和密码, 同时检查当前连接是否加密:

```bash
docker compose exec postgres psql \
  'host=postgres port=5432 dbname=exam_platform user=exam_app sslmode=verify-full sslrootcert=/etc/postgresql/tls/root.crt' \
  -W -v ON_ERROR_STOP=1 \
  -c 'SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid();'
```

输入应用密码后应得到 `ssl = t`, 并显示 TLS 版本和密码套件. 再验证服务端拒绝明文 TCP 连接:

```bash
docker compose exec postgres psql \
  'host=postgres port=5432 dbname=exam_platform user=exam_app sslmode=disable' \
  -c 'SELECT 1;'
```

这条命令应失败并提示 HBA 拒绝未加密连接. `verify-full` 同时校验证书信任和服务器名称, 依据见 [PostgreSQL 18 客户端 SSL](https://www.postgresql.org/docs/18/libpq-ssl.html).

## 5. 初始化 RustFS 桶

打开 [本机 RustFS 控制台](http://localhost:9001), 使用中间件 `.env` 中的管理凭据登录. 创建私有桶 `exam-platform`, 上传一个小文件并尝试下载, 确认桶和对象读写可用. S3 API 使用 `9000`, 控制台使用 `9001`, 不把控制台地址填入应用的 `S3_ENDPOINT`.

本项目 [S3Service](../src/files/s3.service.ts) 使用 path-style 访问, 默认桶名为 `exam-platform`, 不会自动创建桶. 上线时在控制台为应用创建独立凭据, 策略只授予该桶所需的 `s3:ListBucket`, `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, 再把应用凭据填入后端 `.env` 的 `S3_ACCESS_KEY` 和 `S3_SECRET_KEY`. 身份和策略管理见 [RustFS IAM](https://docs.rustfs.com/en/security-compliance/iam).

桶保持私有. [题目图片](../src/files/question-images.service.ts) 使用预签名 URL, 普通文件通过受权限控制的 `GET /api/files/:id` 返回文件流. 普通文件记录中的 `url` 是对象存储地址, 私有桶下不能直接匿名访问, 接入方式见 [前端接入](frontend-api-doc.md#导入导出和文件).

## 6. 接入考试平台

### 后端在宿主机运行

在后端仓库 `.env` 中配置下面的值. 将 `CHANGE_ME` 换为应用账号密码或 RustFS 应用凭据, 将证书路径换为实际绝对路径. 密码中的特殊字符需 URL 编码:

```dotenv
DATABASE_URL='postgresql://exam_app:CHANGE_ME@localhost:5432/exam_platform?schema=exam_platform&sslmode=require&sslcert=/absolute/path/to/exam-middleware/postgres/tls/root.crt&sslaccept=strict&connection_limit=10&pool_timeout=10&connect_timeout=10'
S3_ENDPOINT='http://localhost:9000'
S3_BUCKET='exam-platform'
S3_ACCESS_KEY='CHANGE_ME'
S3_SECRET_KEY='CHANGE_ME'
S3_REGION='us-east-1'
```

仓库当前使用 Prisma 6 内置 PostgreSQL 驱动, `sslmode` 支持 `disable`, `prefer`, `require`. 配合 CA 文件和 `sslaccept=strict` 校验证书, 不直接把 `psql` 的 `sslmode=verify-full` 参数复制给 Prisma. 使用绝对证书路径可避免相对 `prisma/` 解析带来的差异. 依据见 [Prisma 6 PostgreSQL SSL](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql#configuring-an-ssl-connection).

然后按 [开发与运行](getting-started.md) 使用 nvm 和 pnpm, 从仓库根目录执行 `pnpm exec prisma migrate deploy`, 再完成管理员初始化和应用启动. 本教程不配置 `TEST_DATABASE_URL`, 测试隔离要求见 [数据库](database.md).

### 后端在 Docker Compose 中运行

同一 Docker 主机上的后端可加入中间件网络. 在后端仓库根目录保存 `compose.middleware.yaml`:

```yaml
services:
  app:
    volumes:
      - ${POSTGRES_CA_FILE:?Set POSTGRES_CA_FILE in .env}:/app/certs/postgres-root.crt:ro
    networks:
      - middleware

networks:
  middleware:
    external: true
    name: exam-middleware
```

后端 `.env` 使用以下数据库配置. `POSTGRES_CA_FILE` 是 Docker 宿主机上的 CA 公钥证书路径, `sslcert` 是应用容器内的挂载路径:

```dotenv
POSTGRES_CA_FILE='/absolute/path/to/exam-middleware/postgres/tls/root.crt'
DATABASE_URL='postgresql://exam_app:CHANGE_ME@postgres:5432/exam_platform?schema=exam_platform&sslmode=require&sslcert=/app/certs/postgres-root.crt&sslaccept=strict&connection_limit=10&pool_timeout=10&connect_timeout=10'
S3_ENDPOINT='https://storage.example.com'
```

其他 S3 变量沿用上一节. `storage.example.com` 需先按下一节配置为后端容器和浏览器都可访问的 S3 API 地址. CA 文件对应用镜像的非 root 用户须可读, 只挂载 `root.crt`, 不挂载服务器私钥或 CA 私钥.

后端部署教程中的 Compose 命令都要同时指定两个文件, 包括迁移:

```bash
docker compose -f compose.yaml -f compose.middleware.yaml config --quiet
docker compose -f compose.yaml -f compose.middleware.yaml build app
docker compose -f compose.yaml -f compose.middleware.yaml run --rm --no-deps app \
  node node_modules/prisma/build/index.js migrate deploy
docker compose -f compose.yaml -f compose.middleware.yaml up -d app
```

### 网络与访问地址

| 访问位置                 | PostgreSQL 地址                          | RustFS S3 地址                 |
| ------------------------ | ---------------------------------------- | ------------------------------ |
| 本机后端与本机浏览器     | `localhost:5432`                         | `http://localhost:9000`        |
| 同一 Docker 网络中的后端 | `postgres:5432`                          | 配置后端和浏览器均可访问的域名 |
| 其他服务器上的后端       | 实际数据库域名或 IP, 需包含在证书 SAN 中 | 对外 S3 API 的 HTTPS 地址      |

跨主机访问 PostgreSQL 时, 将 `127.0.0.1:5432:5432` 改为实际内网 IP 的发布配置, 防火墙仅允许应用服务器来源, 并调整 HBA 网段. Docker Desktop 容器访问宿主机时可用 `host.docker.internal`, 当前证书 SAN 已包含该名称.

远程浏览器访问文件时, 为 RustFS 的 `9000` 配置 HTTPS 反向代理, 例如 `https://storage.example.com`. 宿主机代理可转发至 `127.0.0.1:9000`; 容器代理可加入 `exam-middleware` 网络并转发至 `rustfs:9000`. S3 API 放在域名根路径, 保留原始 Host, 路径和查询参数, 避免预签名校验失败, 配置参考 [RustFS Nginx 指南](https://docs.rustfs.com/en/developer/integration/reverse-proxy/nginx).

应用生成的下载 URL 直接包含 `S3_ENDPOINT`. 容器内部的 `http://rustfs:9000` 通常无法被浏览器解析, 浏览器也不能用自己的 `localhost` 访问远程服务. HTTPS 前端的文件端点应使用 HTTPS. 如果前端通过 `fetch` 读取文件, 还需配置 RustFS 或桶的 CORS 允许实际前端 origin; 后端的 `CORS_ORIGIN` 不控制 RustFS.

## 7. 运维和排查

以下命令回到中间件部署目录执行:

```bash
cd "$HOME/exam-middleware"
docker compose ps
docker compose logs -f --tail=100 postgres rustfs
```

停止服务使用 `docker compose stop`, 删除容器使用 `docker compose down`. 常规运维不使用 `down -v`, 它会删除 PostgreSQL 数据卷. RustFS 数据在 `rustfs/data`, 不删除或清空该目录.

数据库逻辑备份示例, 执行前确认数据库已就绪. 成功生成后将备份保存到独立设备或备份服务, 并定期验证恢复:

```bash
mkdir -p backups
chmod 700 backups
(
  umask 077
  docker compose exec -T --user postgres postgres \
    pg_dump -U postgres -d exam_platform -Fc \
    > "backups/exam-platform-$(date +%Y%m%d-%H%M%S).dump"
)
```

`pg_dump` 不备份全局角色, 恢复前需重新创建 `exam_app` 等角色. RustFS 对象需单独备份, 不把正在写入的数据目录直接复制当作一致性备份. 同时保管 CA 证书, 离线 CA 私钥和部署配置.

服务器证书到期前, 使用原 CA 重新签发覆盖所需 SAN 的证书, 更新 `postgres/tls` 中的证书和私钥, 重新设置所有权与权限, 再执行 `docker compose restart postgres` 并重复 TLS 验证. 如果更换 CA, 还需更新所有客户端信任文件. 检查当前证书有效期:

```bash
openssl x509 -in postgres/tls/server.crt -noout -dates
```

| 现象                                 | 检查与处理                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| PostgreSQL 提示私钥权限或读取错误    | 检查容器内 `postgres` 所有权和 `server.key` 的 `0600` 权限, 重新执行目录权限设置步骤 |
| 证书不受信任或名称不匹配             | 检查 CA 文件路径, 挂载权限和连接主机是否在 SAN 中, 修复后保持严格校验                |
| TCP 连接被 HBA 拒绝                  | 检查是否使用 TLS, 数据库和用户是否为 `exam_platform` / `exam_app`, 来源网段是否匹配  |
| 修改数据库 `.env` 密码后旧密码仍有效 | 初始化变量不会修改已有账号, 使用 `psql` 的 `\password` 修改角色密码并更新后端配置    |
| RustFS 提示 permission denied        | 检查数据和日志目录是否归 `10001:10001` 所有且可写                                    |
| 上传提示 NoSuchBucket                | 在控制台创建与 `S3_BUCKET` 一致的私有桶                                              |
| 上传正常但浏览器下载失败             | 检查 `S3_ENDPOINT` 的浏览器可达性, HTTPS, 代理是否保留签名参数, 以及需要时的 CORS    |
| 后端迁移提示无 schema 权限           | 确认 `exam_platform` schema 的所有者为 `exam_app`, 连接 URL 使用该 schema            |
