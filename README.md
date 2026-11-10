# CRM · MELIASTAGE 客户管理工作台

用于管理皮革业务中的客户、询盘、沟通和销售跟进。包含可展开侧栏、跨店客户搜索、任务提醒、寄样、报价与订单、销售报表、中英文话术，以及国际站和腾讯企业邮箱档案入口。

仓库提供应用源码、依赖锁文件、D1 数据库迁移和部署配置模板。新部署从空的客户和沟通数据库开始。源版本为 MELIASTAGE CRM 的 `c3e1b69`。

## 本地运行

需要 Node.js 22.13 或更新版本。前端使用 React / Vinext，后端由 Cloudflare Worker 和 D1 提供。

```sh
npm ci
npm run build
for migration in drizzle/[0-9]*.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js \
    d1 execute DB --local --config dist/server/wrangler.json \
    --persist-to .wrangler/state --file "$migration" || exit 1
done
npm run dev
```

上述迁移命令用于初始化一份全新的本地数据库。后续升级仅应用新增迁移。开发服务使用本地测试登录，生产站点通过 Sites 的登录和访问控制管理权限。

## 部署与接入

- `lib/crm-config.json` 提供站点地址、邮箱、店铺账号和负责人配置模板。部署前在私有工作副本填写实际值。
- `.openai/hosting.json` 声明 D1 的 `DB` 绑定。发布时为目标私有站点配置自己的项目标识与访问权限。
- 阿里国际站应用凭证通过 CRM 的「平台对接」配置。服务端加密密钥通过部署环境的 secret 提供。见 [阿里国际站对接](ALIBABA_INTEGRATION.md)。
- 腾讯企业邮箱可通过 `python3 scripts/test-tencent-mail.py --archive /path/outside-the-repo/mail-export.json` 生成归档包。在 CRM 的「企业邮箱往来」中预览并导入。请在私有工作副本中配置与导入包一致的邮箱。
- 客户 CSV 可在「客户导入与备份」导入。若维护历史对话快照，在私有部署副本中按 `lib/data/initial.ts` 的类型提供会话和消息。

公开仓库只保存占位配置和空白快照。真实客户、邮件、会话、数据库及授权资料由原私有站点或本地档案保管。

## 验证

启动一份干净的本地数据库后，运行 `node scripts/verify-crm.mjs` 检查登录限制、客户保存、任务、寄样、报价和归档。该脚本只用于本地测试，会写入并归档测试记录。
