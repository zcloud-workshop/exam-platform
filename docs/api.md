# API 接口契约

本文按当前控制器, DTO 和服务实现整理, 路径统一省略 `/api` 前缀. 前端数据处理和考试接入顺序见 [前端接入](frontend-api-doc.md), 模块关系见 [系统架构](architecture.md).

## 公共约定

| 项目                 | 当前行为                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| 服务入口             | 默认端口 `3000`, 由 `PORT` 覆盖                                                                |
| 身份认证             | `Authorization: Bearer <token>` 或 `exam_token` HttpOnly Cookie, Bearer 优先                   |
| JWT 和 Cookie 有效期 | 4 小时                                                                                         |
| 成功响应             | `{ data: T }`, 下表的返回值均指 `T`                                                            |
| 二进制响应           | Excel 导出和文件下载直接返回文件, 没有 `data` 包装                                             |
| 错误响应             | `{ statusCode, message, timestamp }`, `message` 为字符串或字符串数组                           |
| HTTP 状态            | 当前控制器未覆盖默认成功状态: POST 为 `201`, GET/PATCH/PUT/DELETE 为 `200`                     |
| 参数校验             | DTO 使用白名单并拒绝未声明字段. 数值转换以 DTO 的 `@Type` 和控制器参数类型为准                 |
| 限流                 | 全局 100 次/60 秒. `AuthController` 上的覆盖配置为 5 次/60 秒, 适用于 register/login/me/logout 各处理器 |
| Swagger              | `/swagger`, 非生产环境开放, 或显式设置 `SWAGGER_ENABLED=true`                                  |
| CORS                 | 允许凭证. `CORS_ORIGIN` 为逗号分隔来源; 未配置时非生产环境允许来源, 生产环境关闭跨域           |

依据: [启动配置](../src/main.ts), [全局模块](../src/app.module.ts), [认证控制器](../src/auth/auth.controller.ts), [JWT 策略](../src/auth/jwt.strategy.ts), [JWT 有效期](../src/auth/auth.module.ts), [响应拦截器](../src/common/interceptors/transform.interceptor.ts), [错误过滤器](../src/common/filters/all-exceptions.filter.ts).

### 分页和数据类型

