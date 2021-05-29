### 内容总结

> 本文件主要功能是生成一些供普通对象 proxy 代理使用的 get/set 等拦截器处理句柄。
>
> (不包括 map/set 的集合类型，它们由 collectionHandlers.ts 文件中导出的处理句柄实现)

#### 1. 依赖不 track 的属性

有些特殊属性不应该被 track 进行依赖收集，否则会造成一些边界问题。

- 内建的 Symbol 属性：`builtInSymbols`存储
- 特定不收集属性：`__proto__`、`__v_isRef`、`__isVue`，为 map 结构

```typescript
const builtInSym = Symbol.iterator
const sym = Symbol('other')

const test = {
  [builtInSym]: 234,
  [sym]: 123
}

const robj = reactive(test)
effect(() => console.log(robj[builtInSym])) // effect 1
effect(() => console.log(robj[sym])) // effect 2

robj[builtInSym] = 456  // 不会触发 effect 1
robj[sym] = 789  // 触发 effect 2

```

#### 2. 数组操作相关

数组对象的操作方式的代理 Vue 做了部分自己的处理。

`arrayInstrumentations`对象存储了对应<string, Function>的对应关系(Function 为原始方法扩展后的函数)：

##### 2.1 includes, indexOf, lastIndexOf

- 这些方法都会使得数组对象被依赖收集捕获

- 兼容了一个特殊情况

  - ```typescript
    /*
    当响应式数组添加了非响应式对象,判断响应式数组是否包含其对应的响应式对象应该是 true
    */
    const obj = {}
    const robj = reactive(obj)
    
    const rArr = reactive([])
    rArr.push(obj)
    
    rArr.includes(robj) // ==> true
    ```

##### 2.2 push, pop, shift, unshift, splice

这些方法的深层原理会影响数组`length`属性的改变，所以在执行这些方法前会先关闭依赖收集，执行完后再打开。

```typescript
;(['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
  const method = Array.prototype[key] as any
  arrayInstrumentations[key] = function(this: unknown[], ...args: unknown[]) {
    // 上述方法会修改数组 length 的值，
    // 为了防止某些时刻循环触发更新，需要暂停收集
    // 执行完之后再开启依赖收集
    pauseTracking()
    const res = method.apply(this, args)
    resetTracking()
    return res
  }
})
```

如果没有该操作会造成的问题：

```typescript
const arr = reactive<Array<number>>([]);
      watchEffect(() => {
        console.log(1);
        arr.push(1);
      });
      watchEffect(() => {
        console.log(2);
        arr.push(2);
      });

```

如果没有上述对依赖收集的关闭操作，则该两个副作用函数会被循环调用。可以在[这里](https://codesandbox.io/s/sleepy-cartwright-cjlk4?file=/src/index.ts)将上述代码复制进去，将 Vue 的版本调低一点，看到控制台输出的效果。

#### 3. createGetter 函数

该函数作为一个高阶函数，是为了生成不同的 get 拦截器的，有以下几点需要注意：

- 如果对象是数组且是 Vue 改写的同名方法，则反射到改写后的方法调用

- 只读对象不进行依赖收集

  - `readonly`接口设计的初衷是将`reactive`的对象包装成已读，所以依赖收集的操作会在原`reactive`对象上被提现
  - 可以简单认为最初是的 raw 对象(内容为 { a: 1 })，经过raw -> `reactive` -> `readonly`两层代理，对`readonly`上的属性 get 会在 `reactive`的过程上被收集

- 如果是获取数组中的 ref 对象

  - 默认是不会对该 ref 对象进行 unwrap （非数组对象属性是 ref 的话会被解套，即不需要 .value 操作符）

  - 如果是非法的数组下标(如浮点数下标)，则会进行解套

    - ```typescript
      // case 1 仅对数组的合法整型 key 不做 unwrap
      const arr = [ref(0)]
      arr[1.4] = ref(1)
      
      const ra = reactive(arr)
      console.log('ra[0] == ', ra[0])  // Ref<number> 类型
      console.log('ra[1.4] == ', ra[1.4]) // 1
      ```

  - 嵌套的对象会延迟代理(当访问到的时候再代理)

    - ```typescript
      const target = {
        a: {
          b: target
        },
        c: 1
      }
      
      const reactiveT = reactive(target) // 此时仅代理 target ，拦截外层 a，c 属性
      
      reactiveT.a.b // 此时会拦截到 a.b 的操作 
      
      ```

    - 这样做的另外一个好处就如上述代码，可以避免递归循环依赖的代理





#### 4. createSetter 函数

高阶函数，生成不同类型的 set 拦截器，需要注意的点：

- 非浅层响应对象的 ref 属性修改，如果新值是非 ref 的，则应修改原 ref 的 value 值

- 浅层响应对象的修改和非浅层对象其他修改一样

- 对原型链上的修改不触发更新

- 触发更新上有区分 ADD 和 SET 类型，前者是添加不存在的属性，后者是修改

  - ```typescript
    const robj = reactive({ a: 1 })
    effect(() => console.log('robj ===-- ', robj.c))
    robj.c = 123
    
    const rArr = reactive([1])
    effect(() => console.log('rArr[1] === ', rArr[1]))
    rArr[1] = 123
    ```

#### 5. 其他

剩下的函数包括一些 `deleteProperty`、`has`等关键词的拦截操作，有两个需注意的地方：

- `has()`：该方法主要是拦截非数组对象的`in`操作符，`foo in proxy`，会过滤掉 Symbol 内建值

  - ```typescript
    const s = Symbol.iterator
    const o = Symbol('o')
    const t = reactive({
      [s]: 234,
      [o]: 123
    })
    
    effect(() => {  // effect 1
      if (s in t) {
        console.log('[s]', t[s])
      }
    })
    
    effect(() => {  // effect 2
      if (o in t) {
        console.log('[o]', t[o])
      }
    })
    
    t[s] = 567 // 不触发 effect 1
    t[o] = 78000 // 触发 effect 2
    ```

- `ownKeys()`：触发迭代 ITERATE 类型 tracker，如果是数组（拦截 for(idx in arr)）的话，key 为 length，否则为 symbol 类型

  - ```typescript
    const arr = reactive([])
    effect(() => {
      console.log('start === ')
      for(const idx in arr) {
        console.log('idx == ', idx)
      }
    })
    arr.push(1, 2, 3)
    ```







除此之外，剩下的就是组合各个函数成不同 proxy 代理对象的处理句柄(reactive/readonly...)导出供使用。