/* 
isObject: params is Record<any, any>

toRawType: get RawType from strings like [object rawtype]

def: Object.defineProperty => configurable: true  enumerable: false
*/
import { isObject, toRawType, def } from '@vue/shared'
// import { effect, trigger } from './effect'
/* 
基础数据的处理集合：object number  string ...

readonly: 只读数据

shallow: 浅层响应数据，嵌套的对象不是响应式

*/
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReactiveHandlers,
  shallowReadonlyHandlers
} from './baseHandlers'

/* 
collection 包括： Map Set WeakMap WeakSet
*/
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers,
  shallowCollectionHandlers,
  shallowReadonlyCollectionHandlers
} from './collectionHandlers'

import { UnwrapRef, Ref } from './ref'

export const enum ReactiveFlags {
  SKIP = '__v_skip',
  IS_REACTIVE = '__v_isReactive',
  IS_READONLY = '__v_isReadonly',
  RAW = '__v_raw'
}

export interface Target {
  [ReactiveFlags.SKIP]?: boolean
  [ReactiveFlags.IS_REACTIVE]?: boolean
  [ReactiveFlags.IS_READONLY]?: boolean
  [ReactiveFlags.RAW]?: any
}

export const reactiveMap = new WeakMap<Target, any>()
export const shallowReactiveMap = new WeakMap<Target, any>()
export const readonlyMap = new WeakMap<Target, any>()
export const shallowReadonlyMap = new WeakMap<Target, any>()

const enum TargetType {
  INVALID = 0,
  COMMON = 1,
  COLLECTION = 2
}
/**
 * @description: 根据 rawType返回响应式对象类型
 * @param {string} rawType  类似[object Array]的Array
 * @return {*} Object/Array: 1  (Weak)map/set: 2  其他：0
 */
function targetTypeMap(rawType: string) {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

/**
 * @description: 获取对象的 type
 * @param {Target} value
 * @return {*}
 */
function getTargetType(value: Target) {
  // Object.preventExtensions / seal（密封） / freeze 不可扩展
  return value[ReactiveFlags.SKIP] || !Object.isExtensible(value)
    ? TargetType.INVALID
    : targetTypeMap(toRawType(value))
}

// only unwrap nested ref
// 对嵌套的 ref 进行类型递归解套
export type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>

/**
 * Creates a reactive copy of the original object.
 *
 * The reactive conversion is "deep"—it affects all nested properties. In the
 * ES2015 Proxy based implementation, the returned proxy is **not** equal to the
 * original object. It is recommended to work exclusively with the reactive
 * proxy and avoid relying on the original object.
 *
 * A reactive object also automatically unwraps refs contained in it, so you
 * don't need to use `.value` when accessing and mutating their value:
 *
 * ```js
 * const count = ref(0)
 * const obj = reactive({
 *   count
 * })
 *
 * obj.count++
 * obj.count // -> 1
 * count.value // -> 1
 * ```
 */
export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  if (target && (target as Target)[ReactiveFlags.IS_READONLY]) {
    return target
  }
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap
  )
}

/**
 * Return a shallowly-reactive copy of the original object, where only the root
 * level properties are reactive. It also does not auto-unwrap refs (even at the
 * root level).
 */
export function shallowReactive<T extends object>(target: T): T {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowCollectionHandlers,
    shallowReactiveMap
  )
}

type Primitive = string | number | boolean | bigint | symbol | undefined | null
type Builtin = Primitive | Function | Date | Error | RegExp
export type DeepReadonly<T> = T extends Builtin
  ? T
  : T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends WeakMap<infer K, infer V>
        ? WeakMap<DeepReadonly<K>, DeepReadonly<V>>
        : T extends Set<infer U>
          ? ReadonlySet<DeepReadonly<U>>
          : T extends ReadonlySet<infer U>
            ? ReadonlySet<DeepReadonly<U>>
            : T extends WeakSet<infer U>
              ? WeakSet<DeepReadonly<U>>
              : T extends Promise<infer U>
                ? Promise<DeepReadonly<U>>
                : T extends {}
                  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
                  : Readonly<T>

/**
 * Creates a readonly copy of the original object. Note the returned copy is not
 * made reactive, but `readonly` can be called on an already reactive object.
 */
export function readonly<T extends object>(
  target: T
): DeepReadonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers,
    readonlyMap
  )
}

/**
 * Returns a reactive-copy of the original object, where only the root level
 * properties are readonly, and does NOT unwrap refs nor recursively convert
 * returned properties.
 * This is used for creating the props proxy object for stateful components.
 */
export function shallowReadonly<T extends object>(
  target: T
): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    shallowReadonlyCollectionHandlers,
    shallowReadonlyMap
  )
}

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