- 标为 "分页" 的响应形如 `{ data: T[], total, page, pageSize }`, 加上外层包装后为 `{ data: { data: T[], total, page, pageSize } }`.
- 通用分页默认 `page=1`, `pageSize=20`, 要求正整数且 `pageSize<=100`. 成绩列表单独接收数字参数, 没有使用通用分页 DTO, 当前未执行这些上下限校验.
- 用户列表, 分类列表/树, 分享列表, 公开题库和练题题目列表不分页.
- `Role`: `super_admin`, `question_admin`, `teacher`, `student`.
- `QuestionType`: `single`, `multiple`, `true_false`, `fill`, `short`, `program`.
- `Record.status`: `draft`, `submitted`. 时间字段通过 JSON 返回 ISO 时间字符串.
- 下文字段后缀 `?` 表示可选. `options`, `translations`, `answers` 在不同接口中存在对象与 JSON 字符串差异, 见 [前端字段处理表](frontend-api-doc.md#json-字段处理).

依据: [分页 DTO](../src/common/dto/pagination.dto.ts), [数据模型](../prisma/schema.prisma), [成绩控制器](../src/records/records.controller.ts).

### 权限符号

| 符号       | 含义                                                 |
| ---------- | ---------------------------------------------------- |
| 公开       | 无需登录, 仍受限流约束                               |
| 登录       | 任意已认证角色可进入控制器, 服务层仍可能限制数据范围 |
| 管理员     | `super_admin` 或 `question_admin`                    |
| 管理角色   | 管理员或 `teacher`                                   |
| 题库 V     | 服务层要求 `viewer`                                  |
| 题库 E     | 服务层要求 `editor`                                  |
| 题库 X     | 服务层要求 `exam_manager`                            |
| 题库 O     | 题库创建者或管理员                                   |
| 已分配学生 | `student` 且存在对应 `ExamParticipant`               |

管理员通常跳过服务中的题库权限检查. 非管理员只能访问自己创建或通过 `BankShare` 共享的题库. 当前 [权限服务](../src/common/services/bank-permission.service.ts) 把 `editor` 和 `exam_manager` 都设为等级 2, 两者都能通过 E/X 检查; `viewer` 为等级 1; `owner` 通过所有等级检查. 因此 E/X 是调用点要求, 并非两个互斥的业务权限域.

## 认证

依据: [AuthController](../src/auth/auth.controller.ts), [LoginDto](../src/auth/dto/login.dto.ts), [RegisterDto](../src/auth/dto/register.dto.ts).

| 方法 | 路径           | 权限 | 输入                                    | 返回 data                                                          |
| ---- | -------------- | ---- | --------------------------------------- | ------------------------------------------------------------------ |
| POST | `/auth/login`  | 公开 | Body: 非空字符串 `username`, `password` | `{ access_token, user: { sub, username, role } }`, 同时设置 Cookie |
| POST | `/auth/register` | 公开 | Body: 非空字符串 `username`, 至少 6 字符的 `password`, 32 位十六进制 `inviteCode` | `{ id, username, role, createdAt }`, 不设置 Cookie |
| GET  | `/auth/me`     | 登录 | 无                                      | `{ sub, username, role }`, 来自 JWT                                |
| POST | `/auth/logout` | 登录 | 无                                      | `{ success: true }`, 清除 Cookie                                   |

Cookie 路径为 `/api`, 始终 `HttpOnly`; 生产环境使用 `Secure` 和 `SameSite=None`, 其他环境使用 `SameSite=Lax`. 退出登录只清 Cookie, 不撤销已签发的 Bearer token. `/auth/me` 不重新查询用户资料.

注册角色取自邀请码, 请求不能传 `role` 或确认密码. 邀请码会去除首尾空格并转为小写. 无效或已使用返回 `400`, 用户名重复返回 `409`; 注册失败不会核销邀请码. 注册成功后通过登录接口建立会话.

## 用户

依据: [UsersController](../src/users/users.controller.ts), [UsersService](../src/users/users.service.ts), [创建 DTO](../src/users/dto/create-user.dto.ts), [更新 DTO](../src/users/dto/update-user.dto.ts).

| 方法   | 路径         | 权限          | 输入                                    | 返回 data            |
| ------ | ------------ | ------------- | --------------------------------------- | -------------------- |
| POST   | `/users`     | `super_admin` | Body: `username`, `password`, `role?`   | 用户信息             |
| GET    | `/users`     | 管理角色      | 无                                      | 用户数组             |
| POST   | `/users/registration-invites` | `super_admin` | Body: 必填 `role`, 取值为系统角色 | `{ id, code, role, createdAt, usedAt }` |
| GET    | `/users/registration-invites` | `super_admin` | 无 | 邀请码数组, 按创建时间降序 |
| PATCH  | `/users/:id` | `super_admin` | Body: `username?`, `password?`, `role?` | 更新后的用户信息     |
| DELETE | `/users/:id` | `super_admin` | 无                                      | 删除后的原始用户记录 |

创建时用户名为非空字符串, 密码至少 6 字符, 默认角色为 `student`. 创建, 列表, 更新返回 `id, username, role, createdAt`, 不含密码. 删除当前直接返回 Prisma 记录, 包含密码哈希字段, 客户端不应把删除响应当作脱敏用户资料展示. 没有 `GET /users/:id` 路由.

删除最后一名 `super_admin` 返回 `400`, 必须先创建另一名超级管理员或通过 `PATCH /users/:id` 将其他用户设为 `super_admin`; `question_admin` 不具备用户管理权限, 不能替代. 用户拥有题库时返回 `400` 并提示数量, 必须先通过题库更新接口将全部题库转移给其他用户. 原有答题记录和考试分配删除限制继续生效, 有题库分享时也拒绝删除, 需先移除分享关系. 检查和删除在 Serializable 事务中完成, 并发冲突返回 `409`, 客户端应刷新后重试.

邀请码为随机生成的 32 位十六进制字符串, `usedAt=null` 表示未使用. 每个邀请码只能成功注册一次; 角色在生成时确定.

## 题库分享和归档

依据: [QuestionBanksController](../src/question-banks/question-banks.controller.ts), [QuestionBanksService](../src/question-banks/question-banks.service.ts), [归档服务](../src/question-banks/bank-archive.service.ts), [题库 DTO](../src/question-banks/dto/create-question-bank.dto.ts), [分享 DTO](../src/question-banks/dto/create-share.dto.ts), [归档 DTO](../src/question-banks/dto/bank-archive.dto.ts).

| 方法   | 路径                                  | 权限                   | 输入                                                 | 返回 data                                                    |
| ------ | ------------------------------------- | ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| POST   | `/question-banks`                     | 管理角色               | Body: `name`, `description?`, `isPublic?`            | 题库, 含 `creator` 和 `_count`                               |
| GET    | `/question-banks`                     | 登录, 按可访问题库过滤 | Query: `page?`, `pageSize?`, `keyword?`, `isPublic?` | 分页题库, 额外含 `permission`                                |
| PATCH  | `/question-banks/:id`                 | 管理角色 + O           | Body: `name?`, `description?`, `isPublic?`, `createdBy?` | 更新后的题库, 含 `creator` 和 `_count`                       |
| DELETE | `/question-banks/:id`                 | 管理角色 + O           | 无                                                   | 已删除题库                                                   |
| GET    | `/question-banks/:id/export`          | 管理角色 + V           | 无                                                   | `{ meta, categories, questions }`                            |
| POST   | `/question-banks/:id/import`          | 管理角色 + E           | Body: `archive`, `mode?`                             | `{ categoriesImported, questionsImported, skipped, errors }` |
| POST   | `/question-banks/:id/shares`          | 管理角色 + O           | Body: `userId`, `role`                               | 创建或更新后的分享, 含 `user`                                |
| GET    | `/question-banks/:id/shares`          | 管理角色 + O           | 无                                                   | 分享数组, 含 `user`                                          |
| DELETE | `/question-banks/:id/shares/:shareId` | 管理角色 + O           | 无                                                   | 已删除分享                                                   |

`name` 为非空字符串, `isPublic` 默认 `false`. 查询 `isPublic` 使用 `true/false`. 题库列表的 `_count` 包含 `questions, categories, papers`, `permission` 为 `owner/viewer/editor/exam_manager/null`; 创建和更新响应没有追加 `permission`. 无题库详情 GET 路由. 题库存在题目, 分类或试卷时不能删除.

更新时可传 `createdBy` 转移所有权, 值必须为目标用户 UUID, 不接受 `null`. 目标必须是已存在的 `super_admin`, `question_admin` 或 `teacher`, 不存在返回 `404`, 学生返回 `400`. 仅当前所有者或管理员可以转移. 转移只修改题库归属, 保留题目, 分类, 试卷及分享关系; 原所有者不再因所有权获得权限, 但已有分享或管理员角色仍有效.

分享目标必须是教师, `role` 为 `viewer/editor/exam_manager`. 对同一题库和用户再次 POST 会更新原分享权限.

归档格式:

| 字段           | 内容                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `meta`         | `id, name, description?, exportedAt, version`, 导出版本为 `1`                                         |
| `categories[]` | `id, name, parentId?`                                                                                 |
| `questions[]`  | `id, title, type, options?, answer, analysis?, difficulty, score, categoryId?, locale, translations?` |

归档中的 `options` 和 `translations` 保留 JSON 字符串. `mode` 为 `skip` (默认), `merge` 或 `overwrite`. `skip` 和 `merge` 按目标已有分类名称, 题目 `title+type` 跳过重复内容; `overwrite` 先清空目标题库的题目和分类, 有试卷引用或题目图片时拒绝. 整次导入在一个事务内完成, 新记录生成新 ID.

当前归档只迁移分类和题目, 不包括试卷, 考试, 记录, 分享, 文件或题库配置. 导入服务不使用 `meta` 做版本分派或改写目标元信息. ID 映射仅包含本次新建分类, 因重名而跳过的分类不会映射到目标已有分类; 关联这些分类的题目或子分类会得到空分类/父分类关联.

## 分类

依据: [CategoriesController](../src/categories/categories.controller.ts), [CategoriesService](../src/categories/categories.service.ts), [创建 DTO](../src/categories/dto/create-category.dto.ts), [更新 DTO](../src/categories/dto/update-category.dto.ts).

| 方法   | 路径               | 权限         | 输入                                | 返回 data                                             |
| ------ | ------------------ | ------------ | ----------------------------------- | ----------------------------------------------------- |
| POST   | `/categories`      | 管理角色 + E | Body: `name`, `bankId`, `parentId?` | 分类                                                  |
| GET    | `/categories`      | 登录 + V     | Query: `bankId`                     | 平铺分类数组, 含直接 `children` 和 `_count.questions` |
| GET    | `/categories/tree` | 登录 + V     | Query: `bankId`                     | 递归 `children` 分类树, 含 `_count.questions`         |
| PATCH  | `/categories/:id`  | 管理角色 + E | Body: `name?`, `parentId?`          | 更新后的分类                                          |
| DELETE | `/categories/:id`  | 管理角色 + V | 无                                  | 已删除分类                                            |

创建校验父分类存在且属于同一题库. 更新目前直接保存 DTO, 没有执行同等的跨题库, 环引用校验. 有子分类或题目时不能删除. 删除目前只复用详情的 V 检查. `bankId` 在列表/树接口通过独立查询参数读取, 没有 DTO 必填校验, 客户端应显式传入. 没有 `GET /categories/:id` 路由.

## 题目和 Excel

依据: [QuestionsController](../src/questions/questions.controller.ts), [QuestionsService](../src/questions/questions.service.ts), [创建 DTO](../src/questions/dto/create-question.dto.ts), [更新 DTO](../src/questions/dto/update-question.dto.ts), [查询 DTO](../src/questions/dto/query-question.dto.ts), [多语言处理](../src/common/utils/localize.ts).

| 方法   | 路径                             | 权限                   | 输入                                                                                                 | 返回 data                                                |
| ------ | -------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| POST   | `/questions`                     | 管理角色 + E           | Body: 下述创建字段                                                                                   | 题目, 含 `category`                                      |
| GET    | `/questions`                     | 登录, 按可访问题库过滤 | Query: `page?`, `pageSize?`, `bankId?`, `type?`, `categoryId?`, `difficulty?`, `keyword?`, `locale?` | 分页题目, 含 `category`                                  |
| GET    | `/questions/export`              | 管理角色 + V           | Query: `bankId`, `categoryId?`                                                                       | Excel 文件 `questions.xlsx`                              |
| POST   | `/questions/import`              | 管理角色 + E           | Query: `bankId`; multipart 字段 `file`                                                               | `{ total, success, failed, errors: [{ row, message }] }` |
| GET    | `/questions/:id`                 | 登录 + V               | Query: `locale?`                                                                                     | 题目, 含 `category`                                      |
| PATCH  | `/questions/:id`                 | 管理角色 + E           | Body: 下述更新字段                                                                                   | 更新后的题目, 含 `category`                              |
| DELETE | `/questions/:id`                 | 管理角色 + E           | 无                                                                                                   | 已删除题目                                               |
| POST   | `/questions/:id/images`          | 管理角色 + E           | multipart 字段 `file`, `optionKey?`                                                                  | 图片元数据和 GET 预签名 URL                              |
| DELETE | `/questions/:id/images/:imageId` | 管理角色 + E           | 无                                                                                                   | `{ id }`                                                 |

创建必填 `title, type, bankId, answer`. 可选 `options, analysis, difficulty, score, categoryId, locale, translations`. `difficulty` 为 1-5 的整数, 默认 1; `score` 为正整数, 默认 1; 常规创建/更新的 `locale` 只接受 `zh/en`, 默认 `zh`. 更新字段与创建相同, 全部可选, 但不能修改 `bankId`.

`translations` 按语言代码保存 `title, options?, answer?, analysis?`. 更新时整体替换该字段. GET 支持按 `locale` 覆盖已翻译的内容, 缺失翻译回退到主内容. `locale` 字段本身仍表示题目主语言. 创建会验证分类属于同一题库; 更新目前未重新验证这一条件. 题目被试卷引用时不能删除.

Excel 接口使用导出文件的列顺序: 标题, 题型, 选项, 答案, 解析, 难度, 分值, 分类, 主语言, 翻译. 题型使用中文名称, 分类使用目标题库内已有分类名称. 导入只处理首个工作表, 标题, 题型, 答案必填, 选项和翻译列为 JSON 文本. 文件限制 10 MiB, MIME 接受 XLSX 和 Excel 类型, 实际读取器为 XLSX. 每行独立写入, 允许部分成功; `total` 是表格数据行数, 空行跳过后可能不等于 `success+failed`. `bankId` 与分类列表一样没有查询 DTO 必填校验, 调用时必须显式提供.

### 题目图片

先创建题目, 再通过图片上传接口关联一张或多张图片. 单张限制 10 MiB, 接受 PNG/JPEG/GIF/WebP, 同时检查 MIME 和文件头; 不接受 SVG. 图片在中英文内容间共享, 按上传时间和 ID 排序. 删除图片检查题库编辑权限和图片归属; 删除未被试卷引用的题目时会先清理图片对象和元数据.

上传可增加 multipart 字段 `optionKey`, 例如 `C` 或 `D`, 将图片关联到对应选项. 省略时为题干图片. 服务校验该 key 存在于题目的选项对象, 或选项数组的 `label` 中; 不存在返回 400. 图片响应的 `optionKey` 为字符串或 `null`, 前端据此在选项下或题干后显示图片.

GET 题目列表/详情, GET 试卷列表/详情, GET 考试详情和公开练题列表中的题目新增 `images` 数组, 无图片时为 `[]`. 每项为 `{ id, originalName, mimeType, size, optionKey, url, expiresAt }`, 上传也返回这个结构. `url` 是有效期 15 分钟的 S3 GET 预签名 URL, `expiresAt` 是 ISO 时间. 客户端直接使用 URL 加载图片, 到期后重新读取有权限的题目/试卷/考试/练习接口获取新 URL. URL 不持久化, 获得链接后可在有效期内读取, 删除权限或关闭公开不会立即撤销已签发链接.

对象键前缀为 `question-banks/{bankId}/questions/{questionId}/images/`, 文件名由 UUID 和实际图片类型的扩展名组成. 数据库仅保存关联和对象键, 图片元数据的持久化 `url` 为 `null`. 题库 JSON 归档和 Excel 不导出图片; 归档覆盖含图片的题库会返回 400, 需先明确删除图片. 来源: [图片服务](../src/files/question-images.service.ts), [S3 签名](../src/files/s3.service.ts).

## 试卷

依据: [PapersController](../src/papers/papers.controller.ts), [PapersService](../src/papers/papers.service.ts), [创建 DTO](../src/papers/dto/create-paper.dto.ts), [更新 DTO](../src/papers/dto/update-paper.dto.ts), [查询 DTO](../src/papers/dto/query-paper.dto.ts).

| 方法   | 路径          | 权限                   | 输入                                                            | 返回 data                         |
| ------ | ------------- | ---------------------- | --------------------------------------------------------------- | --------------------------------- |
| POST   | `/papers`     | 管理角色 + E           | Body: `name`, `duration`, `totalScore`, `bankId`, `questionIds` | 试卷, 含有序题目关系和题目        |
| GET    | `/papers`     | 登录, 按可访问题库过滤 | Query: `page?`, `pageSize?`, `bankId?`, `keyword?`              | 分页试卷, 含题目和 `_count.exams` |
| GET    | `/papers/:id` | 登录 + V               | 无                                                              | 试卷, 含题目和 `_count.exams`     |
| PATCH  | `/papers/:id` | 管理角色 + E           | Body: `name?`, `duration?`, `totalScore?`, `questionIds?`       | 更新后的试卷, 含题目              |
| DELETE | `/papers/:id` | 管理角色 + V           | 无                                                              | 已删除试卷                        |

`duration` 为分钟数, 与 `totalScore` 一样要求正整数. `questionIds` 为 UUID v4 数组, 全部题目必须存在且属于试卷题库, 数组顺序写入 `sortOrder`. 嵌套结构为 `questions[].question`, 关系上另含 `paperId, questionId, sortOrder`.

创建以及更新 `questionIds` 时, 服务按题目已有 `score` 求和覆盖 `totalScore`. 更新不含 `questionIds` 时, 当前直接保存提交的 `totalScore`. 题目分值后续变化不会自动重算已有试卷总分. 试卷被考试引用时不能删除; 当前删除只要求 V.

## 考试

依据: [ExamsController](../src/exams/exams.controller.ts), [ExamsService](../src/exams/exams.service.ts), [创建 DTO](../src/exams/dto/create-exam.dto.ts), [更新 DTO](../src/exams/dto/update-exam.dto.ts), [查询 DTO](../src/exams/dto/query-exam.dto.ts).

| 方法   | 路径         | 权限                       | 输入                                                                         | 返回 data                        |
| ------ | ------------ | -------------------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| POST   | `/exams`     | 管理角色 + X               | Body: `name`, `paperId`, `startTime`, `endTime`, `showScore?`, `studentIds?` | 考试详情                         |
| GET    | `/exams`     | 登录, 学生只看已分配考试   | Query: `page?`, `pageSize?`, `keyword?`, `bankId?`                           | 分页考试                         |
| GET    | `/exams/:id` | 管理角色 + V, 或已分配学生 | 无                                                                           | 考试详情, 学生题目删除答案和解析 |
| PATCH  | `/exams/:id` | 管理角色 + X               | Body: `name?`, `startTime?`, `endTime?`, `showScore?`, `studentIds?`         | 更新后的考试详情                 |
| DELETE | `/exams/:id` | 管理角色 + V               | 无                                                                           | 已删除考试                       |

时间使用 ISO 字符串, 必须 `startTime<endTime`. `showScore` 默认 `false`. `studentIds` 是学生 UUID v4 数组, 服务校验角色并去重. 创建不传时无人获分配; 更新不传时保留原分配, 传空数组时清空, 传其他数组时整体替换. 更新不能更换 `paperId`.

考试响应包含 `paper`, `participants[].user` 和 `_count.records/participants`. 列表中的 `paper.questions` 只有关联记录, 详情才包含完整题目. 学生列表仍包含参与者列表; 学生详情删除题目及翻译中的 `answer/analysis`. 学生查询分支忽略 `bankId` 筛选. 教师列表按可访问题库过滤.

获取详情不校验考试时间窗口. 删除先拒绝已有 submitted 记录的考试, 再删除草稿和参与者, 最后删除考试. 当前删除只要求 V. `showScore` 没有在提交接口中控制字段返回, 见下节.

## 草稿, 交卷和成绩

依据: [RecordsController](../src/records/records.controller.ts), [RecordsService](../src/records/records.service.ts), [提交 DTO](../src/records/dto/submit-answer.dto.ts), [草稿 DTO](../src/records/dto/save-draft.dto.ts).

| 方法 | 路径                           | 权限         | 输入                        | 返回 data                                           |
| ---- | ------------------------------ | ------------ | --------------------------- | --------------------------------------------------- |
| PUT  | `/exams/:examId/records/draft` | 已分配学生   | Body: `answers` 对象        | draft 记录, `answers` 为 JSON 字符串                |
| GET  | `/exams/:examId/records/draft` | 已分配学生   | 无                          | `{ answers: 对象 }`, 没有记录时为空对象             |
| POST | `/exams/:examId/records`       | 已分配学生   | Body: `answers` 对象        | submitted 记录, 含 `score` 和 JSON 字符串 `answers` |
| GET  | `/exams/:examId/records`       | 管理角色 + X | Query: `page?`, `pageSize?` | 分页 submitted 记录, `answers` 已解析, 含 `user`    |
| GET  | `/exams/:examId/records/stats` | 管理角色 + X | 无                          | `{ count, max, min, avg }`                          |

答案对象为题目 ID 到字符串的映射. 非本卷题目的 key 被过滤. 保存草稿会整体替换已有草稿内容, 不做字段合并. 保存和提交均要求 `startTime<=now<=endTime`; 读取草稿只检查分配和提交状态. 不根据 `Paper.duration` 维护每位学生的独立计时.

提交时已有草稿升级为 submitted, 无草稿则直接创建. 重复提交, 提交后保存/读取草稿返回 `400`. 记录由 `(examId,userId)` 唯一约束关联. 未分配学生访问考试详情为 `403`, 访问这三个答题端点为 `400`.

| 题型                           | 自动判分                                       |
| ------------------------------ | ---------------------------------------------- |
| `single`, `true_false`, `fill` | 两端去空格后与主答案严格比较                   |
| `multiple`                     | 英文逗号拆分, 每项去空格, 排序后比较, 全对得分 |
| `short`, `program`             | 自动得分为 0, 当前无人工阅卷接口               |

提交后的 `answers` 保存每题 `{ answer, correct, score, earned }`, 分别为学生答案, 标准答案, 题目满分, 得分. 当前提交响应无论 `showScore` 是否开启都返回总分和标准答案明细. 成绩列表只返回已提交记录, 统计只计算已提交且分数非空的记录, 平均分四舍五入为整数; 无记录时四项均为 0. 没有学生查询已提交成绩的单独 GET 路由.

## 文件

依据: [FilesController](../src/files/files.controller.ts), [FilesService](../src/files/files.service.ts).

| 方法   | 路径            | 权限                     | 输入                        | 返回 data        |
| ------ | --------------- | ------------------------ | --------------------------- | ---------------- |
| POST   | `/files/upload` | 管理角色                 | multipart 字段 `file`       | 文件元数据       |
| GET    | `/files`        | 管理角色, 教师仅本人上传 | Query: `page?`, `pageSize?` | 分页文件元数据   |
| GET    | `/files/:id`    | 管理角色, 教师仅本人上传 | 无                          | 原始文件流       |
| DELETE | `/files/:id`    | 管理员                   | 无                          | 已删除文件元数据 |

上传限制 10 MiB. MIME 白名单覆盖 JPEG/PNG/GIF/WebP, PDF, XLSX/DOCX/PPTX, 纯文本, ZIP/TAR/GZIP, 精确列表以控制器为准. 元数据包含 `id, originalName, mimeType, size, s3Key, url, uploadedBy, questionId, optionKey, createdAt`. 下载通过后端权限检查后代理 S3 流, 不把元数据 `url` 当作等价的鉴权下载入口.

## 操作日志

依据: [LogsController](../src/logs/logs.controller.ts), [查询 DTO](../src/logs/dto/query-log.dto.ts), [日志拦截器](../src/common/interceptors/operation-log.interceptor.ts).

| 方法 | 路径    | 权限          | 输入                                                                                                  | 返回 data    |
| ---- | ------- | ------------- | ----------------------------------------------------------------------------------------------------- | ------------ |
| GET  | `/logs` | `super_admin` | Query: `page?`, `pageSize?`, `userId?`, `username?`, `action?`, `resource?`, `startDate?`, `endDate?` | 分页操作日志 |

`username` 为包含匹配, 日期按 `createdAt` 闭区间筛选. `action` 的已生成值为 `CREATE/UPDATE/DELETE`, 查询 DTO 本身只要求字符串. 日志字段为 `id, userId, username, action, resource, resourceId, method, path, ip, userAgent, createdAt`.

成功的 POST/PATCH/PUT/DELETE 请求触发异步日志写入, PUT 映射到 UPDATE. 登录和公开练题也在该范围, 用户可为空. `resource/resourceId` 从 `/api` 后前两段路径取得, 并非所有嵌套路由都对应实际资源 ID. 没有日志详情路由.

## AI 辅助

依据: [AiController](../src/ai/ai.controller.ts), [AiService](../src/ai/ai.service.ts), [出题 DTO](../src/ai/dto/generate-questions.dto.ts), [组卷 DTO](../src/ai/dto/smart-paper.dto.ts), [翻译 DTO](../src/ai/dto/translate-question.dto.ts).

所有 AI 路由要求管理角色和题库 E 权限.

| 方法 | 路径                   | Body                                                                                          | 返回 data 和写入行为                                      |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| POST | `/ai/questions`        | `topic`, `type`, `bankId`, `count?`, `difficulty?`, `categoryId?`, `locale?`                  | `{ count, questions }`, 直接保存有效生成题目              |
| POST | `/ai/analysis/:id`     | 无                                                                                            | 更新后的题目, 直接保存 `analysis`                         |
| POST | `/ai/translate/:id`    | `targetLocale`                                                                                | `{ sourceLocale, targetLocale, translation }`, 不写数据库 |
| POST | `/ai/smart-paper/rule` | `name`, `duration`, `totalScore`, `bankId`, `rules`                                           | 创建后的试卷, 含题目                                      |
| POST | `/ai/smart-paper/ai`   | `name`, `duration`, `totalScore`, `bankId`, `subject`, `difficultyPreference?`, `categoryId?` | 创建后的试卷, 含题目                                      |

出题 `count` 为 1-20, 默认 5; 难度为 1-5, 未传时落库为 3; 生成题目分值为 1. 返回 `count` 为实际创建数, 不保证等于请求数. 出题的 `locale` DTO 只校验字符串, 前端应传 `zh/en`. AI 翻译只接受 `zh/en`, 必须与题目主语言不同. 保存翻译需要再调用题目 PATCH, 合并所需语言后提交完整 `translations`.

规则字段为 `categoryId?`, `type?`, `difficulty?`, `count`, `scorePerQuestion`. `count` 和 `scorePerQuestion` 要求正整数; `difficulty` 当前只限制整数且不小于 1. 每条规则独立抽题, 数量不足返回 `400`. 当前 `scorePerQuestion` 未参与赋分, 实际题目总分必须等于请求 `totalScore`, 否则返回 `400`. 多条规则可能抽到相同题目, 服务未做跨规则去重.

AI 组卷向模型发送最多 100 道候选题, 校验返回 ID 属于查询到的候选集合后保存. 当前没有重新校验总分等于所选题目分数之和, 也没有去重返回 ID. 普通组卷, 规则组卷, AI 组卷的总分行为不能视作同一个契约.

## 公开练题

依据: [PracticeController](../src/practice/practice.controller.ts), [PersonalPracticeController](../src/practice/personal-practice.controller.ts), [PracticeService](../src/practice/practice.service.ts), [核对 DTO](../src/practice/dto/check-answer.dto.ts), [个人查询 DTO](../src/practice/dto/query-personal-practice.dto.ts).

| 方法 | 路径                                                  | 权限 | 输入                          | 返回 data                                               |
| ---- | ----------------------------------------------------- | ---- | ----------------------------- | ------------------------------------------------------- |
| GET  | `/practice/banks`                                     | 公开 | 无                            | 公开题库数组: `id, name, description, _count.questions` |
| GET  | `/practice/banks/:bankId/questions`                   | 公开 | Query: `mode?`                | 可练习题目数组, 无分页                                  |
| GET  | `/practice/banks/:bankId/question-pages`              | 公开 | Query: `mode?, page?, pageSize?, keyword?, seed?, collection?, questionId?` | `{ data, total, questionTotal, practiceTotal, page, pageSize, seed, initialIndex }` |
| GET  | `/practice/banks/:bankId/questions/:questionId`        | 公开 | 无                            | 单道题目, 不含答案和解析                               |
| POST | `/practice/banks/:bankId/questions/:questionId/check` | 公开 | Body: 非空字符串 `userAnswer` | `{ correct, graded, answer, analysis }`                 |
| GET  | `/practice/mine/summary`                             | 登录 | 无                            | `{ wrongCount, favoriteCount, attemptCount, correctCount, gradedCount }` |
| GET  | `/practice/mine/questions`                           | 登录 | Query: `collection`, `bankId?, page?, pageSize?` | `{ data, total, page, pageSize }` |
| GET  | `/practice/mine/records`                             | 登录 | Query: `bankId?, page?, pageSize?` | `{ data, total, page, pageSize }` |
| PUT  | `/practice/banks/:bankId/questions/:questionId/favorite` | 登录 | 无                         | `{ isFavorite: true }` |
| DELETE | `/practice/banks/:bankId/questions/:questionId/favorite` | 登录 | 无                      | `{ isFavorite: false }` |
| DELETE | `/practice/mine/wrong-questions/:questionId`        | 登录 | 无                            | `{ success: true }` |

练习接口可选验证 Bearer 或 `exam_token` Cookie. 未登录、令牌无效或过期时仅可顺序练习前 50 题, 搜索范围也限于这 50 题. 匿名随机请求以及前 50 题以外的单题读取和答案核对返回 `403`, 提示登录. 任意有效登录角色可练习完整公开题库并使用随机模式. 题库未公开仍返回 `404`.

`mode` 默认 `sequential`, 按原始题干开头的 `Question #数字` 编号数值升序; 无编号题目排在最后, 相同编号及无编号题目保持 ID 升序. 排序不受翻译语言影响. 原 `/questions` 接口对已登录用户保留全量数组和随机打乱行为, 未登录时最多返回前 50 题; 该接口的非 `random` 值走顺序分支.

练习页使用 `/question-pages`, 默认 `page=1, pageSize=50`, `pageSize` 最大为 100. 分页项增加从 0 开始的 `index`, 表示题目在本次练习中的位置; `total` 是可练习范围内的匹配数量, 普通练习的 `questionTotal` 是题库总题数, `practiceTotal` 是当前用户可练习题数, 匿名时最多为 50. 限制先于搜索和分页执行, 改变页码或每页数量不能扩展可访问范围. `keyword` 匹配可练习题目的题干、选项及翻译标题/选项, 忽略首尾空格和英文大小写, 不搜索答案和解析. 搜索响应额外返回匹配题目位置数组 `matchingIndexes`, 用于上一题/下一题时同步搜索导航所在页. `mode` 只接受 `sequential/random`. 响应返回 `seed`, 后续翻页和搜索应复用它, 以保持随机顺序, 避免重复或遗漏. 不传种子时生成新种子.

分页查询先读取 ID 和标题索引以保持原始编号排序, 只读取并签发当前页的完整题目和图片链接. 搜索时在服务端读取可练习范围的可见内容进行匹配, 返回当前页最多 `pageSize` 道题. 单题接口同时校验题库公开状态、题目归属和匿名访问范围, 可用于刷新当前题的图片链接.

题目字段为 `id, title, type, options, difficulty, score, locale, translations, images, isFavorite, isWrong`. 列表和单题不查询主答案/解析, 并只保留翻译里的标题和选项. `isFavorite/isWrong` 为当前登录用户的状态, 匿名请求两者均为 `false`. 核对答案会确认题库公开且题目属于该题库, 再返回主语言标准答案和解析. 比较规则与考试客观题相同, 客观题返回 `graded=true`; 简答/编程题固定返回 `correct=false, graded=false` 供自行对照, 不视为答错.

### 我的练习数据

任意有效登录角色均可使用个人接口, 无需教师分享权限. 未登录或令牌失效返回 `401`. 用户身份仅从当前 JWT 取得, 查询和核对 DTO 不接受 `userId`. 汇总, 收藏, 错题和历史均只读取本人的公开题库数据; 题库关闭公开后这些数据不再显示, 核对和收藏该题库返回 `404`, 数据仍保留在数据库.

登录后的每次核对新增一条 `PracticeAttempt`, 并在同一数据库事务中更新该用户与题目的练习状态. 客观题答错加入错题, 答对移出错题; 主观题的历史 `correct=null`, 不加入错题, 不计入 `gradedCount/correctCount`. 匿名核对只返回结果, 不保存练习数据. `attemptCount` 为全部核对次数, `correctCount` 为客观题答对次数, `gradedCount` 为可自动判分的核对次数, 正确率可按 `correctCount / gradedCount` 计算; 分母为 0 时显示无数据. `wrongCount/favoriteCount` 为当前错题/收藏题目数.

`/mine/questions` 的 `collection` 必须为 `wrong` 或 `favorites`. 分页项为 `{ question, bank: { id, name }, attemptCount, wrongCount, lastAttemptAt }`, 其中 `question` 与安全练习题目一致, 不含答案和解析. 项内 `wrongCount` 为该题历史答错次数, 手动移出错题或答对不会清除这个计数; `lastAttemptAt` 没有练习时为 `null`. `/mine/records` 的项为 `{ id, userAnswer, correct, answer, analysis, createdAt, question, bank: { id, name } }`, 返回该次核对时保存的答案和解析; 嵌套 `question` 仍不含主答案及翻译答案. 两个列表支持可选 `bankId` 和通用分页.

收藏与取消收藏幂等, 不创建练习历史. 取消收藏保留错题和历史, 手动移出错题也保留收藏和历史. 同一题再次答错后会重新加入错题. 删除题目时通过外键级联清理关联的个人状态和练习历史, 不阻止原有题目删除流程.

分页练习接口的 `collection=wrong|favorites` 要求登录, 先按当前用户的错题或收藏过滤, 再排序, 搜索和分页. 此时 `questionTotal/practiceTotal` 均为本次集合题数, `index/matchingIndexes` 相对本次集合编号, 随机模式同样复用 `seed`. 搜索不会引入集合外的题目.

可选 `questionId` 用于从个人列表打开指定题目, 服务端在本次集合和搜索匹配范围内定位, 返回该题所在的实际 `page` 及集合位置 `initialIndex`, 覆盖请求中的页码. 题目不在当前范围时返回 `404`, 不绕过集合或匿名限制. 不传 `questionId` 时 `initialIndex=0`.
