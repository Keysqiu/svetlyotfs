# TFS 扩展

**Visual Studio Code 扩展**，旨在简化与 **Team Foundation Server (TFS)** 的集成。在编辑器内即可管理挂起更改、撤销编辑、比较文件以及切换活动工作区。

---

## 🎬 预览

- **挂起更改视图**

![应用截图](https://i.postimg.cc/hvLhjVP2/image.png)

- **切换工作区**

![应用截图](https://i.postimg.cc/KvbRWpJw/image.png)

点击状态栏左侧的「工作区」按钮后，会弹出快速选择面板。

![应用截图](https://i.postimg.cc/L8C5n92F/image.png)

---

## 使用方法

1. **打开挂起更改视图**  
   打开 *挂起更改* 视图，查看所有未提交的更改。

2. **右键操作**  
   右键点击文件或文件夹，可执行撤销更改、与最新版本比较等操作。

3. **设置活动工作区**  
   使用屏幕底部的状态栏，为项目设置活动工作区。

4. **配置 tf.exe 路径**  
   在 **文件** → **首选项** → **设置** 中设置 `tf.exe` 路径。  
   要查找路径，打开 Visual Studio 开发者命令提示符，运行以下命令：  
   ```bash
   where tf.exe
   ```

![应用截图](https://i.postimg.cc/43cGss35/image.png)

![应用截图](https://i.postimg.cc/wM2HZ2BY/image.png)

---

## 🚀 功能特性

- **添加** *文件*：直接在源代码管理中生效。
- **重命名** *文件*：直接在源代码管理中生效。
- **删除** *文件*：直接在源代码管理中生效。
- **移动** *文件* 到其他目录：直接在源代码管理中生效。
- **移动** *目录*：直接在源代码管理中生效。
- **挂起更改视图**：  
  跟踪和管理工作区中所有挂起的更改。
- **快速文件操作**：  
  右键点击文件或文件夹，可以：
  - 撤销挂起的更改。
  - 与 TFS 最新版本比较文件。
- **状态栏集成**：  
  直接从状态栏快速设置或切换活动工作区。

---

## 🛠️ 快速开始

1. **查看挂起更改**  
   打开挂起更改视图，监控和管理项目中的修改。

2. **文件和文件夹操作**  
   右键点击文件或文件夹，可以：
   - 撤销更改。
   - 与 TFS 最新版本比较文件。

3. **工作区管理**  
   直接从 **Visual Studio Code** 状态栏管理活动工作区。

---

## 💡 反馈与贡献

您的反馈对改进此扩展至关重要！

- **报告问题或建议功能**：  
  在 GitHub 上[提交 Issue](https://github.com/Keysqiu/svetlyotfs/issues)。
- **参与开发**：  
  Fork 本仓库并提交 Pull Request，帮助增强此扩展。

---

## 📂 源代码

源代码托管在 [GitHub](https://github.com/Keysqiu/svetlyotfs)。  
欢迎探索、贡献，共同完善此扩展。

---

## 📜 许可证

本项目基于 [MIT 许可证](https://github.com/Keysqiu/svetlyotfs/blob/main/LICENCE) 授权。  
自由使用、修改和分享。

---

## ⭐ 支持

如果此扩展改善了您的工作流程，欢迎在[此处](https://marketplace.visualstudio.com/items?itemName=keysqiu.tfs-for-vscode-chinese)留下评价。
