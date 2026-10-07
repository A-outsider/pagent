import { useId } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export type BotExpression = 'normal' | 'happy' | 'blink' | 'thinking' | 'wink';

export interface BotIconProps extends ComponentPropsWithoutRef<'svg'> {
  /** 尺寸（像素），默认 56 */
  size?: number;
  /** 机器人眼睛表情模式，预留后续表情变形与动画扩展 */
  expression?: BotExpression;
  /** 是否启用页面内交互动效（注视跟踪、眨眼、工作完成旋转） */
  animated?: boolean;
  /** 额外图层插槽（预留后续粒子、音波、光圈等 SVG 动效扩展） */
  children?: ReactNode;
}

/**
 * Pagent Bot 圆形机器人矢量图标组件
 * 采用高保真 SVG 分层图元设计，支持自适应缩放、表情形态切换与后续 SVG 动画扩展。
 */
export function BotIcon({
  size = 56,
  expression = 'normal',
  animated = false,
  className,
  children,
  ...restProps
}: BotIconProps) {
  const id = useId().replace(/:/g, '');

  const clipId = `pagent-bot-clip-${id}`;
  const baseGradId = `pagent-bot-base-${id}`;
  const cyanHighlightId = `pagent-bot-cyan-${id}`;
  const magentaHighlightId = `pagent-bot-magenta-${id}`;
  const glossRadialId = `pagent-bot-gloss-rad-${id}`;
  const glossLinearId = `pagent-bot-gloss-lin-${id}`;
  const bottomShadowId = `pagent-bot-bottom-shadow-${id}`;
  const eyeShadowId = `pagent-bot-eye-shadow-${id}`;

  const eyeClass = animated ? 'pagent-fab-eye' : undefined;

  const renderEyes = () => {
    switch (expression) {
      case 'happy':
        return (
          <>
            <path
              data-part="eye-left"
              className={eyeClass}
              d="M 18 29 Q 21 21.5 24 29"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              fill="none"
            />
            <path
              data-part="eye-right"
              className={eyeClass}
              d="M 32 29 Q 35 21.5 38 29"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              fill="none"
            />
          </>
        );

      case 'blink':
        return (
          <>
            <rect
              data-part="eye-left"
              className={eyeClass}
              x="18"
              y="27"
              width="6"
              height="2"
              rx="1"
              fill="currentColor"
            />
            <rect
              data-part="eye-right"
              className={eyeClass}
              x="32"
              y="27"
              width="6"
              height="2"
              rx="1"
              fill="currentColor"
            />
          </>
        );

      case 'thinking':
        return (
          <>
            <rect
              data-part="eye-left"
              className={eyeClass}
              x="18.5"
              y="16.5"
              width="5.5"
              height="14"
              rx="2.75"
              fill="currentColor"
            />
            <rect
              data-part="eye-right"
              className={eyeClass}
              x="32.5"
              y="17.5"
              width="5.5"
              height="14"
              rx="2.75"
              fill="currentColor"
            />
          </>
        );

      case 'wink':
        return (
          <>
            <rect
              data-part="eye-left"
              className={eyeClass}
              x="18"
              y="19.5"
              width="6"
              height="17"
              rx="3"
              fill="currentColor"
            />
            <path
              data-part="eye-right"
              className={eyeClass}
              d="M 32 29 Q 35 22.5 38 29"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            />
          </>
        );

      case 'normal':
      default:
        return (
          <>
            <rect
              data-part="eye-left"
              className={eyeClass}
              x="18"
              y="19.5"
              width="6"
              height="17"
              rx="3"
              fill="currentColor"
            />
            <rect
              data-part="eye-right"
              className={eyeClass}
              x="32"
              y="19.5"
              width="6"
              height="17"
              rx="3"
              fill="currentColor"
            />
          </>
        );
    }
  };

  return (
    <svg
      viewBox="0 0 56 56"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Pagent Bot"
      className={`pagent-bot-svg ${className ?? ''}`}
      style={{ color: 'oklch(0.985 0.006 250)', ...restProps.style }}
      {...restProps}
    >
      <defs>
        {/* 球体裁剪区域 */}
        <clipPath id={clipId}>
          <circle cx="28" cy="28" r="28" />
        </clipPath>

        {/* 底色斜向线性渐变 (145deg) */}
        <linearGradient
          id={baseGradId}
          x1="18%"
          y1="8%"
          x2="82%"
          y2="92%"
        >
          <stop offset="0%" stopColor="oklch(0.56 0.22 268)" />
          <stop offset="100%" stopColor="oklch(0.47 0.2 252)" />
        </linearGradient>

        {/* 左上方青色径向高光 (circle at 24% 18%) */}
        <radialGradient
          id={cyanHighlightId}
          cx="24%"
          cy="18%"
          r="34%"
        >
          <stop offset="0%" stopColor="oklch(0.82 0.13 222 / 0.95)" />
          <stop offset="100%" stopColor="oklch(0.82 0.13 222 / 0)" />
        </radialGradient>

        {/* 右下方洋红漫射高光 (circle at 82% 86%) */}
        <radialGradient
          id={magentaHighlightId}
          cx="82%"
          cy="86%"
          r="48%"
        >
          <stop offset="0%" stopColor="oklch(0.64 0.22 305 / 0.82)" />
          <stop offset="100%" stopColor="oklch(0.64 0.22 305 / 0)" />
        </radialGradient>

        {/* 表面玻璃质感高光 (circle at 30% 18%) */}
        <radialGradient
          id={glossRadialId}
          cx="30%"
          cy="18%"
          r="34%"
        >
          <stop offset="0%" stopColor="oklch(1 0 0 / 0.22)" />
          <stop offset="100%" stopColor="oklch(1 0 0 / 0)" />
        </radialGradient>

        {/* 表面垂直下沉微光 */}
        <linearGradient
          id={glossLinearId}
          x1="0%"
          y1="0%"
          x2="0%"
          y2="100%"
        >
          <stop offset="0%" stopColor="oklch(1 0 0 / 0.06)" />
          <stop offset="52%" stopColor="oklch(1 0 0 / 0)" />
        </linearGradient>

        {/* 底部环境暗影 */}
        <linearGradient
          id={bottomShadowId}
          x1="0%"
          y1="100%"
          x2="0%"
          y2="55%"
        >
          <stop offset="0%" stopColor="oklch(0.25 0.12 270 / 0.24)" />
          <stop offset="100%" stopColor="oklch(0.25 0.12 270 / 0)" />
        </linearGradient>

        {/* 眼睛轻微投影 */}
        <filter id={eyeShadowId} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx="0"
            dy="1"
            stdDeviation="1"
            floodColor="oklch(0.19 0.08 270)"
            floodOpacity="0.38"
          />
        </filter>
      </defs>

      {/* 1. 球体底座与光泽层 (data-part="face") */}
      <g data-part="face" clipPath={`url(#${clipId})`}>
        {/* 基础斜向渐变底色 */}
        <circle cx="28" cy="28" r="28" fill={`url(#${baseGradId})`} />
        {/* 左上青色光 */}
        <circle cx="28" cy="28" r="28" fill={`url(#${cyanHighlightId})`} />
        {/* 右下洋红光 */}
        <circle cx="28" cy="28" r="28" fill={`url(#${magentaHighlightId})`} />
        {/* 表面玻璃光泽 */}
        <circle cx="28" cy="28" r="28" fill={`url(#${glossRadialId})`} />
        <circle cx="28" cy="28" r="28" fill={`url(#${glossLinearId})`} />
        {/* 底部暗部加深球体立体感 */}
        <circle cx="28" cy="28" r="28" fill={`url(#${bottomShadowId})`} />
        {/* 顶部微内阴影/内光环 */}
        <circle
          cx="28"
          cy="28"
          r="27.5"
          fill="none"
          stroke="oklch(1 0 0 / 0.2)"
          strokeWidth="1"
        />
      </g>

      {/* 2. 眼睛容器层 (支持视线注视移动与绕球公转动效) */}
      <g
        data-part="eyes-container"
        className={animated ? 'pagent-fab-eyes' : undefined}
        filter={`url(#${eyeShadowId})`}
      >
        <g
          data-part="eyes-orbit"
          className={animated ? 'pagent-fab-eyes-orbit' : undefined}
        >
          {renderEyes()}
        </g>
      </g>

      {/* 3. 额外图元扩展插槽 (支持后续添加音波、粒子、光环等 SVG 动效) */}
      {children && <g data-part="decorations">{children}</g>}
    </svg>
  );
}