export function isReactive(value: unknown): boolean {
  if (isReadonly(value)) {
    return isReactive((value as Target)[ReactiveFlags.RAW])
  }
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

export function isReadonly(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}

export function isProxy(value: unknown): boolean {
  return isReactive(value) || isReadonly(value)
}

export function toRaw<T>(observed: T): T {
  return (
    (observed && toRaw((observed as Target)[ReactiveFlags.RAW])) || observed
  )
}

export function markRaw<T extends object>(value: T): T {
  def(value, ReactiveFlags.SKIP, true)
  return value
}

// 个人测试内容：
// 1.shallowReactive 嵌套内容修改不会触发更新
// const q = reactive({
//   a: 1
//   b: {
//     c: 3
//   }
// })

// const w = shallowReactive({
//   a: 1
//   b: {
//     c: 3
//   }
// })
// effect(() => {
//   console.log('q.b.c  == ', q.b.c)
// })

// effect(() => {
//   console.log('w.b.c  == ', w.b.c)
// })

// console.log('qc before === ', q.b.c)
// q.b.c = 123

// console.log('wc before === ', w.b.c)
// w.b.c = 123

// 2. shallowReactive 如果是一个 reactive 对象，会直接返回 reactive 对象
// const reactiveObj = reactive({
//   a: 1,
//   b: {
//     d: 4
//   }
// })

// effect(() => {
//   console.log('reactiveObj.b.d == ', reactiveObj.b.d)
// })

// const shallowReactiveObj = shallowReactive(reactiveObj)
// shallowReactiveObj.b.d = 123
// console.log('reactiveObj === shallowReactiveObj === ', reactiveObj === shallowReactiveObj)

// 3.readonly 一个 reactive 对象，则 readonly 对象的原始对象存的是该 reactive 对象
// const rObj = reactive({
//   a: 1
// })

// const readObj = readonly(rObj)
// console.log('readObj === rObj :', readObj === rObj)
// console.log('readObj[ReactiveFlags.RAW] === rObj :', readObj[ReactiveFlags.RAW] === rObj)

// 4. 对 readonly 进行 reactive 得到的仍然是 readonly 原来的对象
// const readonlyObj = readonly({
//   a: 3
// })

// const rObj = reactive(readonlyObj)

// console.log(readonlyObj === rObj)

// 5. 代理一个已经被代理的对象
// const original = {
//   a: 1
// }

// const r1 = reactive(original)

// const r2 = reactive(r1)

// console.log('r1 === r2 ? ', r1 === r2)






/* 

测试 baseHandlers.ts 文件中的内容
由于它是被引入到该文件，在那边会报未先引入的错误

*/

// case 1 案列
// const obj = {}
// const arr = reactive([obj, {}])
// effect(() => {
//   console.log('arr.indexOf(obj) == ', arr.indexOf(obj))
// })

// arr.reverse()


// case 2 案列
// const test = {}
// const rtest = reactive(test)
// const arr = reactive([])
// arr.push(test)
// console.log(arr.includes(rtest) === true)


// case 3 只读响应式对象禁止修改
// const r = reactive({ a: 123 })
// const ronly = readonly(r)
// effect(() => console.log('ronly.a == ', ronly.a))
// r.a = 456
// ronly.a = 789 // 报错


// case 4 监听不存在的属性，需要触发 ADD 类型的 trigger
// 注释掉 baseHandlers.ts 中对应代码则不会触发更改输出
// const robj = reactive({ a: 1 })
// effect(() => console.log('robj ===-- ', robj.c))
// robj.c = 123

// const rArr = reactive([1])
// effect(() => console.log('rArr[1] === ', rArr[1]))
// rArr[1] = 123



// case 5 对象 in 操作符过滤内置 Symbol 属性
// const s = Symbol.iterator
// const o = Symbol('o')
// const t = reactive({
//   [s]: 234,
//   [o]: 123
// })

// effect(() => {
//   if (s in t) {
//     console.log('[s]', t[s])
//   }
// })

// effect(() => {
//   if (o in t) {
//     console.log('[o]', t[o])
//   }
// })

// t[s] = 567
// t[o] = 78000



// case 6 测试 ownKeys 对数组的 for...in 的拦截
// const arr = reactive([])
// effect(() => {
//   console.log('start === ')
//   for(const idx in arr) {
//     console.log('idx == ', idx)
//   }
// })
// arr.push(1, 2, 3)



/* 

测试 collectionHandlers.ts 文件中的代码

*/
// case 6
// get 时的对象无论是 原对象 还是 响应式对象，都会进行依赖收集
// const m = new Map()
// const o = { a: 1 }
// const reo = reactive(o)
// const rem = reactive(m)

// effect(() => console.log('rem.get(o) === ', rem.get(o)))
// effect(() => console.log('rem.get(reo) === ', rem.get(reo)))

// rem.set(reo, '3455')
// // or
// // rem.set(o, '3455')



// case 7 需要触发当前不存在键的依赖收集
// const a = reactive(new Map())
// const b = readonly(a)

// effect(() => console.log(b.get('foo')))

// a.set('foo', 2)





// case 8 将响应式对象本身及其原始对象同时作为键加入 Set 和 Map

// const obj = { a: 1 }
// const reObj = reactive(obj)

// // 没有代理的
// const map = new Map()
// map.set(obj, 123)
// map.set(reObj, 345)
// console.log('map === ', map)

// // 代理 Map
// const rmap = reactive(new Map())
// rmap.set(obj, 234)
// rmap.set(reObj, 456)
// console.log('rmap === ', rmap)

// // 代理 Set
// const rset = reactive(new Set())
// rset.add(obj)
// rset.add(reObj)
// console.log('rset === ', rset)


// case 8 delete 的时候，
// 如果原来的代理对象中就有 响应式对象及其原始对象作为键值
// const obj = { a: 1 }
// const reObj = reactive(obj)

// const map = new Map()
// map.set(obj, 123)
// map.set(reObj, 345)
// console.log('map === ', map)

// const rmap = reactive(map)
// rmap.delete(reObj)
// console.log('rmap = ', rmap)



/* 
测试 effect.ts 中的例子
*/

// case 9
// const r = reactive([1, 2, 3])
// effect(() => {
//   console.log('r[1] === ', r[1])
// })
// effect(() => {
//   console.log('r[2] === ', r[2])
// })
// effect(() => {
//   console.log('r.length === ', r.length)
// })

// r.length = 1

