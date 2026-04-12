# Mex Cloud 管理后台接口文档

本文档根据当前后端实现生成，供客户端对接使用。

## 1. 基础信息

- 默认服务地址：`http://127.0.0.1:3000`
- 默认后台页面：`GET /admin/`
- 请求体格式：`application/json`
- 全局 JSON 请求体大小限制：`5mb`
- 通用响应结构：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

## 2. 鉴权说明

当前暂不要求消息上传和消息查询接口携带 JWT。以下接口无需鉴权：

- `GET /health`
- `GET /admin/`
- `POST /api/auth/login`
- `POST /api/upload/batch`
- `GET /api/messages`
- `GET /api/messages/:id`

以下管理操作仍需要携带 JWT：

- `POST /api/messages/read`
- `DELETE /api/messages`

调用仍需鉴权的管理接口时，请求头格式如下：

```http
Authorization: Bearer <token>
```

管理接口使用的 Token 有效期为 7 天。

鉴权失败响应：

```json
{
  "code": 401,
  "message": "no token"
}
```

或：

```json
{
  "code": 401,
  "message": "invalid token"
}
```

## 3. 登录

### `POST /api/auth/login`

用于获取登录 token。

请求参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `username` | string | 是 | 用户名 |
| `password` | string | 是 | 密码 |

请求示例：

```json
{
  "username": "admin",
  "password": "123456"
}
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "token": "jwt-token-string",
    "username": "admin"
  }
}
```

失败响应：

```json
{
  "code": 1,
  "message": "user not found"
}
```

```json
{
  "code": 1,
  "message": "wrong password"
}
```

## 4. 批量上传消息

### `POST /api/upload/batch`

无需鉴权。用于批量写入消息记录。

请求参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `records` | array | 是 | 消息对象数组 |

`records` 中每个对象可以包含任意字段，后端会完整保存到 `contentJson`。其中以下字段会被额外识别：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `recordKey` | string | 否 | 客户端侧消息唯一标识。同一批次内相同 `recordKey` 会被跳过 |
| `sender` | string | 否 | 发送人，优先级最高 |
| `from` | string | 否 | 发送人备用字段 |
| `senderName` | string | 否 | 发送人备用字段 |
| `content` | string | 否 | 消息正文，列表展示时常用 |
| `message` | string | 否 | 消息正文备用字段 |

发送人提取优先级：

```text
sender -> from -> senderName -> ''
```

请求示例：

```json
{
  "records": [
    {
      "recordKey": "msg-001",
      "sender": "张三",
      "content": "这是一条测试消息",
      "extra": {
        "source": "client-a"
      }
    },
    {
      "recordKey": "msg-002",
      "from": "李四",
      "message": "另一条测试消息"
    }
  ]
}
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "taskId": "1712900000000",
    "batchCount": 2
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `taskId` | string | 服务端按当前时间戳生成的批次 ID |
| `batchCount` | number | 本次实际插入数量 |

注意事项：

- 当前实现只会去重同一个请求批次内重复的 `recordKey`。
- `recordKey` 为空时不会参与批次内去重。
- 数据库中 `task_id + record_key` 有唯一索引，但由于每次上传都会生成新的 `taskId`，不同批次的相同 `recordKey` 仍可写入。

## 5. 查询消息列表

### `GET /api/messages`

无需鉴权。用于分页查询消息。

查询参数：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `page` | number | 否 | `1` | 页码，小于 1 时按 1 处理 |
| `pageSize` | number | 否 | `20` | 每页数量，范围为 1 到 100 |
| `startTime` | string | 否 | - | 开始时间，过滤 `created_at >= startTime` |
| `endTime` | string | 否 | - | 结束时间，过滤 `created_at <= endTime` |
| `sender` | string | 否 | - | 发送人模糊查询 |

时间参数建议格式：

```text
YYYY-MM-DD HH:mm:ss
```

请求示例：

```http
GET /api/messages?page=1&pageSize=20&sender=张三&startTime=2026-04-12%2000:00:00&endTime=2026-04-12%2023:59:59
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": 1,
        "taskId": "1712900000000",
        "recordKey": "msg-001",
        "sender": "张三",
        "contentJson": {
          "recordKey": "msg-001",
          "sender": "张三",
          "content": "这是一条测试消息"
        },
        "createdAt": "2026-04-12T10:20:30.000Z",
        "isRead": false
      }
    ],
    "unreadTotal": 10,
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `list` | array | 当前页消息列表 |
| `unreadTotal` | number | 全部未读数量，不受当前筛选条件影响 |
| `pagination.page` | number | 当前页码 |
| `pagination.pageSize` | number | 当前每页数量 |
| `pagination.total` | number | 当前筛选条件下的总数 |
| `pagination.totalPages` | number | 当前筛选条件下的总页数，最小为 1 |

