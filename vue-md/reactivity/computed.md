### 说明



本文件是计算属性的单独实现，其本质上是一个 Ref 类型的结构。





#### 基本使用

```typescript
const re = reactive({ a: 1 })

const getter = () => re.a + 1

const com = computed(getter)
```



`com`对象会有一些特殊量：

- `_value`：存放实际值的变量
- `_dirty`：是否是脏值(即被变更过需要重新获取)





当注册`com`这个计算属性的时候，会调用`effect(getter)`将`getter`放入`re.a`的依赖关系中，该`effect`在创建时有两个地方需要注意：

```typescript
class ComputedRefImpl<T> {
  private _value!: T
  private _dirty = true

  public readonly effect: ReactiveEffect<T>

  public readonly __v_isRef = true;
  public readonly [ReactiveFlags.IS_READONLY]: boolean

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean
  ) {
    this.effect = effect(getter, {
      lazy: true,
      scheduler: () => {
        if (!this._dirty) {
          this._dirty = true
          trigger(toRaw(this), TriggerOpTypes.SET, 'value')
        }
      }
    })

    this[ReactiveFlags.IS_READONLY] = isReadonly
  }

  get value() {
    // the computed ref may get wrapped by other proxies e.g. readonly() #3376
    const self = toRaw(this)
    if (self._dirty) {
      self._value = this.effect()
      self._dirty = false
    }
    track(self, TrackOpTypes.GET, 'value')
    return self._value
  }

  set value(newValue: T) {
    this._setter(newValue)
  }
}
```

可以看见，该`effect`有`lazy`属性和`scheduler`调度器，尤其是在调度器中，改变了`_dirty`的值以及触发了`com`的`value`变化的更新。





我们知道`computed`计算属性是有结果缓存，延迟计算的作用，而它就是通过`_dirty`来实现的。





像其他对象触发更新，一般是先变更对应值，再触发更新操作，这样依赖关系重新获取就是新值。



而计算属性，是变更`_dirty`值，就直接通知更新触发让依赖计算属性的对象重新来获取计算属性的值。

在`get`过程中，发现`_dirty`为`true`，会重新运行一遍`effect`来获取新值，否则，会取上一次计算缓存的`_value`。



#### 高阶应用

在调用`computed`方法时，除了传一个`getter`函数之外，还可以传入一个对象，该对象可以设置`computed`对象值的设置。

```typescript
computed({ getter, setter })
```



