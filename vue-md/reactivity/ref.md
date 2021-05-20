### 1. 作用

该文件主要作用是模拟一个对象，将传入的基本数据类型(number/string/...)转为响应式数据。

### 2. 重点内容说明

#### 2.1 interface Ref

首先在文件的头部位置有一个关于 Ref 类型的 TS `interface`的定义：

```typescript
declare const RefSymbol: unique symbol

export interface Ref<T = any> {
  value: T
  /**
   * Type differentiator only.
   * We need this to be in public d.ts but don't want it to show up in IDE
   * autocomplete, so we use a private Symbol instead.
   */
  [RefSymbol]: true
  /**
   * @internal
   */
  _shallow?: boolean
}
```

`value`和`_shallow?`很好理解，因为`ref`主要是模拟一个对象来转换基本类型，`value`就是用来存储原始值的，对于对象的属性`value`则可以做依赖收集以及触发更新的操作。



`_shallow?`则是判断是否为浅层响应式的标志，这个下面还会详说。



难点是在`[RefSymbol]: true`这个计算属性上，如果要直接写一个 Ref<T> 的变量，要如下：

```typescript
const testRef: Ref<number> = {
  value: 123,
  [RefSymbol]: true
}

```

这个`[RefSymbol]`要显示声明，否则会报类型错误，而在文件中创建 Ref 的函数`createRef -> new RefImpl`中并没有这个显示声明，但 `ref()`函数返回的却是`Ref<T>`类型，这个让人很奇怪。



后面通过实践发现，没有报错是因为函数重载的原因：

```typescript
export function ref<T extends object>(value: T): ToRef<T>
export function ref<T>(value: T): Ref<UnwrapRef<T>>
export function ref<T = any>(): Ref<T | undefined>
export function ref(value?: unknown) {
  return createRef(value)
}
```



如果把最后一个`export function ref(value?: unknown)`删了，则会出现报错。

这个`RefSymbol`变量的目的只是为了在 `d.ts`中做声明查看，不想让它暴露在 IDE 的自动提醒中。**但关于为什么使用这个动态属性还是存在疑问，后面有机会还需要仔细学习。**





#### 2.2 type ToRef

```typescript
export type ToRef<T> = [T] extends [Ref] ? T : Ref<UnwrapRef<T>>
```

`T extends Ref`这样的话挺好理解，但是`[T] extends [Ref]`的意义是什么呢？

具体原理看一看[typescript 文档](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types)和[vue 提交记录](https://github.com/vuejs/vue-next/pull/3048)。这里就能很清晰的指导原因了。

```typescript
const a: number | string = 123

// 简单点说：
// 如果想把 a 转换成 Ref , 如果是
// t extends Ref, 得到的结果可能是 Ref<number> | Ref<string>
// [t] extends [Ref], 得到的结果就是 Ref<number | string>
```



#### 2.3 ref 和 shallowRef

它们的区别与`reactive`和`shallowReactive`是一样的，就是会不会把嵌套的数据转成响应式。

在`RefImpl`类的构造函数中，根据传入的`_shallow`的值判断是否调用`convert`函数转换，`convert`里会调用`reactive`将嵌套的函数转成响应式。



对于 ref 的根属性，我们都是通过`ref.value`来操作的，相应的在类中 get value和 set value 中做依赖收集和更新触发。



注意，在 set 的过程做了一个优化，就是如果前后数据没变化(Nan 变为 NaN也算不变)，则不会触发任何操作。



#### 2.4 triggerRef

这个 API 是为了主动强制触发 shallowRef 的变更通知。

```typescript
const sref = shallowRef({ a: 1 })

effect(() => {
  console.log('sref.value.a === ', sref.value.a)
})

sref.value.a = 123


/*
此时只会打印：

sref.value.a === 1

因为 effect 在创建的时候会执行一次

可见，在修改嵌套的 a 属性时，并不会触发更新通知
*/
triggerRef(sref)
// 此时会再次打印：
// sref.value.a === 123
```

它的原理也很简单：

```typescript
export function triggerRef(ref: Ref) {
  trigger(toRaw(ref), TriggerOpTypes.SET, 'value', __DEV__ ? ref.value : void 0)
}
```

由于`shallowRef`不会观察嵌套的数据对象，但会响应关于`Ref.value`的更改，其实也就是触发了 ref 对象 `value`的更新。

`triggerRef`就是主动去触发`value`的依赖更新操作，在上面举例的代码中，`effect`中的 handler 有调用`sref.value`，所以也会被触发。



#### 2.5 proxyRef

该方法通过名字来看是来给 ref 做一层代理。它的`shallowUnwrapHandlers`主要是做以下操作：

- 根属性 ref 的 get 自动 Unref
- set
  - 如果是将非 ref 值设置给 ref 值，则更新 ref 值的 value
  - 否则反射到 target 的默认 set 操作

该方法通过 issue 等资料来看是用来对`setup`返回的对象做一个代理的， 主要是能对首层的 ref 解套，set 的操作能够满足 v-model 的操作。



#### 2.6 toRefs 和 toRef

`toRefs`和`toRef`都是为了将响应式对象的属性转为 ref 对象，不同的是一个转换所有一个置换指定的属性。

`toRefs`就是循环调用`toRef`来做到的。

```typescript
// 构造一个 ref 对象，将响应式对象的某个属性转为 ref 使用 (toRef)
class ObjectRefImpl<T extends object, K extends keyof T> {
  public readonly __v_isRef = true

  constructor(private readonly _object: T, private readonly _key: K) {}

  get value() {
    return this._object[this._key]
  }

  set value(newVal) {
    this._object[this._key] = newVal
  }
}

// 将响应式对象的指定属性转为 Ref(或直接返回 Ref)
export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K
): ToRef<T[K]> {
  return isRef(object[key])
    ? object[key]
    : (new ObjectRefImpl(object, key) as any)
}
```

在`toRef`中主要是调用了`ObjectRefImpl`，在这个类的定义中，发现它与`RefImpl`的不同在于，它没有 track 和 trigger 的过程。



原因其实也很简单，因为这两个方法主要是**将响应式对象**的某个(些)属性转为为 ref 对象，它们的依赖收集和更新触发操作都在原来的响应式对象中做了。



这里只需要将对`toRef`后的对象的操作反映到原来的响应式对象即可。





### 3. 其他

文件剩下的内容大都是一些类型相关的了，有些类型结构还是十分复杂的，不过它们并不影响阅读源码的思路。并且，有些函数的重载声明可以帮助我们更好地理解这个函数所有处理的内容包括哪些方面。