# 部署说明

## 1. 一键发布到阿里云

在仓库根目录执行：

```bash
./deploy-aliyun.sh
```

该命令会同步 `mex-cloud-service-prod-admin/` 到阿里云、保留远端 `.env`、执行幂等迁移、重建 `app` 容器，并验证健康检查与 LLM 启动状态。默认服务器为 `root@8.162.11.60`，可以覆盖：

```bash
ALIYUN_SSH_TARGET=root@<服务器IP> ./deploy-aliyun.sh
```

## 2. 手动启动容器
```bash
docker compose up -d --build
```

## 3. 初始化数据库
先找 MySQL 容器：
```bash
docker ps
```

执行：
```bash
docker exec -i <mysql容器ID> mysql -uroot -proot < init.sql
```

已部署旧版本时，执行增量迁移：

```bash
docker exec -i <mysql容器ID> mysql -uroot -proot < migrate_filter_groups.sql
```

## 4. 重启 app
```bash
docker compose restart app
```

启用报酬区间 AI 解析时，在部署环境的 `.env` 中设置 `DEEPSEEK_API_KEY`。该文件已被 Git 忽略；不要把密钥写入 `docker-compose.yml` 或提交到仓库。

## 5. 访问
- 后台页面：`http://127.0.0.1:3000/admin/`
- 健康检查：`http://127.0.0.1:3000/health`

## 6. 默认账号
- 用户名：`admin`
- 密码：`123456`

## 7. 说明
这版已经把后台页面集成进 Node 服务，通过 `/admin` 访问，不会有跨域问题。
