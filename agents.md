# 项目 Agent 协作说明

## 1. 仓库结构

- 当前仓库根目录不是实际应用代码目录，主项目位于 `mex-cloud-service-prod-admin/`。
- 如果要改后端逻辑，请优先查看 `mex-cloud-service-prod-admin/src/`。
- 如果要改管理后台页面，请查看 `mex-cloud-service-prod-admin/public/admin/`。
- 数据库初始化和迁移脚本位于 `mex-cloud-service-prod-admin/init.sql`、`migrate_*.sql`。

## 2. 项目概况

- 技术栈：Node.js + Express + MySQL。
- 管理后台是静态页面，直接由 Express 挂载在 `/admin`，没有前端构建流程。
- 鉴权方式：`Bearer Token`，JWT 密钥来自 `JWT_SECRET`。
- 服务启动后会自动尝试初始化默认管理员账号。

## 3. 常用目录

- `mex-cloud-service-prod-admin/src/server.js`：启动入口。
- `mex-cloud-service-prod-admin/src/app.js`：路由与 API 主逻辑。
- `mex-cloud-service-prod-admin/src/db.js`：MySQL 连接池。
- `mex-cloud-service-prod-admin/src/auth.js`：JWT 鉴权中间件。
- `mex-cloud-service-prod-admin/src/init/initUser.js`：默认管理员初始化逻辑。
- `mex-cloud-service-prod-admin/public/admin/index.html`：后台页面入口。
- `mex-cloud-service-prod-admin/DEPLOY.md`：部署说明。
- `mex-cloud-service-prod-admin/.env.example`：环境变量样例。

## 4. 启动方式

### 本地直跑

在 `mex-cloud-service-prod-admin/` 目录执行：

```bash
npm install
npm start
```

默认端口为 `3000`。

### Docker

在 `mex-cloud-service-prod-admin/` 目录执行：

```bash
docker compose up -d --build
```

首次启动后，需要按 `DEPLOY.md` 导入 `init.sql` 初始化数据库。

## 5. 环境变量

参考 `mex-cloud-service-prod-admin/.env.example`：

- `PORT`
- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `JWT_SECRET`
- `DEFAULT_ADMIN_USER`
- `DEFAULT_ADMIN_PASS`

如果新增环境变量，记得同步更新 `.env.example` 和部署文档。

## 6. 开发约定

- 保持接口返回结构一致，当前风格为 `{ code, message, data }`。
- 新增受保护接口时，复用 `src/auth.js` 的 JWT 校验方式。
- 修改数据库结构时，同时更新初始化脚本和对应迁移脚本，不要只改运行时代码。
- 因为后台是静态页面直出，前端改动应尽量保持轻量，不要默认引入额外构建工具。
- 修改启动、部署、端口、数据库初始化逻辑时，同步更新 `DEPLOY.md`。

## 7. 联调与验证

- 健康检查：`GET /health`
- 后台入口：`GET /admin/`
- 登录接口：`POST /api/auth/login`
- 消息列表：`GET /api/messages`
- 批量上传：`POST /api/upload/batch`

当前仓库未看到现成的自动化测试和 lint 配置。做完改动后，至少应进行以下验证：

- 服务可以正常启动。
- `/health` 返回正常。
- `/admin/` 页面可访问。
- 登录、消息查询、已读标记等相关接口能完成基本冒烟测试。

## 8. 易踩坑说明

- 仓库根目录与实际项目目录不同，执行命令前先确认当前路径。
- `initDefaultUser()` 会在服务启动时等待数据库就绪，如果数据库没初始化成功，默认账号不会自动创建。
- `public/admin/` 下文件是线上后台界面的一部分，改动前要确认是否影响现有使用流程。