消息对象字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | number | 消息数据库 ID |
| `taskId` | string | 上传批次 ID |
| `recordKey` | string/null | 客户端消息唯一标识 |
| `sender` | string | 服务端提取后的发送人 |
| `contentJson` | object | 客户端上传的原始消息对象 |
| `createdAt` | string | 创建时间 |
| `isRead` | boolean | 是否已读 |

## 6. 查询消息详情

### `GET /api/messages/:id`

无需鉴权。用于按 ID 查询单条消息。

路径参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | number | 是 | 消息 ID |

请求示例：

```http
GET /api/messages/1
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": 1,
    "taskId": "1712900000000",
    "recordKey": "msg-001",
    "sender": "张三",
    "contentJson": {
      "recordKey": "msg-001",
      "sender": "张三",
      "content": "这是一条测试消息"
    },
    "createdAt": "2026-04-12T10:20:30.000Z",
    "isRead": false
  }
}
```

不存在时响应：

```json
{
  "code": 1,
  "message": "not found"
}
```

该响应的 HTTP 状态码为 `404`。

## 7. 标记消息为已读

### `POST /api/messages/read`

需要鉴权。用于批量将消息标记为已读。

请求参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ids` | number[] | 是 | 消息 ID 数组 |

请求示例：

```json
{
  "ids": [1, 2, 3]
}
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "updated": 3
  }
}
```

失败响应：

```json
{
  "code": 1,
  "message": "ids is empty"
}
```

注意事项：

- `ids` 会被转换为整数，无法转换或为 0 的值会被过滤。
- 当前返回的 `updated` 是请求中有效 ID 的数量，不是数据库实际命中的行数。

## 8. 删除消息

### `DELETE /api/messages`

需要鉴权。用于批量删除消息。

请求参数：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ids` | number[] | 是 | 消息 ID 数组 |

请求示例：

```json
{
  "ids": [1, 2, 3]
}
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "deleted": 3
  }
}
```

失败响应：

```json
{
  "code": 1,
  "message": "ids is empty"
}
```

注意事项：

- `ids` 会被转换为整数，无法转换或为 0 的值会被过滤。
- 当前返回的 `deleted` 是请求中有效 ID 的数量，不是数据库实际删除的行数。

## 9. 健康检查

### `GET /health`

无需鉴权。

成功响应：

```json
{
  "code": 0,
  "message": "ok"
}
```

## 10. 错误处理约定

当前实现中的常见错误响应：

| 场景 | HTTP 状态码 | 响应 |
| --- | --- | --- |
| 登录用户不存在 | `200` | `{ "code": 1, "message": "user not found" }` |
| 登录密码错误 | `200` | `{ "code": 1, "message": "wrong password" }` |
| 调用需鉴权接口时未携带 token | `401` | `{ "code": 401, "message": "no token" }` |
| 调用需鉴权接口时 token 无效或过期 | `401` | `{ "code": 401, "message": "invalid token" }` |
| 消息不存在 | `404` | `{ "code": 1, "message": "not found" }` |
| `ids` 为空 | `200` | `{ "code": 1, "message": "ids is empty" }` |
| 服务端异常 | `500` | `{ "code": 500, "message": "<错误信息>" }` |

客户端建议同时判断 HTTP 状态码和响应体中的 `code` 字段。

## 11. 客户端对接建议

- 消息上传和消息查询接口当前无需登录，可直接调用。
- 登录成功后保存 `data.token`，仅在调用标记已读、删除消息等管理接口时放入 `Authorization` 请求头。
- 调用管理接口时如收到 `401`、`no token` 或 `invalid token`，清理本地 token 并引导用户重新登录。
- 上传消息时尽量提供稳定的 `recordKey`，便于客户端侧追踪数据。
- 查询列表时建议固定传入 `page` 和 `pageSize`，避免依赖默认值。
- `contentJson` 是原始消息对象，客户端展示正文时可优先读取 `contentJson.content`，其次读取 `contentJson.message`。
