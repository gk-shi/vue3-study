## vue 3 源码学习



> 本项目以 vue 3.1.0-beta 作为基础版本，进行源码分析、学习，构建文件思维导图，完善知识图谱，并对每个文件的重点内容做 markdown 文档说明


### 文件分析进度

- `reactivity`模块
  - reavtive.ts
  - ref.ts
  - baseHandlers.ts
  - collectionHandlers.ts


### 源码调试方法

1. clone 本仓库

   ```shell
   git clone https://git.xq5.com/shihuang/vue3-study.git
   ```

   

2. 根目录安装依赖

   ```shell
   yarn
   
   # npm i
   ```

   

3. 运行调试模式

   ```shell
   yarn dev -s
   #npm run dev -s
   ```

   

4. 浏览器打开`packages/vue/index.html`

   - **推荐**使用 http 服务器打开该文件，这样源码一变动会自动刷新页面
   - vscode 推荐 Live Server 插件
   - 也可以使用 npm 安装全局 http-server 快速开启服务(https://github.com/http-party/http-server)

5. 可以编辑源码结合使用`console`、`network`、`source`面板调试





### 说明

- 源码文件会对一些重要或者不好理解的函数、变量添加注释说明
- 源码文件里一些注释代码是为了验证一些特性，注释打开就能运行
- 对应文件的文档总结会在`vue-md/`的对应文件里
- Xmind 图谱会跟着一步步完善
- 学习源码时不需要过分纠结 TS 类型的相关声明
  - 但有时候一些类型声明能够帮助我们学习对应的逻辑内容，比如`ref`函数的重载声明
  - 一些太复杂且高级的类型应用，不会的可以先搁置

