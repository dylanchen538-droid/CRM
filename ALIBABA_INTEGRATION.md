# 阿里国际站对接

从侧栏「基础信息 → 平台对接」进入。

1. 在私有部署中配置站点地址、店铺账号和服务端 secret `ALIBABA_VAULT_KEY`。加密密钥应为独立生成的 32 字节随机值，以 64 位十六进制字符串保存。
2. 在阿里应用控制台填写 CRM 显示的完整回调地址，路径为 `/api/integrations/alibaba/oauth/callback`。
3. 分别为各店铺填写 App Key 和 App Secret，核对账号后保存。在 `lib/crm-config.json` 的 `alibabaAppOwners` 可为只能授权某一店铺的 App Key 限定 `meliya` 或 `meixin`。
4. 先检测网关，再用对应店铺账号发起授权。返回 CRM 后核对平台账号标识并确认绑定。
5. 客户读取通过 `alibaba.seller.customer.batch.get` 完成。先预览，再确认导入。实际可读取字段由应用权限和阿里平台返回决定。

凭证及授权令牌在服务端加密保存。更换已有部署的加密密钥会影响既有密文读取。配置和操作通过私有站点登录访问。客户端展示网关诊断和绑定状态。

- [授权流程](https://open.alibaba.com/doc/doc.htm#/?docId=72)
- [HTTP 请求示例](https://open.alibaba.com/doc/doc.htm#/?docId=134)
- [签名规则](https://open.alibaba.com/doc/doc.htm#/?docId=135)
