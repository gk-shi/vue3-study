### 总结说明



该文件主要提供的是将对象转为`reactive`的方法，分为：

- `reactive`
- `shallowReactive`
- `readonly`
- `shallowReadonly`



`shallow-`前缀的函数都只是约束了根路径下的属性，如：

```typescript
// 1.shallowReactive 嵌套内容修改不会触发更新
const q = reactive({
  a: 1
  b: {
    c: 3
  }
})

const w = shallowReactive({
  a: 1
  b: {
    c: 3
  }
})
effect(() => {
  console.log('q.b.c  == ', q.b.c)
})

effect(() => {
  console.log('w.b.c  == ', w.b.c)
})

console.log('qc before === ', q.b.c)
q.b.c = 123

console.log('wc before === ', w.b.c)
w.b.c = 123
```

在最后修改`q.b.c`的时候，会触发`effect`的函数打印，而`w.b.c`的修改便不会触发。





4 个函数最后都是调用`createReactiveObject`，因此主要不同的是传入的表示`isReadonly`的参数以及 让raw -> proxy 的映射关系表、处理 handlers 不同。



但`reactive`函数稍微有点特殊，如果传入的`Target`已经是一个`readonly`对象的话，会直接返回该对象。

```typescript
const readonlyObj = readonly({
  a: 3
})

const rObj = reactive(readonlyObj)

console.log(readonlyObj === rObj)
```



该文件主要的函数即是`createReactiveObject`：

```typescript
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>
) {
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target is already a Proxy, return it.
  // exception: calling readonly() on a reactive object
  if (
    // 如果目标对象有原始对象存在，表示该对象已经是 reactive 
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target
  }
  // target already has corresponding Proxy
  const existingProxy = proxyMap.get(target)
  if (existingProxy) {
    return existingProxy
  }
  // only a whitelist of value types can be observed.
  const targetType = getTargetType(target)
  if (targetType === TargetType.INVALID) {
    return target
  }
  const proxy = new Proxy(
    target,
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers
  )
  // 设置原始对象和代理对象的映射关系
  proxyMap.set(target, proxy)
  return proxy
}
```

分析流程可得：

- 如果`Target`已经是一个代理对象，并且它不是一个`reactive`准备生成`readonly`的话，直接返回`Target`。

  - ```typescript
    // case 1
    const original = {
      a: 1
    }
    
    const r1 = reactive(original)
    
    const r2 = reactive(r1)
    
    console.log('r1 === r2 ? ', r1 === r2)
    
    
    // case 2
    const obj = {
      a: 1
    }
    
    const readO = readonly(obj)
    
    const rO = reactive(readO)
    
    console.log('rO === readO : ', readO === rO)
    ```

- 如果`Target`已经存在于该代理方式的 Map 中，再次代理的话会返回已经存在的代理对象

- 如果不是可代理对象(object/Array/(Weak)Map/(Weak)Set)，则直接返回`Target`
  - `reeactive`只能针对对象
  - 像`number`、`string`等需要`ref`来模拟
  
- 生成代理对象，保存 raw -> proxy 映射关系





