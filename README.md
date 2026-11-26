# 谱面工作室

在浏览器中创建、编辑和转换 Muse Dash 自制谱面。手机端可在编辑、属性、项目之间切换，使用触控绘制、平移和双指缩放。项目和资源保存在当前设备的浏览器中，可导出备份。

## 打开和保存

点顶部的「新建」可创建空白谱面，也可先选音频。选择后会读取标题、艺术家、时长、BPM 和支持的内嵌封面。缺少标题标签时使用文件名，缺少有效 BPM 标签时自动测算。手动编辑的字段会保留。

| 格式 | 打开 | 保存 |
| --- | --- | --- |
| CustomPlay | `score.mdcpmf`、谱面目录或 ZIP | `score.mdcpmf` 或含 `music.ogg` 和可选 `cover.png` 的 ZIP |
| Muse Dash BMS | `.bms`、目录或 ZIP | `.bms` 或含音频的 ZIP |
| CustomAlbums | `.mdm` 或含 `info.json` 的目录 | 多难度 `.mdm` |
| Euterpe | 含 `manifest.epk` 的目录或 ZIP，也可单独打开清单 | 含 `manifest.epk` 与 `map*.bms` 的 ZIP，或单独的清单 |
| 工作室备份 | `.chart.json` | 含编辑数据和资源的 `.chart.json` |

- **格式转换**可用于导出当前谱面，或先打开要转换的文件。转换到 BMS 系列格式时，界面会提示无法保留的对象和属性，例如曲线长条、多层级和 MDCP 专用特效。
- Euterpe 清单只包含元数据。编辑音符请同时打开 `map*.bms`。离线使用时，将完整 Euterpe 谱面 ZIP 解压为单个谱面目录，放在 `Muse Dash/Euterpe_Charts/Offline` 下。
- BMS 和包内谱面的音频使用 Ogg Vorbis。选择本地音频后，浏览器会在导出谱面包时按需转码。

## 编辑

- 移动播放头到小节标尺或波形上。选择音符类型后可点击绘制，拖动可绘制长按。选择模式支持框选、拖移、镜像、复制和批量编辑。
- 点波形轨左侧的「波形」或播放器的滑块图标，可分别调整播放音量和波形增益。
- 已有谱面可点顶部的 BPM 数值，选择「自动测算 BPM」，核对结果后应用。
- 曲线长条支持逐点绘制、续写、插入节点和曲线段修改。故事板支持时间重映射、场景和可见性切换，以及数值型特效关键帧。
- 格线、BPM 估测、节拍变化、层级、过滤、设计检查、试听区间、双轨预览、播放速度和可自定义快捷键位于项目工具中。

## 开发和发布

使用 Node.js 24 运行 `npm ci`、`npm test` 和 `npm run dev`。生产文件由 `npm run build` 生成在 `dist/`。

GitHub Pages 的发布源设为 **GitHub Actions**。`main` 的提交会运行测试、构建并部署到该仓库的 Pages 站点。

格式参考：[CustomPlay 2.1.1](https://github.com/Evilnanan/misc/releases/tag/Muse-Dash-CustomPlay-Editor-2.1.1) · [CustomAlbums](https://mdmods.github.io/CustomAlbums/) · [Euterpe 文档](https://euterpe-org.com/zh-CN/docs/ecosystem/from-mdmc)
