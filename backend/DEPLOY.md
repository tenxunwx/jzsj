## 部署说明（后端镜像）

仓库：`https://github.com/tenxunwx/jzsj`
镜像：`ghcr.io/tenxunwx/jzsj`

### GitHub Actions 自动构建

工作流位于：`/.github/workflows/docker-ghcr.yml`

触发：push `main` / 手动触发。

> 说明：当前镜像采用 `node dist/index.js` 运行（不再用 pkg 二进制），
> 以兼容 `better-sqlite3` 原生模块。

### 服务器两行命令部署

```bash
docker pull ghcr.io/tenxunwx/jzsj:latest
docker run -d --name jzsj --restart unless-stopped -p 3000:3000 --env-file /opt/jzsj/.env -v jzsj_data:/app/data ghcr.io/tenxunwx/jzsj:latest
```

如容器已存在，先执行：

```bash
docker rm -f jzsj
```

### 启动失败排查

如果日志出现 `Could not locate the bindings file`（`better_sqlite3.node`），
说明你拉到的是旧镜像。请重新拉取并重建容器：

```bash
docker pull ghcr.io/tenxunwx/jzsj:latest
docker rm -f jzsj
docker run -d --name jzsj --restart unless-stopped -p 3000:3000 --env-file /opt/jzsj/.env -v jzsj_data:/app/data ghcr.io/tenxunwx/jzsj:latest
```

