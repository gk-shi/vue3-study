### 说明

> 本文件是依赖收集及更新触发的核心所在。





#### 需要搞明白的几个点

- targetMap 具体是个什么构造，作用是？
- `interface ReactiveEffect`中的`deps`属性是干嘛的？
- effect 的创建过程？
- `uid`这个看似突兀的变量的作用？
- 触发更新的流程？





文件整体的分析在思维导图以及代码中注释有比较完整的介绍，这里只对以上几个点做相关说明。



##### targetMap 具体是个什么构造，作用是？

构造如下：

```typescript
Map1(target, Map2(key in target, Set(effect)))
```

3层数据结构的嵌套。

Map1: 维护对象和依赖它属性的集合的关系。

Map2: 每个属性以及该属性对应依赖集合的关系。

Set: 某一属性的依赖集合。





##### `interface ReactiveEffect`中的`deps`属性是干嘛的？

`Array<Dep>`的结构，监听函数本身还维护着一个依赖集合的数组，当然这里的每个 Dep 的 Set 集合中都包含 effect 本身。



它的作用有两个：

1. 主动调用`effect`的`stop`，会清空依赖中的`effect`函数
2. `effect`触发时根据该数组清除对应`effect`，然后重新收集

第一点好理解，第二点重新收集的原因下面会在创建`effect`时介绍。



##### effect 的创建过程？

整个创建过程主要部分非在`createReactiveEffect()`函数中，这也是本文件比较难理解的一个部分，下面会贴出代码，根据注释能够对很多个小细节有所了解，包括：

- 主动 stop
- 判断监听栈是否包含当前函数的原因
- 清除依赖重新收集的原因
- 执行完弹出当前 effect 获取上一个 effect 的原因



```typescript
export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  if (isEffect(fn)) {
    fn = fn.raw
  }
  const effect = createReactiveEffect(fn, options)
  if (!options.lazy) {
    effect()
  }
  return effect
}


function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  const effect = function reactiveEffect(): unknown {
    if (!effect.active) {
      // 调用 stop 失活后，能够主动触发原函数
      return options.scheduler ? undefined : fn()
    }
    // 这个 if 逻辑可以避免监听函数里面有更改当前数据源引起的循环触发更新

    // 其实在 trigger 中 add 函数已有判断，如果第二次触发的和当前的监听函数
    // 是同一个，会直接返回
    if (!effectStack.includes(effect)) {
      // 注释该行运行 effect.spec.ts 单测可知：
      // 每次重新收集监听函数的依赖，是为了防止带有分支的监听函数被错误触发,
      // 见 effect.spec.ts ：
      // should not be triggered by mutating a property, which is used in an inactive branch
      cleanup(effect)
      try {
        // 因为要重新收集依赖，所以要确保当前是可以进行依赖收集的
        enableTracking()
        // 配合当前这个 if 逻辑的判断，避免可能的循环触发
        effectStack.push(effect)
        // 设置当前监听函数
        activeEffect = effect
        // 调用 fn 的时候，会触发 track 操作，这时候会应用到 activeEffect
        return fn()
      } finally {
        // 执行完之后将 effect 弹出
        effectStack.pop()
        // 恢复之前的收集状态
        resetTracking()
        // 取栈中上一个监听函数
        activeEffect = effectStack[effectStack.length - 1]
        /* 为了应对该种情况
          const r = reactive({
            a: 1,
            b: 2
          })
          effect(() => console.log('b == ', r.b))
          effect(() => {
            console.log('a == ', r.a)
            r.b = 5
          })
        */
      }
    }
  } as ReactiveEffect
  effect.id = uid++
  // 这个允许递归调用自己的变量没有搞懂
  effect.allowRecurse = !!options.allowRecurse
  effect._isEffect = true
  effect.active = true
  effect.raw = fn
  effect.deps = []
  effect.options = options
  return effect
}

```

*注：这个`allowRecurse`变量没有主动触发成功过，所以不知道它的具体意义*



##### `uid`这个看似突兀的变量的作用？

这个 uid 属性很重要：

1. 创建时给定，父组件中的 uid 小于 子组件，任务 flush 时用 uid 排序

2. 避免当子组件任务先排入任务队列，但父组件已经销毁子组件任务中要到的属性(参考： https://github.com/vuejs/vue-next/issues/910)

3. 当父组件更新期间子组件销毁，可以跳过子组件更新的过程



关注到这个变量是因为觉得它有确定唯一性，但应该不局限与此，根据查看代码的 git history ，查找到关于它的一些说明。





##### 触发更新的流程？

`trigger`函数会根据依赖关系将需要更新的依赖加入一个 Set 队列，这样能够去重以及批量刷新。

添加队列的时候，会通过`effect !== activeEffect`来防止非主动添加同一个监听函数到队列，之所以说是非主动，是因为它会放行`allowRecurse`为`true`的监听函数。



触发过程的难点是在一些特殊情况的处理上：

- 当触发了`TriggerOpTypes.CLEAR`类型的更新，则所有变动涉及到的监听函数都要触发
- 如果直接修改数组`length`属性，那么除了触发监听`length`属性的依赖之外，还要触发比当前`length`值约束多余出来的原有数组元素的依赖更新
  - 原`length = 5`，现直接修改`length = 3`，那么以前下标是`3和4`的元素如果有依赖，也要进行触发更新，新值为`undefined`
- 一些迭代器属性的依赖是收集在 INTERATE_KEY / MAP_KEY_ITERATE_KEY 上的，但它们获取的内容间接的受其他属性的影响，所以其他属性有变化，可能需要更新它们。这一版是一些通过迭代器进行访问的方法。
- 数组类似`join`的方法，它的依赖收集会依赖在属性`join`和`length`上(为什么会依赖上`length`是数组的底层设计问题)，但如`push`这些禁止对`length`收集依赖的方法(在`baseHandlers.ts`中有列举)，并不会触发`length`的依赖，所以需要这里主动触发`length`相关依赖的更新(join)。
  - `join`这种会依赖`length`属性，同时，由于它在`get`操作时还会循环遍历数组，因此它也会同时存在于数组下标`0,1,2,3...`等属性的依赖集合中(Dep = Set())。



关于第3点，因为没有实际操作出来，所以还不是很理解。

更加详细的资料在思维导图和代码注释中有所体现。