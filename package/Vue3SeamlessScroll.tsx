import {
  computed,
  CSSProperties,
  defineComponent,
  onBeforeMount,
  onMounted,
  ref,
  watch,
  nextTick,
  getCurrentInstance,
} from "vue";
import { throttle } from "throttle-debounce";
import propType from "./type";

function useExpose(apis: Record<string, any>) {
  const instance = getCurrentInstance();
  if (instance) {
    Object.assign(instance.proxy as Object, apis);
  }
}

const Props = {
  // 是否开启自动滚动
  modelValue: {
    type: Boolean,
    default: true,
  },
  // 原始数据列表
  list: {
    type: Array,
    required: true,
    default: [],
  },
  // 步进速度，step 需是单步大小的约数
  step: {
    type: Number,
    default: 1,
  },
  // 开启滚动的数据量
  limitScrollNum: {
    type: Number,
    default: 3,
  },
  // 是否开启鼠标悬停
  hover: {
    type: Boolean,
    default: false,
  },
  // 控制滚动方向
  direction: {
    type: String,
    default: "up",
  },
  // 单步运动停止的高度
  singleHeight: {
    type: Number,
    default: 0,
  },
  // 单步运动停止的宽度
  singleWidth: {
    type: Number,
    default: 0,
  },
  // 单步停止等待时间 (默认值 1000ms)
  singleWaitTime: {
    type: Number,
    default: 1000,
  },
  // 是否开启 rem 度量
  isRemUnit: {
    type: Boolean,
    default: false,
  },
  // 开启数据更新监听
  isWatch: {
    type: Boolean,
    default: true,
  },
  // 动画时间
  delay: {
    type: Number,
    default: 0,
  },
  // 动画方式
  ease: {
    type: [String, Object],
    default: "ease-in",
  },
  // 动画循环次数，-1 表示一直动画
  count: {
    type: Number,
    default: -1,
  },
  // 拷贝几份滚动列表
  copyNum: {
    type: Number,
    default: 1,
  },
  // 开启鼠标悬停时支持滚轮滚动
  wheel: {
    type: Boolean,
    default: false,
  },
  // 启用单行滚动
  singleLine: {
    type: Boolean,
    default: false,
  },
};

globalThis.window.cancelAnimationFrame = (function () {
  return (
    globalThis.window.cancelAnimationFrame ||
    // @ts-ignore
    globalThis.window.webkitCancelAnimationFrame ||
    // @ts-ignore
    globalThis.window.mozCancelAnimationFrame ||
    // @ts-ignore
    globalThis.window.oCancelAnimationFrame ||
    // @ts-ignore
    globalThis.window.msCancelAnimationFrame ||
    function (id) {
      return globalThis.window.clearTimeout(id);
    }
  );
})();
globalThis.window.requestAnimationFrame = (function () {
  return (
    globalThis.window.requestAnimationFrame ||
    // @ts-ignore
    globalThis.window.webkitRequestAnimationFrame ||
    // @ts-ignore
    globalThis.window.mozRequestAnimationFrame ||
    // @ts-ignore
    globalThis.window.oRequestAnimationFrame ||
    // @ts-ignore
    globalThis.window.msRequestAnimationFrame ||
    function (callback) {
      return globalThis.window.setTimeout(callback, 1000 / 60);
    }
  );
})();

function dataWarm(list) {
  if (list && typeof list !== "boolean" && list.length > 100) {
    console.warn(
      `数据达到了${list.length}条有点多哦~,可能会造成部分老旧浏览器卡顿。`
    );
  }
}

