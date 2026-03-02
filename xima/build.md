### 后续打包流程总结

完整打包（含 Python 后端重新打包）：

```shell
# 先切换环境
pyenv shell 3.11.10
nvm use 20

# 核心包（推荐，约 180MB .dmg）
bash build/build_core.sh

# 完整包（约 1GB .dmg，含所有可选依赖）
bash build/build_full.sh
```

只重新打 Tauri 前端（Python 后端不变，速度快）：

```shell
nvm use 20
cd apps/setup-center
unset CI && npx tauri build
```

```shell
nvm use 20
cd apps/setup-center
unset CI && npx tauri build
``

输出路径：

```

apps/setup-center/src-tauri/target/release/bundle/dmg/
└── OpenAkita Desktop_x.x.x_aarch64.dmg ← 安装包

```

问题根因一句话：Cursor 终端会注入 CI=1 环境变量，导致 tauri CLI 报错退出，加 unset CI 即可解决
```
