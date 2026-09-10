# 彩虹巴士（rainbow-bus.cn）班次/座位接口调查

> 2026-09-10 实测。目标：为 bitbus 的「彩虹班次余票」未来集成探明数据源。
> 站点：`http://www.rainbow-bus.cn`（仅 http，Express + nginx，微信 H5）。

## 1. 认证

- 全站依赖 **session Cookie**：`connect.sid=<urlencoded 值>`（Path=/，域名 www.rainbow-bus.cn）。
- 无该 Cookie 访问业务页会跳微信 OAuth（`/cht` 路径）；**带有效 Cookie 直连业务页/API 即可**，无需走 OAuth。
- 请求建议带移动端 UA（MicroMessenger）；API 为 jQuery `$.post`（`X-Requested-With: XMLHttpRequest`，form-urlencoded）。
- ⚠️ `connect.sid` 为会话凭据，有效期未知，勿入库勿提交。

## 2. 接口链路（四层）

```
POST /rainbow/wechat/r/routesByArea      班次（线路）列表 —— 按 area
POST /rainbow/wechat/p/searchPlanDates   某线路的「日期→planId」列表
POST /rainbow/wechat/b/getBusSeatsWechat 某班次(plan)的座位图（含已占）
  （选座/下单层：p/getRedisSeats、p/calculateMoney、b/getBusStatus{planId} 实时位置）
```

### 2.1 routesByArea —— 线路列表
`POST /rainbow/wechat/r/routesByArea`，form：
`olng=116.407526&olat=39.904030&dlng=&dlat=&destinationStations=&start=&end=&stationName=&soonerOrLater=&area=3804&nearest=&page=0&city=1`

返回数组（每项）：
`id`(routesId)、`name`（如「理工01良乡-中关村（首班）」）、`service_date`、`service_time`、`price/presentPrice`、
`first_stationId/firstStationName/first_station_time`、`last_stationId/lastStationName/last_station_time`、`distance`。
- `area=3804` = 良乡区；`city=1` 北京。`soonerOrLater` 空=最近可买（实测返回 service_date=次日）。

实测（2026-09-10）：area=3804 返回 8 条（理工01/02…良乡⇄中关村，¥9）。

### 2.2 searchPlanDates —— plan（日期班次）列表
`POST /rainbow/wechat/p/searchPlanDates`，form `routeId=<routesId>`（**必须传具体 id**；传空返回整月日历骨架，全部 `id:""`）。

返回数组（每日期一项，`id` 非空者=可购班次）：
`id`(planId)、`service_date`、`service_d`、`wday`、`price/presentPrice`、`service_time`(小时)、`isEnable`、`moreTicket`（"有"/"无"——文字余票）。

实测 routeId=788：21 项中 13 个有 planId（09-11 起的工作日，每日一班 07:30）。

### 2.3 getBusSeatsWechat —— 座位图（余座判定的核心）
`POST /rainbow/wechat/b/getBusSeatsWechat`，form `planId=<planId>`。

返回 `{ success, rows, seats }`：
- `rows[]`：`{row_index, col_index, seatNum, is_passageway, type}`。
  - `type`：0=可选座；2=指挥座；3=不可选（实测 4 格）；`is_passageway=1` 为过道（seatNum=0）。
  - 788 车型：49 个物理座位 + 4 格不可选 + 过道。
- `seats[]`：**已占座位**的 redis 键 `os:<planId>:r:<row>:c:<col>:seat`（行=row[3]，列=row[5]）。
  - **余座 = type-0 座位数 − seats 去重数**。

实测：
| plan | 日期 | 座位 | 已占 | 余座 | moreTicket 对照 |
|---|---|---|---|---|---|
| 417302 | 2026-09-11（周五 07:30 首班） | 49 | 49 | **0** | 「无」✓ |
| 417303 | 2026-09-14（周一） | 49 | 32 | **17** | 「有」✓ |

### 2.4 其他端点（详情页/下单层，未深挖）
- `POST /rainbow/wechat/r/routesShuttleCoachs {routesId}`：站点序列（stations_type 0=上行 1=下行、stationsName、final_vehicle_hour、lng/lat、trip_distance、routeDescribe）。
- `POST /rainbow/wechat/r/getBusStatus {planId}`：班车实时状态（type 0=未开始发座…）。
- `POST /rainbow/wechat/p/getRedisSeats`：当前会话已选座。

## 3. 与 bitbus 集成的注意点

1. **鉴权**：所有请求都要带有效 `connect.sid`；session 过期即失效（需人工/半自动续期），不适合放 Pages Function 里无人值守高频调用。
2. **余票口径**：`getBusSeatsWechat` 一次返回整班座位图，余座可精确到个位（比文字 moreTicket 更强）；容量 49 座（与班车 51/48 座不同源）。
3. **班次映射**：彩虹班次在 bitbus 静态表（a3/a5/a7…`rainbow:true`，07:30/08:10/…）≈ 这里 `name` 前缀「理工XX」的线路；需按 name/service_time 建映射表。
4. **频率礼貌**：源站无缓存层（每请求直查 redis），集成时应 ≥5 分钟 TTL + 复用现有 R2 缓存模式（`avail/rainbow/...`）。
5. **页面入口（调试用）**：
   - 列表页 `http://www.rainbow-bus.cn/rainbow/wechat/sba?op=olng:116.407526,olat:39.904030,...,area:3804,...,cityId:1`（URL 编码）
   - 详情 `/rainbow/wechat/sbc?routesId=<id>`；选座 `/rainbow/wechat/seats?routesId=&startId=&endId=`