const Vue3SeamlessScroll = defineComponent({
  name: "vue3-seamless-scroll",
  inheritAttrs: false,
  props: Props,
  emits: ["stop", "count", "move"],
  setup(_props, { slots, emit, attrs }) {
    const props = _props as unknown as propType;
    const scrollRef = ref(null);
    const slotListRef = ref<HTMLDivElement | null>(null);
    const realBoxRef = ref<HTMLDivElement | null>(null);
    const reqFrame = ref<number | null>(null);
    const singleWaitTimeout = ref<NodeJS.Timeout | null>(null);
    const realBoxWidth = ref(0);
    const realBoxHeight = ref(0);
    const xPos = ref(0);
    const yPos = ref(0);
    const isHover = ref(false);
    const _count = ref(0);

    const isScroll = computed(() => props.list ? (props.list.length >= props.limitScrollNum) : false);

    const realBoxStyle = computed(() => {
      return {
        width: realBoxWidth.value ? `${realBoxWidth.value}px` : "auto",
        transform: `translate(${xPos.value}px,${yPos.value}px)`,
        // @ts-ignore
        transition: `all ${typeof props.ease === "string"
          ? props.ease
          : "cubic-bezier(" +
          props.ease.x1 +
          "," +
          props.ease.y1 +
          "," +
          props.ease.x2 +
          "," +
          props.ease.y2 +
          ")"
          } ${props.delay}ms`,
        overflow: "hidden",
        display: props.singleLine ? "flex" : "block",
      };
    });

    const isHorizontal = computed(
      () => props.direction == "left" || props.direction == "right"
    );

    const floatStyle = computed<CSSProperties>(() => {
      return isHorizontal.value
        ? {
          float: "left",
          overflow: "hidden",
          display: props.singleLine ? "flex" : "block",
          flexShrink: props.singleLine ? 0 : 1,
        }
        : { overflow: "hidden" };
    });

    const baseFontSize = computed(() => {
      return props.isRemUnit
        ? parseInt(
          globalThis.window.getComputedStyle(
            globalThis.document.documentElement,
            null
          ).fontSize
        )
        : 1;
    });

    const realSingleStopWidth = computed(
      () => props.singleWidth * baseFontSize.value
    );

    const realSingleStopHeight = computed(
      () => props.singleHeight * baseFontSize.value
    );

    const step = computed(() => {
      let singleStep: number;
      let _step = props.step;
      if (isHorizontal.value) {
        singleStep = realSingleStopWidth.value;
      } else {
        singleStep = realSingleStopHeight.value;
      }
      if (singleStep > 0 && singleStep % _step > 0) {
        console.error(
          "如果设置了单步滚动，step 需是单步大小的约数，否则无法保证单步滚动结束的位置是否准确。~~~~~"
        );
      }
      return _step;
    });

    const cancle = () => {
      cancelAnimationFrame(reqFrame.value as number);
      reqFrame.value = null;
    }

    const animation = (
      _direction: "up" | "down" | "left" | "right",
      _step: number,
      isWheel?: boolean
    ) => {
      reqFrame.value = requestAnimationFrame(function () {
        const h = realBoxHeight.value / 2;
        const w = realBoxWidth.value / 2;
        if (_direction === "up") {
          if (Math.abs(yPos.value) >= h) {
            yPos.value = 0;
            _count.value += 1;
            emit("count", _count.value);
          }
          yPos.value -= _step;
        } else if (_direction === "down") {
          if (yPos.value >= 0) {
            yPos.value = h * -1;
            _count.value += 1;
            emit("count", _count.value);
          }
          yPos.value += _step;
        } else if (_direction === "left") {
          if (Math.abs(xPos.value) >= w) {
            xPos.value = 0;
            _count.value += 1;
            emit("count", _count.value);
          }
          xPos.value -= _step;
        } else if (_direction === "right") {
          if (xPos.value >= 0) {
            xPos.value = w * -1;
            _count.value += 1;
            emit("count", _count.value);
          }
          xPos.value += _step;
        }
        if (isWheel) {
          return;
        }
        let { singleWaitTime } = props;
        if (singleWaitTimeout.value) {
          clearTimeout(singleWaitTimeout.value);
        }
        if (!!realSingleStopHeight.value) {
          if (Math.abs(yPos.value) % realSingleStopHeight.value < _step) {
            singleWaitTimeout.value = setTimeout(() => {
              move();
            }, singleWaitTime);
          } else {
            move();
          }
        } else if (!!realSingleStopWidth.value) {
          if (Math.abs(xPos.value) % realSingleStopWidth.value < _step) {
            singleWaitTimeout.value = setTimeout(() => {
              move();
            }, singleWaitTime);
          } else {
            move();
          }
        } else {
          move();
        }
      });
    }

    const move = () => {
      cancle();
      if (isHover.value || !isScroll.value || _count.value === props.count) {
        emit("stop", _count.value);
        _count.value = 0;
        return;
      }
      animation(
        props.direction as "up" | "down" | "left" | "right",
        step.value,
        false
      );
    }

    const initMove = () => {
      dataWarm(props.list);
      if (isHorizontal.value) {
        let slotListWidth = (slotListRef.value as HTMLDivElement).offsetWidth;
        slotListWidth = slotListWidth * 2 + 1;
        realBoxWidth.value = slotListWidth;
      }

      if (isScroll.value) {
        realBoxHeight.value = (realBoxRef.value as HTMLDivElement).offsetHeight;
        if (props.modelValue) {
          move();
        }
      } else {
        cancle();
        yPos.value = xPos.value = 0;
      }
    }

    const startMove = () => {
      isHover.value = false;
      move();
    }

    const stopMove = () => {
      isHover.value = true;
      if (singleWaitTimeout.value) {
        clearTimeout(singleWaitTimeout.value);
      }
      cancle();
    }

    const hoverStop = computed(
      () => props.hover && props.modelValue && isScroll.value
    );

    const throttleFunc = throttle(30, (e: WheelEvent) => {
      cancle();
      const singleHeight = !!realSingleStopHeight.value
        ? realSingleStopHeight.value
        : 15;
      if (e.deltaY < 0) {
        animation("down", singleHeight, true);
      }
      if (e.deltaY > 0) {
        animation("up", singleHeight, true);
      }
    });

    const onWheel = (e: WheelEvent) => {
      throttleFunc(e);
    };

    const reset = () => {
      cancle();
      isHover.value = false;
      initMove();
    }

    const Reset = () => {
      reset()
    }

    // 增加控制横向滚动距离方法
    const moveX = (pos: number) => {
      xPos.value = pos;
    }
    // 增加控制纵向滚动距离方法
    const moveY = (pos: number) => {
      yPos.value = pos;
    }

    // 增加控制滚动距离方法
    useExpose({ Reset, moveX, moveY })

    watch(
      () => props.list,
      () => {
        if (props.isWatch) {
          nextTick(() => {
            reset();
          })
        }
      },
      {
        deep: true,
      }
    );

    watch(
      () => props.modelValue,
      (newValue) => {
        if (newValue) {
          startMove();
        } else {
          stopMove();
        }
      }
    );

    watch(
      () => props.count,
      (newValue) => {
        if (newValue !== 0) {
          startMove();
        }
      }
    );

    onBeforeMount(() => {
      cancle();
      clearTimeout(singleWaitTimeout.value as unknown as number);
    });

    onMounted(() => {
      if (isScroll.value) {
        initMove();
      }
    });

    const { default: $default, html } = slots;
    const copyNum = new Array(props.copyNum).fill(null);

    const getHtml = () => {
      return (
        <>
          <div ref={slotListRef} style={floatStyle.value}>
            {$default && $default()}
          </div>
          {isScroll.value
            ? copyNum.map(() => {
              if (html && typeof html === "function") {
                return <div style={floatStyle.value}>{html()}</div>;
              } else {
                return <div style={floatStyle.value}>{$default && $default()}</div>;
              }
            })
            : null}
        </>
      );
    };

    return () => (
      <div ref={scrollRef} class={attrs.class}>
        {props.wheel && props.hover ? (
          <div
            ref={realBoxRef}
            style={realBoxStyle.value}
            onMouseenter={() => {
              if (hoverStop.value) {
                stopMove();
              }
            }}
            onMouseleave={() => {
              if (hoverStop.value) {
                startMove();
              }
            }}
            onWheel={(e) => {
              if (hoverStop.value) {
                onWheel(e);
              }
            }}
          >
            {getHtml()}
          </div>
        ) : (
          <div
            ref={realBoxRef}
            style={realBoxStyle.value}
            onMouseenter={() => {
              if (hoverStop.value) {
                stopMove();
              }
            }}
            onMouseleave={() => {
              if (hoverStop.value) {
                startMove();
              }
            }}
          >
            {getHtml()}
          </div>
        )}
      </div>
    );
  },
});

export default Vue3SeamlessScroll;
