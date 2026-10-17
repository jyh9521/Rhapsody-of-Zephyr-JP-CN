# 技术归档笔记

本文件只记录可复用的格式和工程结论，不包含游戏文本、翻译内容或原始资源。

## 资源容器

- 游戏资源以 `ZEP_DAT0` 至 `ZEP_DAT6` 的 `HDR`/`LIB` 对组织。
- `HDR` 提供资源目录，`LIB` 保存相应资源数据。
- 工具链中的 `zep_archive.js` 负责目录解析；`zep_decode.js`、`zep_prov_decode.js` 负责已识别格式的编解码；`rebuild_zep_dat.js` 用于重建资源包。

## BF 文本变换

部分文本资源按字节使用以下可逆变换：

```text
stored_byte = (0xBF - plain_byte) & 0xFF
plain_byte  = (0xBF - stored_byte) & 0xFF
```

`extract_bf_text.py` 与 `apply_bf_text_translations.py` 实现了该格式的抽取和槽位内回写。回写时必须保持控制记号、字符串边界和原槽位容量。

## 字符编码与渲染

- 原版资源和引擎路径以 CP932/Shift-JIS 为基础。
- 中文本地化路径使用 GBK/CP936 文本，并通过 `ZPGDI_proxy.c` 将 ANSI 绘制请求转为 Unicode 绘制。
- 游戏内部用作标识符、动画状态或地图初始化键的字符串不能作为普通显示文本翻译；`apply_exe_cn_strings.py` 中维护了这类保护槽位。

## 存档兼容性

存档内同时存在进度状态和若干已渲染名称/职业缓存。名称缓存的编码可在 CP936 与 CP932 间转换，但场景恢复还受对应版本脚本语义影响。

因此，跨原版与本地化版本转换存档只能作为诊断用途，不能保证恢复到相同的室内/室外状态。`make_jp_compatible_save.py` 仅处理已知缓存与校验和，不应被理解为通用兼容层。

## 归档边界

本仓库不含输入资源、翻译表、已构建资源包或补丁二进制；它保留的是可复用的工程方法与源码。任何重新构建工作都必须在拥有合法原始游戏文件的私有环境中进行。
