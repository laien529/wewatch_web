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
  "message": "analysis queued",
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
- `POST /api/messages/read-all`
- `DELETE /api/messages`
- `DELETE /api/messages/clear`
- `GET /api/filter-groups`
- `POST /api/filter-groups`
- `PUT /api/filter-groups/:id`
- `DELETE /api/filter-groups/:id`
- `POST /api/filter-groups/:id/conditions`
- `PUT /api/filter-conditions/:id`
- `DELETE /api/filter-conditions/:id`
- `POST /api/filter-groups/reindex`
- `GET /api/upload-tasks/:taskId`

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
    "batchCount": 2,
    "unmatchedCount": null,
    "analysisBatches": 0,
    "status": "analyzing"
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `taskId` | string | 服务端生成的批次 ID |
| `batchCount` | number | 本次去重后实际入库的数量；不因未命中分组而丢弃 |
| `unmatchedCount` | number/null | 分析完成前为 `null`；完成后为未命中任何当前启用分组的数量 |
| `analysisBatches` | number | 已完成的 LLM 分析批次数；初始为 `0` |
| `status` | string | 初始为 `analyzing`，可用 `GET /api/upload-tasks/:taskId` 查询后续状态 |

注意事项：

- 当前实现只会去重同一个请求批次内重复的 `recordKey`。
- `recordKey` 为空时不会参与批次内去重。
- 数据库中 `task_id + record_key` 有唯一索引，但由于每次上传都会生成新的 `taskId`，不同批次的相同 `recordKey` 仍可写入。
- 客户端只需采集、上传原始消息；服务端先完成入库并返回，再由单进程后台队列异步执行本地解析、LLM 报酬分析与分组匹配。
- 所有采集消息都会写入 `upload_records`；未命中任何分组的消息同样保留，并仅计入响应中的 `unmatchedCount`。
- 应用重启时会自动继续处理状态仍为 `analyzing` 的上传任务。

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
| `quickHours` | number | 否 | - | 快捷时间筛选，支持 `12`、`24`、`72` |
| `unreadOnly` | string/number | 否 | - | 仅查询未读，支持 `1`、`true`、`yes` |
| `q` | string | 否 | - | 对发送人和消息体做模糊查询 |
| `keyword` | string/string[] | 否 | - | 关键词筛选，支持多选：`direct`、`miniapp`、`link` |
| `sender` | string | 否 | - | 兼容旧参数，等价于 `q` |
| `groupId` | number | 否 | - | 仅返回命中指定服务端过滤分组的消息 |
| `conditionType` | string | 否 | - | 仅返回命中指定条件类型的消息：`contains`、`not_contains`、`regex`、`has_url` |
| `compensationMin` | number | 否 | - | 报酬区间筛选下限（元）；可单独传入，表示“不低于此金额” |
| `compensationMax` | number | 否 | - | 报酬区间筛选上限（元）；可单独传入，表示“不高于此金额” |

所有筛选条件均先作用于全量 `upload_records`，再计算总数并分页返回；`page` 与 `pageSize` 只决定当前返回的展示行，不会限制金额、关键词或分组的匹配范围。

时间参数建议格式：

```text
YYYY-MM-DD HH:mm:ss
```

如果客户端使用纯日期筛选，建议转换为：

- `startTime = YYYY-MM-DD 00:00:00`
- `endTime = YYYY-MM-DD 23:59:59`

请求示例：

```http
GET /api/messages?page=1&pageSize=20&q=张三&quickHours=24&unreadOnly=1&keyword=direct&keyword=link
```

按服务端过滤分组和条件类型筛选示例：

```http
GET /api/messages?page=1&pageSize=20&groupId=3&conditionType=contains
```

报酬区间交集筛选示例（`8000–20000` 会命中 `2–5 万`、`8k–12k` 与 `不超过 2w`）：

```http
GET /api/messages?page=1&pageSize=20&compensationMin=8000&compensationMax=20000
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

关键词筛选说明：

| 值 | 说明 |
| --- | --- |
| `direct` | 匹配消息体中包含“直发”的记录 |
| `miniapp` | 匹配消息体中包含“小程序”的记录 |
| `link` | 匹配消息体中包含 `http://`、`https://` 或“链接”的记录 |

## 6. 服务端过滤分组

客户端只负责采集原始消息。服务端以“过滤分组 → 条件条目”的结构维护规则；消息入库后由后台队列异步计算匹配结果。所有消息和 LLM 解析结果都会入库；默认消息列表返回全部消息，只有传入 `groupId` 或 `conditionType` 时才筛出命中相应分组/条件的记录。分组的 `matchMode` 可以是任一条件命中（`any`）或全部条件命中（`all`）。

