# Scrape.do API 研究笔记

## API 基本用法

**请求格式：**
```
https://api.scrape.do/?token=YOUR_TOKEN&url=ENCODED_TARGET_URL
```

## 关键参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| token* | string | - | API认证令牌 |
| url* | string | - | 目标网页URL（需URL编码）|
| super | bool | false | 使用住宅/移动代理网络 |
| geoCode | string | - | 指定国家代码 |
| render | bool | false | 使用无头浏览器渲染JS |
| customWait | int | 0 | 页面加载后等待时间(ms) |
| waitSelector | string | - | 等待特定CSS选择器出现 |
| timeout | int | 60000 | 请求超时时间(ms) |
| output | string | raw | 输出格式(raw/markdown) |

## 特点
1. 自动处理反爬虫、WAF、CAPTCHA
2. 110M+ 代理IP池，150个国家
3. 支持无头浏览器渲染
4. 智能重试机制
5. 只对成功请求(2xx)收费

## 提供的 API Token
```
c89c43afa84d40898eb979ae07c7cfac2bf0ecfb651
```
