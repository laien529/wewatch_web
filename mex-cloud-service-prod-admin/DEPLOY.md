# 部署说明

## 1. 启动容器
```bash
docker compose up -d --build
```

## 2. 初始化数据库
先找 MySQL 容器：
```bash
docker ps
```

执行：
```bash
docker exec -i <mysql容器ID> mysql -uroot -proot < init.sql
```

## 3. 重启 app
```bash
docker compose restart app
```

## 4. 访问
- 后台页面：`http://127.0.0.1:3000/admin/`
- 健康检查：`http://127.0.0.1:3000/health`

## 5. 默认账号
- 用户名：`admin`
- 密码：`123456`

## 6. 说明
这版已经把后台页面集成进 Node 服务，通过 `/admin` 访问，不会有跨域问题。
