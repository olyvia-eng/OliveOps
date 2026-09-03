interface MenuRect {
  top: number;
  right: number;
  bottom: number;
}

interface MenuSize {
  width: number;
  height: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

interface MenuPositionOptions {
  margin?: number;
  gap?: number;
}

export function calculateFixedMenuPosition(triggerRect: MenuRect, menuSize: MenuSize, viewport: ViewportSize, options?: MenuPositionOptions): {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};