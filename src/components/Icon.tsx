import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'arrow-left'
  | 'chevron-down'
  | 'expand'
  | 'image'
  | 'minus'
  | 'panorama'
  | 'plus'
  | 'refresh'
  | 'upload'
  | 'x';

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, ...props }: IconProps) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
  };

  let content: ReactNode;
  switch (name) {
    case 'arrow-left':
      content = <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>;
      break;
    case 'chevron-down':
      content = <path d="m6 9 6 6 6-6" />;
      break;
    case 'expand':
      content = <><path d="M8 3H3v5" /><path d="M3 3l6 6" /><path d="M16 3h5v5" /><path d="m21 3-6 6" /><path d="M8 21H3v-5" /><path d="m3 21 6-6" /><path d="M16 21h5v-5" /><path d="m21 21-6-6" /></>;
      break;
    case 'image':
      content = <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.2" /><path d="m4 17 4.5-4.5 3.2 3.2 2.2-2.2L20 19" /></>;
      break;
    case 'minus':
      content = <path d="M5 12h14" />;
      break;
    case 'panorama':
      content = <><path d="M3 8.5c2.4-2 5.4-3 9-3s6.6 1 9 3v7c-2.4 2-5.4 3-9 3s-6.6-1-9-3z" /><path d="M3 12c2.4 1.5 5.4 2.3 9 2.3s6.6-.8 9-2.3" /></>;
      break;
    case 'plus':
      content = <><path d="M12 5v14" /><path d="M5 12h14" /></>;
      break;
    case 'refresh':
      content = <><path d="M20 11a8 8 0 0 0-14.9-3.9L3 9" /><path d="M3 4v5h5" /><path d="M4 13a8 8 0 0 0 14.9 3.9L21 15" /><path d="M21 20v-5h-5" /></>;
      break;
    case 'upload':
      content = <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>;
      break;
    case 'x':
      content = <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>;
      break;
    default:
      content = null;
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      {...common}
      {...props}
    >
      {content}
    </svg>
  );
}