条件类型：

| `type` | `value` |
| --- | --- |
| `contains` | 必填，消息字段中包含的文字（不区分大小写） |
| `not_contains` | 必填，消息字段中不包含的文字（不区分大小写） |
| `regex` | 必填，合法的 JavaScript 正则表达式 |
| `has_url` | 必填，`true` 或 `false` |
| `compensation_range` | `minAmount`、`maxAmount`（元），至少填写一项；与已解析报酬区间有交集即命中 |

匹配文本由上传记录的 `sender`、`from`、`senderName`、`title`、`content`、`message`、`text`、`chat`、`body`、`description`、`desc`、`summary`、`text_extra` 与 `textExtra` 字段组成。

消息入库后，服务端在后台队列中使用本地规则与 DeepSeek OpenAI 兼容接口的 `deepseek-v4-flash` 批量提取报酬结构。每批最多 12 条、总文本不超过 1.6 万字符；批次进度和最终状态写入 `upload_tasks`。解析得到的 `minAmount`、`maxAmount`、单位、原文片段与置信度写入 `upload_record_compensations`，用于全量数值筛选，不依赖关键词枚举。

### `GET /api/filter-groups`

需要鉴权。返回过滤分组及其条件条目。

### `POST /api/filter-groups`

需要鉴权。创建分组：

```json
{ "name": "工作消息", "matchMode": "any", "enabled": true }
```

### `PUT /api/filter-groups/:id` / `DELETE /api/filter-groups/:id`

需要鉴权。更新时可传 `name`、`matchMode`、`enabled` 中任意字段；删除会一并删除该分组的条件条目。

### `POST /api/filter-groups/:id/conditions`

需要鉴权。添加条件：

```json
{ "type": "contains", "value": "需求文档", "enabled": true, "sortOrder": 0 }
```

报酬区间条件示例：

```json
{ "type": "compensation_range", "minAmount": 8000, "maxAmount": 20000, "enabled": true }
```

### `PUT /api/filter-conditions/:id` / `DELETE /api/filter-conditions/:id`

需要鉴权。更新或删除一个条件条目。

### `POST /api/filter-groups/reindex`

需要鉴权。按当前已启用的分组和条件，为全部历史消息重建匹配索引。新增、修改或启停分组后调用一次；新上传消息会自动匹配，无需调用。

```json
{ "code": 0, "message": "ok", "data": { "indexed": 100, "matchesWritten": 42 } }
```

### `GET /api/upload-tasks/:taskId`

需要鉴权。读取批量上传任务的当前状态。`status` 为 `analyzing`、`completed` 或 `failed`；响应包含已完成的 LLM 批次数、实际入库数、未命中分组数与失败原因（如有）。

## 7. 查询消息详情

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

## 8. 标记消息为已读

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

## 9. 一键标记全部已读

### `POST /api/messages/read-all`

需要鉴权。用于将全部未读消息标记为已读。

请求参数：无。

请求示例：

```http
POST /api/messages/read-all
Authorization: Bearer <token>
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "updated": 10
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `updated` | number | 本次实际更新为已读的消息数量 |

## 10. 删除消息

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

## 11. 清空全部消息

### `DELETE /api/messages/clear`

需要鉴权。用于删除全部消息。

请求参数：无。

请求示例：

```http
DELETE /api/messages/clear
Authorization: Bearer <token>
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "deleted": 100
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `deleted` | number | 本次实际删除的消息数量 |

注意事项：

- 该接口会清空全部消息，不受当前查询条件影响。
- 该操作不可恢复，客户端调用前必须二次确认。

## 12. 健康检查

### `GET /health`

无需鉴权。

成功响应：

```json
{
  "code": 0,
  "message": "ok"
}
```

## 13. 错误处理约定

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

## 14. 客户端对接建议

- 消息上传和消息查询接口当前无需登录，可直接调用。
- 登录成功后保存 `data.token`，仅在调用标记已读、删除消息等管理接口时放入 `Authorization` 请求头。
- 调用管理接口时如收到 `401`、`no token` 或 `invalid token`，清理本地 token 并引导用户重新登录。
- 一键已读和清空全部属于全局操作，客户端调用前建议弹窗二次确认。
- 上传消息时尽量提供稳定的 `recordKey`，便于客户端侧追踪数据。
- 不要由客户端打过滤标签；服务端会在上传时按分组和条件自动完成匹配。
- 查询列表时建议固定传入 `page` 和 `pageSize`，避免依赖默认值。
- `contentJson` 是原始消息对象，客户端展示正文时可优先读取 `contentJson.content`，其次读取 `contentJson.message`。
