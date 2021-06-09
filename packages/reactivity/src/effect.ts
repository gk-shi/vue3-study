import { TrackOpTypes, TriggerOpTypes } from './operations'
import { EMPTY_OBJ, isArray, isIntegerKey, isMap } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
type Dep = Set<ReactiveEffect>
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>()

export interface ReactiveEffect<T = any> {
  (): T
  _isEffect: true
  id: number
  active: boolean
  raw: () => T
  deps: Array<Dep>
  options: ReactiveEffectOptions
  allowRecurse: boolean
}

export interface ReactiveEffectOptions {
  lazy?: boolean
  scheduler?: (job: ReactiveEffect) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
  allowRecurse?: boolean
}

export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
} & DebuggerEventExtraInfo

export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

// 依赖函数栈
const effectStack: ReactiveEffect[] = []
let activeEffect: ReactiveEffect | undefined

export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')

export function isEffect(fn: any): fn is ReactiveEffect {
  return fn && fn._isEffect === true
}

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

export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.options.onStop) {
      effect.options.onStop()
    }
    effect.active = false
  }
}

/* 
这个 uid 属性很重要：
1. 创建时给定，父组件中的 uid 小于 子组件，任务 flush 时用 uid 排序
2. 避免当子组件任务先排入任务队列，但父组件已经销毁子组件任务中要到的属性(参考： https://github.com/vuejs/vue-next/issues/910)
3. 当父组件更新期间子组件销毁，可以跳过子组件更新的过程
*/
let uid = 0

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

function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

let shouldTrack = true
const trackStack: boolean[] = []

export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

export function track(target: object, type: TrackOpTypes, key: unknown) {
  if (!shouldTrack || activeEffect === undefined) {
    // 如果手机状态被关闭或者当前没有监听函数，不进行收集
    return
  }
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    // 如果当前 target 没有依赖，则添加一个依赖映射集合
    // depsMap => { ket -> Set(effect) }
    targetMap.set(target, (depsMap = new Map()))
  }
  let dep = depsMap.get(key)
  if (!dep) {
    // 新增一个监听函数集合
    depsMap.set(key, (dep = new Set()))
  }
  if (!dep.has(activeEffect)) {
    // 如果当前监听函数不在集合中，则表示需要进行收集
    dep.add(activeEffect)
    // 同时更新当前监听函数维护的依赖集合数组
    activeEffect.deps.push(dep)
    if (__DEV__ && activeEffect.options.onTrack) {
      // 暴露给开发环境的 onTrack 钩子
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key
      })
    }
  }
}

export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // never been tracked
    return
  }

  // 需要被触发执行的监听函数队列
  const effects = new Set<ReactiveEffect>()
  const add = (effectsToAdd: Set<ReactiveEffect> | undefined) => {
    if (effectsToAdd) {
      effectsToAdd.forEach(effect => {
        // 除非主动允许，否则同一个监听函数不能自身循环触发
        if (effect !== activeEffect || effect.allowRecurse) {
          effects.add(effect)
        }
      })
    }
  }
  if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    depsMap.forEach(add)
  } else if (key === 'length' && isArray(target)) {
    // 如果是直接修改数组的 length 属性，
    // 要触发监听 length 属性以及>=新值的小标的监听函数
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key >= (newValue as number)) {
        add(dep)
      }
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      add(depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE | Map.SET
    switch (type) {
      case TriggerOpTypes.ADD:
        if (!isArray(target)) {
          add(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            add(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        } else if (isIntegerKey(key)) {
          // new index added to array -> length changes
          // 类似 join 等方法的触发，由于 push 等方法不会触发 length 相关依赖执行，
          // 所以需要主动触发
          add(depsMap.get('length'))
        }
        break
      case TriggerOpTypes.DELETE:
        if (!isArray(target)) {
          add(depsMap.get(ITERATE_KEY))
          if (isMap(target)) {
            add(depsMap.get(MAP_KEY_ITERATE_KEY))
          }
        }
        break
      case TriggerOpTypes.SET:
        if (isMap(target)) {
          add(depsMap.get(ITERATE_KEY))
        }
        break
    }
  }

  const run = (effect: ReactiveEffect) => {
    if (__DEV__ && effect.options.onTrigger) {
      effect.options.onTrigger({
        effect,
        target,
        key,
        type,
        newValue,
        oldValue,
        oldTarget
      })
    }
    if (effect.options.scheduler) {
      effect.options.scheduler(effect)
    } else {
      effect()
    }
  }

  effects.forEach(run)
}
